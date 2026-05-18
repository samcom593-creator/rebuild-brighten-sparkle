-- ═══════════════════════════════════════════════════════════════════════════
-- ReadyMode integration scaffold — 2026-05-18
--
-- Sam: "I wanna integrate you into ReadyMode to get you obviously out of the
-- cold. Actual calls and being able to play calls and all that, but I just
-- need all this simple stuff done fast and done first."
--
-- This is the plug-and-play scaffold: schema + secrets-table contract so
-- when Sam drops API credentials into system_settings, the sync function
-- starts pulling. Until creds land, the schema sits empty + the UI shows
-- "awaiting credentials".
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── readymode_dialer_calls — one row per outbound dial logged in ReadyMode
CREATE TABLE IF NOT EXISTS readymode_dialer_calls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_call_id   text UNIQUE,                  -- ReadyMode's primary key
  agent_id           uuid REFERENCES agents(id) ON DELETE SET NULL,
  agent_raw          text,                          -- ReadyMode username/email
  campaign_name      text,
  lead_phone         text,
  lead_first_name    text,
  lead_last_name     text,
  lead_email         text,
  disposition        text,                          -- e.g. "Connected", "Voicemail", "No Answer"
  disposition_at     timestamptz,
  call_started_at    timestamptz,
  call_ended_at      timestamptz,
  duration_seconds   integer,
  recording_url      text,                          -- direct ReadyMode link (or our mirror)
  recording_path     text,                          -- when we mirror to Supabase storage
  notes              text,
  matched_lead_id    uuid,                          -- aged_leads.id when resolved
  matched_application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  raw                jsonb,
  imported_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rmd_agent_id ON readymode_dialer_calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_rmd_agent_raw_lc ON readymode_dialer_calls(lower(agent_raw));
CREATE INDEX IF NOT EXISTS idx_rmd_phone ON readymode_dialer_calls(lead_phone);
CREATE INDEX IF NOT EXISTS idx_rmd_started_at ON readymode_dialer_calls(call_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rmd_disposition ON readymode_dialer_calls(disposition);

ALTER TABLE readymode_dialer_calls ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY rmd_admin_all ON readymode_dialer_calls
    FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY rmd_agent_self ON readymode_dialer_calls
    FOR SELECT USING (
      agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── readymode_sync_log — observability for each polling run ───────────────
CREATE TABLE IF NOT EXISTS readymode_sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running',   -- running / ok / error
  pulled_count  integer DEFAULT 0,
  inserted_count integer DEFAULT 0,
  updated_count integer DEFAULT 0,
  matched_count integer DEFAULT 0,
  error_message text,
  raw           jsonb
);
CREATE INDEX IF NOT EXISTS idx_rmsl_started_at ON readymode_sync_log(started_at DESC);
ALTER TABLE readymode_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY rmsl_admin_read ON readymode_sync_log
    FOR SELECT USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── system_settings keys the sync function expects ───────────────────────
-- Insert empty placeholders so admin UI can list/edit them. Sam fills in
-- the values later via /dashboard/integrations.
INSERT INTO system_settings (key, value, updated_at) VALUES
  ('readymode_api_base_url', '', now()),
  ('readymode_api_key',      '', now()),
  ('readymode_account_id',   '', now()),
  ('readymode_sync_enabled', 'false', now())
ON CONFLICT (key) DO NOTHING;

-- ─── Matcher: link ReadyMode calls to internal agents + leads ──────────────
CREATE OR REPLACE FUNCTION fn_match_readymode_calls()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched_agents integer := 0;
  v_matched_leads  integer := 0;
BEGIN
  -- Agent match by email
  UPDATE readymode_dialer_calls c
  SET agent_id = a.id
  FROM agents a
  JOIN auth.users u ON u.id = a.user_id
  WHERE c.agent_id IS NULL
    AND c.agent_raw ILIKE '%@%'
    AND lower(u.email) = lower(trim(c.agent_raw));
  GET DIAGNOSTICS v_matched_agents = ROW_COUNT;

  -- Lead match by phone (last 10 digits)
  UPDATE readymode_dialer_calls c
  SET matched_lead_id = l.id
  FROM aged_leads l
  WHERE c.matched_lead_id IS NULL
    AND c.lead_phone IS NOT NULL
    AND regexp_replace(c.lead_phone, '\D', '', 'g') = regexp_replace(l.phone, '\D', '', 'g')
    AND length(regexp_replace(c.lead_phone, '\D', '', 'g')) >= 10;
  GET DIAGNOSTICS v_matched_leads = ROW_COUNT;

  RETURN jsonb_build_object('matched_agents', v_matched_agents, 'matched_leads', v_matched_leads);
END $$;

GRANT EXECUTE ON FUNCTION fn_match_readymode_calls() TO authenticated;

-- ─── Convenience views ────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_readymode_today CASCADE;
CREATE VIEW v_readymode_today AS
SELECT
  c.id,
  c.external_call_id,
  c.agent_id,
  COALESCE(ag.display_name, p.full_name, c.agent_raw) AS agent_name,
  c.campaign_name,
  c.lead_phone,
  c.lead_first_name,
  c.lead_last_name,
  c.disposition,
  c.duration_seconds,
  c.recording_url,
  c.call_started_at,
  c.matched_lead_id,
  c.matched_application_id
FROM readymode_dialer_calls c
LEFT JOIN agents   ag ON ag.id = c.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id
WHERE c.call_started_at >= current_date
ORDER BY c.call_started_at DESC;

GRANT SELECT ON v_readymode_today TO authenticated;

DROP VIEW IF EXISTS v_readymode_agent_today CASCADE;
CREATE VIEW v_readymode_agent_today AS
SELECT
  agent_id,
  COALESCE(ag.display_name, p.full_name, c.agent_raw) AS agent_name,
  count(*)::int AS calls_today,
  count(*) FILTER (WHERE c.disposition ILIKE 'connect%')::int AS connects,
  count(*) FILTER (WHERE c.disposition ILIKE 'voicemail%' OR c.disposition ILIKE 'vm%')::int AS voicemails,
  count(*) FILTER (WHERE c.disposition ILIKE 'no answer%' OR c.disposition ILIKE 'no-answer%')::int AS no_answers,
  ROUND(SUM(COALESCE(c.duration_seconds, 0)) / 3600.0, 1) AS hours_called,
  max(c.call_started_at) AS last_call_at
FROM readymode_dialer_calls c
LEFT JOIN agents   ag ON ag.id = c.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id
WHERE c.call_started_at >= current_date
GROUP BY c.agent_id, ag.display_name, p.full_name, c.agent_raw;

GRANT SELECT ON v_readymode_agent_today TO authenticated;

COMMIT;
