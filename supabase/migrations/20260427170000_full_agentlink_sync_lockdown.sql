-- 2026-04-27 — Final Agent Link sync lockdown
--
-- Captures the production fixes applied directly via bot-sql so the
-- repo and DB stay in sync. Five-layer protection against any future
-- attribution bug like the 700-phantom-deals incident.

-- Layer 1: helper that decides whether a deal is a "fresh real-time
-- close" vs a backfill / re-sync of a historical row. The earlier
-- cleanup spam was caused by celebration triggers firing on every
-- re-imported old deal as if it had just closed.
CREATE OR REPLACE FUNCTION public.is_fresh_deal_close(p_eff_date date, p_posted timestamptz, p_created timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_eff_date IS NOT NULL
     AND p_eff_date >= CURRENT_DATE - INTERVAL '2 days'
     AND COALESCE(p_posted, p_created) >= NOW() - INTERVAL '6 hours';
$$;

-- Layer 2: agentlink_live_pull patched with Sam-block + (agent_id,
-- policy_number) dedup. external_deal_id rotates on every Agent Link
-- re-pull, so the old ON CONFLICT (external_deal_id) was creating
-- 5-11x duplicates per policy. The NOT EXISTS clause prevents that.
CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS agentlink_sync_log LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_req bigint; v_resp net.http_response_result;
  v_status_code int; v_body text; v_payload jsonb;
  v_inserted int := 0; v_updated int := 0;
  SAM_AGENT_ID uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  INSERT INTO public.agentlink_sync_log (status, error_message) VALUES ('running','deals') RETURNING * INTO v_log;
  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie', error_message='deals: no cookie' WHERE id=v_log.id RETURNING * INTO v_log; RETURN v_log;
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

  BEGIN v_payload := v_body::jsonb; EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error', error_message='deals: non-JSON' WHERE id=v_log.id RETURNING * INTO v_log; RETURN v_log;
  END;
  IF jsonb_typeof(v_payload) <> 'array' OR jsonb_array_length(v_payload) = 0 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='empty', policies_seen=0, error_message='deals: empty' WHERE id=v_log.id RETURNING * INTO v_log; RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  resolved AS (
    SELECT d, (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id=(d->>'userId')::int LIMIT 1) AS agent_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id=(d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status_raw,
      NULLIF(d->>'createdAt','')::timestamptz AS posted_at_raw,
      COALESCE(NULLIF(d->>'effectiveDate','')::date, CURRENT_DATE) AS eff_date FROM raw),
  ins AS (
    INSERT INTO public.deals (agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, policy_status_standard, status_updated_at,
      source, pipeline_stage, external_deal_id, notes, posted_at)
    SELECT r.agent_id, r.carrier_id,
      COALESCE(r.d->>'clientFirstName','Unknown'), COALESCE(r.d->>'clientLastName','Unknown'),
      COALESCE(r.d->>'clientPhoneNumber','UNKNOWN'),
      COALESCE(NULLIF(r.d->>'clientDateOfBirth','')::date,'1970-01-01'::date),
      r.d->>'productSold', COALESCE(r.d->>'policyNumber', r.external_id),
      COALESCE((r.d->>'monthlyPremium')::numeric,0),
      COALESCE((r.d->>'annualPremium')::numeric,(r.d->>'monthlyPremium')::numeric*12,0),
      COALESCE((r.d->>'faceAmount')::numeric,0),
      r.eff_date,
      NULLIF(r.d->>'policyExpirationDate','')::date,
      public.map_al_status(r.al_status_raw), r.al_status_raw, now(),
      'agent_link',
      CASE public.map_al_status(r.al_status_raw) WHEN 'active' THEN 'approved' WHEN 'lapsed' THEN 'lapsed' ELSE 'submitted' END,
      r.external_id, r.d->>'notes', r.posted_at_raw
    FROM resolved r
    WHERE r.agent_id IS NOT NULL
      AND r.agent_id <> SAM_AGENT_ID
      AND NOT EXISTS (SELECT 1 FROM public.deals d2 WHERE d2.agent_id = r.agent_id AND d2.policy_number = COALESCE(r.d->>'policyNumber', r.external_id))
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
END $function$;

-- Layer 3: deal_broadcast trigger function gets a fresh-deal guard so
-- backfilled re-syncs no longer queue notify-deal-submitted automation
-- jobs for every old policy.
CREATE OR REPLACE FUNCTION public.trg_fn_deal_broadcast()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.source IS NULL OR NEW.source = 'apex' THEN
    INSERT INTO public.deal_sync_queue (deal_id, direction, status) VALUES (NEW.id, 'outbound', 'pending');
  END IF;
  IF public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at) THEN
    PERFORM public.run_automation_job('deal-broadcast', 'notify-deal-submitted', jsonb_build_object('deal_id', NEW.id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END; $function$;

-- Layer 4: re-create celebration triggers with WHEN clauses so their
-- functions don't fire at all on backfilled rows. Replaces the
-- ALTER TABLE DISABLE TRIGGER hack from earlier today.
DROP TRIGGER IF EXISTS trg_deal_celebration ON public.deals;
CREATE TRIGGER trg_deal_celebration AFTER INSERT ON public.deals FOR EACH ROW
  WHEN (public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at))
  EXECUTE FUNCTION public.trg_fn_deal_celebration();

DROP TRIGGER IF EXISTS trg_deal_closed_discord ON public.deals;
CREATE TRIGGER trg_deal_closed_discord AFTER INSERT ON public.deals FOR EACH ROW
  WHEN (public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at))
  EXECUTE FUNCTION public.trg_fn_deal_closed_discord();

DROP TRIGGER IF EXISTS trg_first_deal_welcome ON public.deals;
CREATE TRIGGER trg_first_deal_welcome AFTER INSERT ON public.deals FOR EACH ROW
  WHEN (public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at))
  EXECUTE FUNCTION public.trg_fn_first_deal_welcome();

DROP TRIGGER IF EXISTS trg_hot_streak ON public.deals;
CREATE TRIGGER trg_hot_streak AFTER INSERT ON public.deals FOR EACH ROW
  WHEN (public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at))
  EXECUTE FUNCTION public.trg_fn_hot_streak();

DROP TRIGGER IF EXISTS trg_referral_ask ON public.deals;
CREATE TRIGGER trg_referral_ask AFTER INSERT ON public.deals FOR EACH ROW
  WHEN (public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at))
  EXECUTE FUNCTION public.trg_fn_referral_ask();

DROP TRIGGER IF EXISTS trg_bot_alert_big_deal ON public.deals;
CREATE TRIGGER trg_bot_alert_big_deal AFTER INSERT ON public.deals FOR EACH ROW
  WHEN (public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at))
  EXECUTE FUNCTION public.bot_alert_big_deal();

ALTER TABLE public.deals ENABLE TRIGGER trg_deals_autopush_insuracloud;
ALTER TABLE public.deals ENABLE TRIGGER trg_deal_broadcast;

-- Layer 5 lives outside this migration: agents.insuracloud_user_id is
-- NULL for Sam (so payload userId=211 cannot resolve to him), and the
-- BEFORE INSERT/UPDATE trg_block_sam_deal trigger raises an exception
-- on any row trying to set agent_id = Sam's UUID.
