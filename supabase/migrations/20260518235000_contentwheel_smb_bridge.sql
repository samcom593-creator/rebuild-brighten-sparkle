-- ═══════════════════════════════════════════════════════════════════════════
-- ContentWheel ⇄ Social Media Bot Bridge (2026-05-18)
--
-- Two systems, two purposes, one feedback loop:
--   • Social Media Bot (SMB)  — the DOER. Today's draft queue, daemon health,
--     vidIQ analytics, inbound DMs, blockers. Operational/tactical.
--   • ContentWheel (CW)        — the BRAIN. Doctrine, the wheel, demand sources,
--     hook library, split tests, outliers, recruiting funnel. Strategic.
--
-- Bridge model (this migration):
--   1. Mapping table cw_smb_post_links — links one social_bot_draft to one cw_post.
--   2. Function cw_ingest_smb_shipped(draft_id) — promotes a shipped SMB draft into
--      a cw_posts row so it joins the wheel (outlier detection, KPIs, audience split).
--   3. View v_cw_smb_bridge — what SMB looks like from ContentWheel's POV
--      (drafts today, pending, blockers, scoreboard, latest analytics).
--   4. View v_smb_cw_bridge — what CW looks like from Social Media Bot's POV
--      (posts today vs quota, V→F %, active outliers, pipeline movement).
--
-- The bridge is read-then-act, not auto-sync — Sam keeps doctrine + tactics
-- visible from either side without one silently overwriting the other.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Link table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_smb_post_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smb_draft_id bigint NOT NULL UNIQUE,
  cw_post_id uuid NOT NULL REFERENCES cw_posts(id) ON DELETE CASCADE,
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_smb_post_links_cw ON cw_smb_post_links(cw_post_id);

ALTER TABLE cw_smb_post_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cw_smb_post_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cw_smb_post_links_admin_all ON cw_smb_post_links;
CREATE POLICY cw_smb_post_links_admin_all ON cw_smb_post_links
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON cw_smb_post_links FROM anon;
GRANT  ALL ON cw_smb_post_links TO authenticated;

-- ─── Helper: SMB platform string → cw_platform enum ────────────────────────
CREATE OR REPLACE FUNCTION cw_smb_platform_to_enum(p text)
RETURNS cw_platform LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(p,''))
    WHEN 'tiktok'    THEN 'tiktok'::cw_platform
    WHEN 'instagram' THEN 'instagram'::cw_platform
    WHEN 'ig'        THEN 'instagram'::cw_platform
    WHEN 'youtube'   THEN 'youtube'::cw_platform
    WHEN 'yt'        THEN 'youtube'::cw_platform
    WHEN 'shorts'    THEN 'youtube'::cw_platform
    WHEN 'snapchat'  THEN 'snapchat'::cw_platform
    WHEN 'snap'      THEN 'snapchat'::cw_platform
    WHEN 'twitter'   THEN 'twitter'::cw_platform
    WHEN 'x'         THEN 'twitter'::cw_platform
    WHEN 'linkedin'  THEN 'linkedin'::cw_platform
    WHEN 'facebook'  THEN 'facebook'::cw_platform
    WHEN 'fb'        THEN 'facebook'::cw_platform
    ELSE NULL
  END;
$$;

-- ─── Function: promote one shipped SMB draft into a cw_post ────────────────
-- Idempotent. Skips if already linked. Returns the cw_post_id (existing or new).
CREATE OR REPLACE FUNCTION cw_ingest_smb_shipped(p_draft_id bigint)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post_id uuid;
  v_existing uuid;
  v_platform cw_platform;
  v_d record;
BEGIN
  -- Allow service_role / direct DB caller (auth.uid() NULL) to bypass; admin gate otherwise.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT cw_post_id INTO v_existing FROM cw_smb_post_links WHERE smb_draft_id = p_draft_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_d FROM social_bot_drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'social_bot_drafts id=% not found', p_draft_id;
  END IF;

  IF v_d.status <> 'shipped' THEN
    RAISE EXCEPTION 'draft id=% is not shipped (status=%)', p_draft_id, v_d.status;
  END IF;

  v_platform := cw_smb_platform_to_enum(v_d.platform);
  IF v_platform IS NULL THEN
    RAISE EXCEPTION 'unknown SMB platform value: %', v_d.platform;
  END IF;

  INSERT INTO cw_posts (platform, url, posted_at, caption, notes)
  VALUES (
    v_platform,
    v_d.shipped_url,
    COALESCE(v_d.shipped_at, v_d.approved_at, v_d.created_at, now()),
    v_d.caption,
    'ingested from social_bot_drafts id=' || p_draft_id::text || coalesce(' · ' || v_d.title, '')
  )
  RETURNING id INTO v_post_id;

  INSERT INTO cw_smb_post_links (smb_draft_id, cw_post_id)
  VALUES (p_draft_id, v_post_id);

  RETURN v_post_id;
END $$;

REVOKE ALL ON FUNCTION cw_ingest_smb_shipped(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cw_ingest_smb_shipped(bigint) TO authenticated;

-- ─── Bulk-ingest: any shipped draft not yet linked ─────────────────────────
CREATE OR REPLACE FUNCTION cw_ingest_smb_backfill()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int := 0;
  v_id bigint;
BEGIN
  -- Allow service_role / direct DB caller (auth.uid() NULL) to bypass; admin gate otherwise.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  FOR v_id IN
    SELECT d.id FROM social_bot_drafts d
    WHERE d.status = 'shipped'
      AND NOT EXISTS (SELECT 1 FROM cw_smb_post_links l WHERE l.smb_draft_id = d.id)
  LOOP
    PERFORM cw_ingest_smb_shipped(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION cw_ingest_smb_backfill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cw_ingest_smb_backfill() TO authenticated;

-- ─── Auto-ingest trigger: whenever a draft flips to 'shipped' ──────────────
CREATE OR REPLACE FUNCTION cw_smb_drafts_auto_ingest()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platform cw_platform;
  v_post_id uuid;
  v_existing uuid;
BEGIN
  IF NEW.status <> 'shipped' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT NULL AND OLD.status = 'shipped' THEN RETURN NEW; END IF;

  SELECT cw_post_id INTO v_existing FROM cw_smb_post_links WHERE smb_draft_id = NEW.id;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  v_platform := cw_smb_platform_to_enum(NEW.platform);
  IF v_platform IS NULL THEN RETURN NEW; END IF;

  INSERT INTO cw_posts (platform, url, posted_at, caption, notes)
  VALUES (
    v_platform,
    NEW.shipped_url,
    COALESCE(NEW.shipped_at, NEW.approved_at, NEW.created_at, now()),
    NEW.caption,
    'auto-ingested from social_bot_drafts id=' || NEW.id::text || coalesce(' · ' || NEW.title, '')
  )
  RETURNING id INTO v_post_id;

  INSERT INTO cw_smb_post_links (smb_draft_id, cw_post_id) VALUES (NEW.id, v_post_id)
    ON CONFLICT (smb_draft_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cw_smb_drafts_auto_ingest ON social_bot_drafts;
CREATE TRIGGER trg_cw_smb_drafts_auto_ingest
  AFTER INSERT OR UPDATE OF status ON social_bot_drafts
  FOR EACH ROW EXECUTE FUNCTION cw_smb_drafts_auto_ingest();

-- ═══════════════════════════════════════════════════════════════════════════
-- BRIDGE VIEWS — both directions
-- ═══════════════════════════════════════════════════════════════════════════

-- v_cw_smb_bridge — what ContentWheel surfaces about Social Media Bot
DROP VIEW IF EXISTS v_cw_smb_bridge CASCADE;
CREATE VIEW v_cw_smb_bridge AS
WITH today AS (
  SELECT
    count(*) FILTER (WHERE draft_date = (now() AT TIME ZONE 'America/Chicago')::date)::int AS drafts_today,
    count(*) FILTER (WHERE draft_date = (now() AT TIME ZONE 'America/Chicago')::date AND status='pending')::int AS pending_today,
    count(*) FILTER (WHERE draft_date = (now() AT TIME ZONE 'America/Chicago')::date AND status='approved')::int AS approved_today,
    count(*) FILTER (WHERE draft_date = (now() AT TIME ZONE 'America/Chicago')::date AND status='shipped')::int AS shipped_today,
    count(*) FILTER (WHERE status='pending')::int AS pending_total
  FROM social_bot_drafts
),
blockers AS (
  SELECT
    count(*) FILTER (WHERE status='open')::int AS open_blockers,
    count(*) FILTER (WHERE status='open' AND severity IN ('critical','high'))::int AS hot_blockers,
    coalesce(sum(dollar_impact) FILTER (WHERE status='open'),0)::float AS open_dollar_impact
  FROM social_bot_blockers
),
last_run AS (
  SELECT id, started_at, ended_at, status, mode, entries
  FROM social_bot_runs
  ORDER BY started_at DESC
  LIMIT 1
),
last_analytics AS (
  SELECT platform, channel_handle, subscribers, total_views, days_since_upload,
         avg_view_pct, subscribers_gained, snapshot_ts
  FROM social_bot_analytics_snapshots
  ORDER BY snapshot_ts DESC
  LIMIT 1
),
inbound_7d AS (
  SELECT
    count(*)::int AS inbound_count,
    coalesce(sum(conversion_value_usd),0)::float AS inbound_paid_usd
  FROM social_bot_inbound
  WHERE ts >= now() - interval '7 days'
)
SELECT
  (SELECT row_to_json(t)::jsonb FROM today t)       AS today,
  (SELECT row_to_json(b)::jsonb FROM blockers b)    AS blockers,
  (SELECT row_to_json(r)::jsonb FROM last_run r)    AS last_run,
  (SELECT row_to_json(a)::jsonb FROM last_analytics a) AS last_analytics,
  (SELECT row_to_json(i)::jsonb FROM inbound_7d i)  AS inbound_7d;
GRANT SELECT ON v_cw_smb_bridge TO authenticated;

-- v_smb_cw_bridge — what Social Media Bot surfaces about ContentWheel
DROP VIEW IF EXISTS v_smb_cw_bridge CASCADE;
CREATE VIEW v_smb_cw_bridge AS
SELECT
  (SELECT row_to_json(v)::jsonb FROM v_cw_posts_today v)        AS posts_today,
  (SELECT row_to_json(v)::jsonb FROM v_cw_kpi_7d v)             AS kpi_7d,
  (SELECT row_to_json(v)::jsonb FROM v_cw_recruiting_pipeline v)AS pipeline,
  (SELECT row_to_json(v)::jsonb FROM v_cw_shot_vs_posted v)     AS shot_vs_posted,
  (SELECT count(*)::int FROM cw_outliers WHERE vein_open IS TRUE) AS active_outliers,
  (SELECT count(*)::int FROM cw_ideas WHERE status='backlog')   AS backlog_ideas,
  (SELECT row_to_json(v)::jsonb FROM v_cw_audience_split v)     AS audience_split,
  (SELECT count(*)::int FROM cw_smb_post_links)                 AS smb_links_count;
GRANT SELECT ON v_smb_cw_bridge TO authenticated;

-- Extend cw_dashboard_payload to include the SMB bridge payload as well
CREATE OR REPLACE FUNCTION cw_dashboard_payload()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payload jsonb;
BEGIN
  -- Allow service_role / direct DB caller (auth.uid() NULL) to bypass; admin gate otherwise.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT jsonb_build_object(
    'posts_today',       (SELECT row_to_json(v) FROM v_cw_posts_today v),
    'kpi_7d',            (SELECT row_to_json(v) FROM v_cw_kpi_7d v),
    'streak',            (SELECT COALESCE(jsonb_agg(row_to_json(v) ORDER BY v.day), '[]'::jsonb) FROM v_cw_quota_streak v),
    'outliers',          (SELECT COALESCE(jsonb_agg(row_to_json(v) ORDER BY v.multiple DESC), '[]'::jsonb) FROM v_cw_active_outliers v),
    'pipeline',          (SELECT row_to_json(v) FROM v_cw_recruiting_pipeline v),
    'shot_vs_posted',    (SELECT row_to_json(v) FROM v_cw_shot_vs_posted v),
    'audience_split',    (SELECT row_to_json(v) FROM v_cw_audience_split v),
    'active_challenge',  (SELECT row_to_json(v) FROM v_cw_active_challenge v LIMIT 1),
    'smb_bridge',        (SELECT row_to_json(v) FROM v_cw_smb_bridge v),
    'generated_at',      now()
  ) INTO v_payload;
  RETURN v_payload;
END $$;

REVOKE ALL ON FUNCTION cw_dashboard_payload() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cw_dashboard_payload() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: ingest every existing shipped draft (0 today but idempotent for future)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT cw_ingest_smb_backfill() AS backfilled_count;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Bridge done. SMB drafts → cw_posts now auto-flow on status='shipped'.
-- Dashboard payload now includes SMB stats. Bidirectional bridge views live.
-- ═══════════════════════════════════════════════════════════════════════════
