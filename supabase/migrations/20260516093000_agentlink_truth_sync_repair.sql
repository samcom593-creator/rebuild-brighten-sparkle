-- 2026-05-16 — AgentLink truth sync repair
--
-- Root cause this fixes:
--   * AgentLink cookie-pull stopped refreshing after 2026-05-05.
--   * The live DB function could hang long enough for the external cron's
--     25s cap to abandon it.
--   * Production still had an older agentlink_live_pull() definition that
--     did not persist posted_at, did not exclude both Sam agent records,
--     and could duplicate policies when AgentLink rotated external ids.
--   * get_agent_production_stats() still used effective_date even after the
--     rest of the truth layer moved to posted_at.
--
-- This migration keeps the legal/auth path intact: AgentLink is read only
-- through the saved browser session cookie / authorized API token. No
-- credential sharing, no bypassing access controls.

BEGIN;

CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
SET statement_timeout TO '90s'
AS $function$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text;
  v_req bigint;
  v_resp net.http_response_result;
  v_status_code int;
  v_body text;
  v_payload jsonb;
  v_seen int := 0;
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  -- Prevent overlapping cron/GitHub/manual pulls from fighting over the
  -- same policy rows or piling up stuck upstream requests.
  IF NOT pg_try_advisory_xact_lock(hashtext('agentlink_live_pull')) THEN
    INSERT INTO public.agentlink_sync_log (finished_at, status, error_message)
    VALUES (now(), 'error', 'deals: another AgentLink pull is already running')
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  INSERT INTO public.agentlink_sync_log (status, error_message)
  VALUES ('running', 'deals')
  RETURNING * INTO v_log;

  SELECT value INTO v_cookie
  FROM public.system_settings
  WHERE key = 'agent_link_session_cookie';

  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'no_cookie',
        error_message = 'deals: no cookie'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/deals',
    headers := jsonb_build_object(
      'Cookie', v_cookie,
      'Accept', 'application/json',
      'User-Agent', 'APEX/1.1'
    ),
    timeout_milliseconds := 30000
  );

  UPDATE public.agentlink_sync_log
  SET http_request_id = v_req
  WHERE id = v_log.id;

  v_resp := net.http_collect_response(v_req, async := false);
  v_status_code := (v_resp.response).status_code;
  v_body := (v_resp.response).body;

  UPDATE public.agentlink_sync_log
  SET upstream_status = v_status_code
  WHERE id = v_log.id;

  IF v_resp.status::text <> 'SUCCESS' OR v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = format('deals HTTP %s: %s', coalesce(v_status_code, 0), left(coalesce(v_body, ''), 220))
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN
    v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = 'deals: non-JSON'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_payload) <> 'array' THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = 'deals: unexpected payload shape'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_seen := jsonb_array_length(v_payload);
  IF v_seen = 0 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'empty',
        policies_seen = 0,
        error_message = 'deals: empty'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  CREATE TEMP TABLE tmp_agentlink_deals ON COMMIT DROP AS
  WITH raw AS (
    SELECT jsonb_array_elements(v_payload) AS d
  ),
  resolved AS (
    SELECT
      d,
      NULLIF(d->>'id', '')::text AS external_id,
      (
        SELECT a.id
        FROM public.agents a
        WHERE a.insuracloud_user_id = CASE
          WHEN NULLIF(d->>'userId', '') ~ '^\d+$' THEN NULLIF(d->>'userId', '')::int
          ELSE NULL::int
        END
        LIMIT 1
      ) AS agent_id,
      (
        SELECT c.id
        FROM public.carriers c
        WHERE c.insuracloud_carrier_id = CASE
          WHEN NULLIF(d->>'carrierId', '') ~ '^\d+$' THEN NULLIF(d->>'carrierId', '')::int
          ELSE NULL::int
        END
        LIMIT 1
      ) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status_raw,
      COALESCE(NULLIF(d->>'policyNumber', ''), NULLIF(d->>'id', '')) AS policy_number_raw,
      CASE
        WHEN NULLIF(d->>'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}' THEN NULLIF(d->>'createdAt', '')::timestamptz
        ELSE NULL::timestamptz
      END AS posted_at_raw,
      CASE
        WHEN NULLIF(d->>'clientDateOfBirth', '') ~ '^\d{4}-\d{2}-\d{2}'
          THEN NULLIF(d->>'clientDateOfBirth', '')::date
        ELSE '1970-01-01'::date
      END AS client_dob_raw,
      CASE
        WHEN NULLIF(d->>'effectiveDate', '') ~ '^\d{4}-\d{2}-\d{2}'
          THEN NULLIF(d->>'effectiveDate', '')::date
        ELSE CURRENT_DATE
      END AS effective_date_raw,
      CASE
        WHEN NULLIF(d->>'policyExpirationDate', '') ~ '^\d{4}-\d{2}-\d{2}'
          THEN NULLIF(d->>'policyExpirationDate', '')::date
        ELSE NULL::date
      END AS policy_expiration_date_raw,
      COALESCE(NULLIF(regexp_replace(coalesce(d->>'monthlyPremium', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) AS monthly_premium_raw,
      COALESCE(NULLIF(regexp_replace(coalesce(d->>'annualPremium', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) AS annual_premium_raw,
      COALESCE(NULLIF(regexp_replace(coalesce(d->>'faceAmount', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) AS face_amount_raw
    FROM raw
  )
  SELECT
    agent_id,
    carrier_id,
    COALESCE(NULLIF(d->>'clientFirstName', ''), 'Unknown') AS client_first_name,
    COALESCE(NULLIF(d->>'clientLastName', ''), 'Unknown') AS client_last_name,
    COALESCE(NULLIF(d->>'clientPhoneNumber', ''), 'UNKNOWN') AS client_phone,
    client_dob_raw AS client_dob,
    COALESCE(NULLIF(d->>'productSold', ''), 'Life Insurance') AS product_sold,
    policy_number_raw AS policy_number,
    monthly_premium_raw AS monthly_premium,
    COALESCE(NULLIF(annual_premium_raw, 0), monthly_premium_raw * 12, 0) AS annual_premium,
    face_amount_raw AS face_amount,
    effective_date_raw AS effective_date,
    policy_expiration_date_raw AS policy_expiration_date,
    public.map_al_status(al_status_raw) AS status,
    al_status_raw AS policy_status_standard,
    CASE public.map_al_status(al_status_raw)
      WHEN 'active' THEN 'approved'
      WHEN 'lapsed' THEN 'lapsed'
      ELSE 'submitted'
    END AS pipeline_stage,
    external_id,
    NULLIF(d->>'notes', '') AS notes,
    posted_at_raw
  FROM resolved
  WHERE agent_id IS NOT NULL
    AND policy_number_raw IS NOT NULL
    AND agent_id NOT IN (SELECT * FROM public.sam_agent_ids_to_exclude());

  WITH upd AS (
    UPDATE public.deals d
    SET carrier_id = COALESCE(t.carrier_id, d.carrier_id),
        client_first_name = t.client_first_name,
        client_last_name = t.client_last_name,
        client_phone = t.client_phone,
        client_dob = t.client_dob,
        product_sold = t.product_sold,
        monthly_premium = t.monthly_premium,
        annual_premium = t.annual_premium,
        face_amount = t.face_amount,
        effective_date = t.effective_date,
        policy_expiration_date = t.policy_expiration_date,
        status = t.status,
        policy_status_standard = t.policy_status_standard,
        status_updated_at = CASE WHEN d.status IS DISTINCT FROM t.status THEN now() ELSE d.status_updated_at END,
        source = 'agent_link',
        pipeline_stage = t.pipeline_stage,
        notes = t.notes,
        posted_at = COALESCE(t.posted_at_raw, d.posted_at, t.effective_date::timestamptz),
        updated_at = now()
    FROM tmp_agentlink_deals t
    WHERE d.agent_id = t.agent_id
      AND d.policy_number = t.policy_number
    RETURNING d.id
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  WITH ins AS (
    INSERT INTO public.deals (
      agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, policy_status_standard, status_updated_at,
      source, pipeline_stage, external_deal_id, notes, posted_at
    )
    SELECT
      t.agent_id, t.carrier_id, t.client_first_name, t.client_last_name, t.client_phone, t.client_dob,
      t.product_sold, t.policy_number, t.monthly_premium, t.annual_premium, t.face_amount,
      t.effective_date, t.policy_expiration_date, t.status, t.policy_status_standard, now(),
      'agent_link', t.pipeline_stage, t.external_id, t.notes,
      COALESCE(t.posted_at_raw, t.effective_date::timestamptz)
    FROM tmp_agentlink_deals t
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.agent_id = t.agent_id
        AND d.policy_number = t.policy_number
    )
    ON CONFLICT (external_deal_id) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  UPDATE public.agentlink_sync_log
  SET finished_at = now(),
      status = 'ok',
      policies_seen = v_seen,
      deals_inserted = v_inserted,
      deals_updated = v_updated,
      error_message = format('deals: %s new, %s updated', v_inserted, v_updated)
  WHERE id = v_log.id
  RETURNING * INTO v_log;

  RETURN v_log;
EXCEPTION WHEN others THEN
  IF v_log.id IS NOT NULL THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = left('deals: ' || SQLERRM, 500)
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;
  RAISE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.agentlink_live_pull() TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.get_agent_production_stats(start_date date, end_date date)
RETURNS TABLE(agent_id uuid, total_alp numeric, total_deals integer, total_presentations integer, last_activity_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH deals_agg AS (
    SELECT
      d.agent_id,
      COALESCE(SUM(d.annual_premium), 0) AS deals_alp,
      COUNT(*)::int AS deals_count,
      MAX((d.posted_at AT TIME ZONE 'America/Chicago')::date) AS last_deal_date
    FROM public.deals d
    WHERE d.status IN ('submitted', 'active')
      AND d.posted_at IS NOT NULL
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN start_date AND end_date
      AND d.agent_id IS NOT NULL
      AND d.agent_id NOT IN (SELECT * FROM public.sam_agent_ids_to_exclude())
    GROUP BY d.agent_id
  ),
  pres_agg AS (
    SELECT
      dp.agent_id,
      COALESCE(SUM(dp.presentations), 0)::int AS pres_count,
      MAX(dp.production_date) AS last_pres_date
    FROM public.daily_production dp
    WHERE dp.production_date BETWEEN start_date AND end_date
      AND dp.agent_id IS NOT NULL
    GROUP BY dp.agent_id
  ),
  all_agents AS (
    SELECT agent_id FROM deals_agg
    UNION
    SELECT agent_id FROM pres_agg
  )
  SELECT
    a.agent_id,
    COALESCE(d.deals_alp, 0)::numeric AS total_alp,
    COALESCE(d.deals_count, 0) AS total_deals,
    COALESCE(p.pres_count, 0) AS total_presentations,
    GREATEST(d.last_deal_date, p.last_pres_date) AS last_activity_date
  FROM all_agents a
  LEFT JOIN deals_agg d ON d.agent_id = a.agent_id
  LEFT JOIN pres_agg p ON p.agent_id = a.agent_id;
$function$;

COMMENT ON FUNCTION public.get_agent_production_stats(date, date) IS
'Truth-layer production stats via deals.posted_at CT for ALP/count and daily_production for presentations only. Repaired 2026-05-16.';

CREATE OR REPLACE VIEW public.agent_revenue_estimate AS
WITH agent_hierarchy AS (
  SELECT
    a.id AS root_agent_id,
    a.contract_percentage,
    a.override_rate,
    dl.agent_id AS downline_agent_id
  FROM public.agents a
  CROSS JOIN LATERAL public.get_downline_agent_ids(a.id) dl
  WHERE COALESCE(a.is_deactivated, false) = false
),
month_prod AS (
  SELECT
    d.agent_id,
    SUM(d.annual_premium)::numeric AS monthly_alp
  FROM public.deals d
  WHERE d.status IN ('submitted', 'active')
    AND d.posted_at IS NOT NULL
    AND (d.posted_at AT TIME ZONE 'America/Chicago')::date >= date_trunc('month', (now() AT TIME ZONE 'America/Chicago'))::date
    AND d.agent_id NOT IN (SELECT * FROM public.sam_agent_ids_to_exclude())
  GROUP BY d.agent_id
),
agent_totals AS (
  SELECT
    h.root_agent_id,
    MAX(h.contract_percentage) AS contract_pct,
    MAX(h.override_rate) AS override_rate,
    SUM(CASE WHEN h.downline_agent_id = h.root_agent_id THEN mp.monthly_alp ELSE 0 END) AS personal_monthly_alp,
    SUM(CASE WHEN h.downline_agent_id <> h.root_agent_id THEN mp.monthly_alp ELSE 0 END) AS downline_monthly_alp
  FROM agent_hierarchy h
  LEFT JOIN month_prod mp ON mp.agent_id = h.downline_agent_id
  GROUP BY h.root_agent_id
),
insuracloud_current AS (
  SELECT DISTINCT ON (agent_id)
    agent_id,
    mtd_earnings,
    direct_commissions,
    override_commissions,
    snapshot_time
  FROM public.insuracloud_snapshots
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY agent_id, snapshot_date DESC
)
SELECT
  t.root_agent_id AS agent_id,
  t.contract_pct,
  t.override_rate,
  COALESCE(t.personal_monthly_alp, 0) AS personal_monthly_alp,
  COALESCE(t.downline_monthly_alp, 0) AS downline_monthly_alp,
  ROUND((COALESCE(t.personal_monthly_alp, 0) * (t.contract_pct / 100.0) * 0.75 * 0.75)::numeric, 2) AS personal_monthly_estimate,
  ROUND((COALESCE(t.downline_monthly_alp, 0) * COALESCE(t.override_rate, 0) * 0.75 * 0.75)::numeric, 2) AS override_monthly_estimate,
  ic.mtd_earnings AS insuracloud_mtd,
  ic.direct_commissions AS insuracloud_direct,
  ic.override_commissions AS insuracloud_override,
  ic.snapshot_time AS insuracloud_last_sync
FROM agent_totals t
LEFT JOIN insuracloud_current ic ON ic.agent_id = t.root_agent_id;

GRANT SELECT ON public.agent_revenue_estimate TO authenticated;

COMMENT ON VIEW public.agent_revenue_estimate IS
'Per-agent revenue estimate from deals.posted_at truth with optional InsuraCloud commission overlay. Repaired 2026-05-16.';

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentlink-live-pull') THEN
    PERFORM cron.unschedule('agentlink-live-pull');
  END IF;

  PERFORM cron.schedule(
    'agentlink-live-pull',
    '*/5 * * * *',
    $cron$ SELECT public.agentlink_live_pull(); $cron$
  );
END
$outer$;

COMMIT;
