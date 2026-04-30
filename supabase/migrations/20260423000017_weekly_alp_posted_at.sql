-- ════════════════════════════════════════════════════════════════════════
-- Fix "Weekly ALP" widget to count deals POSTED this week, not effective
-- this week. Prior behavior summed deals with future effective_dates
-- (policies written today w/ effective 5/15 counted as this-week's
-- production forever, inflating the leaderboard by ~5x).
--
-- Changes:
--   1. public.deals.posted_at (timestamptz) — stores Agent Link's createdAt
--   2. Backfilled 688 rows from /api/deals.createdAt
--   3. agentlink_live_pull() now persists posted_at on every upsert
--
-- Frontend: Dashboard.tsx weekDealsQ switched from
--   .gte('effective_date', weekStartStr)
--     → .gte('posted_at', weekStart.toISOString())
--
-- Before (effective_date): 132 deals, $183,625
-- After  (posted_at):      16 deals,  $23,423
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS posted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_deals_posted_at ON public.deals(posted_at DESC) WHERE posted_at IS NOT NULL;

-- Patch agentlink_live_pull to persist posted_at from Agent Link's createdAt
CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_req bigint; v_resp net.http_response_result;
  v_status_code int; v_body text; v_payload jsonb;
  v_inserted int := 0; v_updated int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  INSERT INTO public.agentlink_sync_log (status, error_message) VALUES ('running','deals') RETURNING * INTO v_log;
  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='deals: no cookie' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(url := 'https://agentlink.insuracloud.ai/api/deals',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept','application/json','User-Agent','APEX/1.0'),
    timeout_milliseconds := 60000);
  UPDATE public.agentlink_sync_log SET http_request_id=v_req WHERE id=v_log.id;
  v_resp := net.http_collect_response(v_req, async := false);
  v_status_code := (v_resp.response).status_code;
  v_body := (v_resp.response).body;
  UPDATE public.agentlink_sync_log SET upstream_status=v_status_code WHERE id=v_log.id;

  IF v_resp.status::text <> 'SUCCESS' OR v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('deals HTTP %s: %s', v_status_code, left(coalesce(v_body,''),200))
     WHERE id=v_log.id RETURNING * INTO v_log; RETURN v_log;
  END IF;

  BEGIN v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='deals: non-JSON' WHERE id=v_log.id RETURNING * INTO v_log; RETURN v_log;
  END;
  IF jsonb_typeof(v_payload) <> 'array' OR jsonb_array_length(v_payload) = 0 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='empty', policies_seen=0,
           error_message='deals: empty' WHERE id=v_log.id RETURNING * INTO v_log; RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  resolved AS (SELECT d, (d->>'id')::text AS external_id,
    (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id=(d->>'userId')::int LIMIT 1) AS agent_id,
    (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id=(d->>'carrierId')::int LIMIT 1) AS carrier_id,
    d->'policyStatus'->>'standardStatus' AS al_status_raw,
    NULLIF(d->>'createdAt','')::timestamptz AS posted_at_raw FROM raw),
  ins AS (
    INSERT INTO public.deals (agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, policy_status_standard, status_updated_at,
      source, pipeline_stage, external_deal_id, notes, posted_at)
    SELECT agent_id, carrier_id,
      COALESCE(d->>'clientFirstName','Unknown'), COALESCE(d->>'clientLastName','Unknown'),
      COALESCE(d->>'clientPhoneNumber','UNKNOWN'),
      COALESCE(NULLIF(d->>'clientDateOfBirth','')::date,'1970-01-01'::date),
      d->>'productSold', COALESCE(d->>'policyNumber', external_id),
      COALESCE((d->>'monthlyPremium')::numeric,0),
      COALESCE((d->>'annualPremium')::numeric,(d->>'monthlyPremium')::numeric*12,0),
      COALESCE((d->>'faceAmount')::numeric,0),
      COALESCE(NULLIF(d->>'effectiveDate','')::date,CURRENT_DATE),
      NULLIF(d->>'policyExpirationDate','')::date,
      public.map_al_status(al_status_raw), al_status_raw, now(),
      'agent_link',
      CASE public.map_al_status(al_status_raw)
        WHEN 'active' THEN 'approved' WHEN 'lapsed' THEN 'lapsed' ELSE 'submitted' END,
      external_id, d->>'notes',
      posted_at_raw
    FROM resolved WHERE agent_id IS NOT NULL
    ON CONFLICT (external_deal_id) DO UPDATE SET
      monthly_premium=EXCLUDED.monthly_premium, annual_premium=EXCLUDED.annual_premium,
      face_amount=EXCLUDED.face_amount,
      status=EXCLUDED.status, policy_status_standard=EXCLUDED.policy_status_standard,
      status_updated_at = CASE WHEN public.deals.status IS DISTINCT FROM EXCLUDED.status THEN now() ELSE public.deals.status_updated_at END,
      pipeline_stage=EXCLUDED.pipeline_stage, notes=EXCLUDED.notes,
      posted_at=COALESCE(public.deals.posted_at, EXCLUDED.posted_at),
      updated_at=now()
    RETURNING xmax = 0 AS was_insert)
  SELECT COUNT(*) FILTER (WHERE was_insert)::int, COUNT(*) FILTER (WHERE NOT was_insert)::int
  INTO v_inserted, v_updated FROM ins;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen=jsonb_array_length(v_payload),
         deals_inserted=v_inserted, deals_updated=v_updated,
         error_message=format('deals: %s new, %s updated', v_inserted, v_updated)
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;
