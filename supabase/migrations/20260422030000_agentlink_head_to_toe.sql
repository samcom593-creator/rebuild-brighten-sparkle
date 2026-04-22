-- ════════════════════════════════════════════════════════════════════════
-- Agent Link "head to toe and never stops" infrastructure
--
-- 3 sync functions + 1 watchdog, all running on pg_cron:
--   - agentlink_live_pull()        — /api/deals, */30 * * * *
--   - agentlink_pull_leads()       — /api/pipeline/clients, 17 * * * *
--   - agentlink_refresh_downline() — /api/agents/downline, 0 6 * * *
--   - agentlink_watchdog()         — health monitor, */5 * * * *
--
-- Uses net.http_collect_response(id, async:=false) for blocking response
-- collection (the earlier poll-loop had a transaction-visibility bug with
-- pg_net's background worker).
-- ════════════════════════════════════════════════════════════════════════

-- ── Leads / pipeline clients table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id        text UNIQUE NOT NULL,
  agent_id           uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  owner_user_id_al   int,
  stage              text,
  first_name         text,
  last_name          text,
  phone              text,
  email              text,
  date_of_birth      date,
  state              text,
  city               text,
  zip_code           text,
  is_smoker          boolean,
  raw                jsonb,
  created_at_al      timestamptz,
  updated_at_al      timestamptz,
  synced_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aleads_agent  ON public.agentlink_leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_aleads_stage  ON public.agentlink_leads(stage);
CREATE INDEX IF NOT EXISTS idx_aleads_synced ON public.agentlink_leads(synced_at DESC);

ALTER TABLE public.agentlink_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aleads_own_read     ON public.agentlink_leads;
DROP POLICY IF EXISTS aleads_admin_read   ON public.agentlink_leads;
DROP POLICY IF EXISTS aleads_service_all  ON public.agentlink_leads;
CREATE POLICY aleads_own_read    ON public.agentlink_leads FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE profile_id = auth.uid()));
CREATE POLICY aleads_admin_read  ON public.agentlink_leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY aleads_service_all ON public.agentlink_leads FOR ALL TO service_role USING (true);

-- ── Alerts table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  severity      text NOT NULL,
  message       text NOT NULL,
  last_ok_at    timestamptz,
  notified      boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_alalerts_open ON public.agentlink_alerts(raised_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE public.agentlink_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alalerts_admin ON public.agentlink_alerts;
DROP POLICY IF EXISTS alalerts_svc   ON public.agentlink_alerts;
CREATE POLICY alalerts_admin ON public.agentlink_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY alalerts_svc   ON public.agentlink_alerts FOR ALL TO service_role USING (true);

-- ── Deals live pull (rewritten with blocking collect) ───────────────────
CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_req bigint; v_resp record;
  v_status_code int; v_body text;
  v_payload jsonb; v_inserted int := 0; v_updated int := 0;
BEGIN
  INSERT INTO public.agentlink_sync_log (status, error_message) VALUES ('running','deals') RETURNING * INTO v_log;
  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='deals: no cookie' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  SELECT net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/deals',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept','application/json','User-Agent','APEX/1.0')
  ) INTO v_req;
  UPDATE public.agentlink_sync_log SET http_request_id=v_req WHERE id=v_log.id;

  SELECT * INTO v_resp FROM net.http_collect_response(v_req, async := false);
  v_status_code := (v_resp.response->>'status_code')::int;
  v_body := v_resp.response->>'body';
  UPDATE public.agentlink_sync_log SET upstream_status=v_status_code WHERE id=v_log.id;

  IF v_resp.status <> 'SUCCESS' OR v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('deals HTTP %s: %s', v_status_code, left(v_body,200))
     WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='deals: non-JSON' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_payload) <> 'array' OR jsonb_array_length(v_payload) = 0 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='empty', policies_seen=0,
           error_message='deals: empty' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  resolved AS (
    SELECT d, (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id = (d->>'userId')::int LIMIT 1) AS agent_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id = (d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status
    FROM raw
  ),
  ins AS (
    INSERT INTO public.deals (
      agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, source, pipeline_stage, external_deal_id, notes)
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
      CASE al_status
        WHEN 'Active' THEN 'active' WHEN 'Issued' THEN 'active' WHEN 'Lapse Pending' THEN 'active'
        WHEN 'Lapsed' THEN 'lapsed'
        WHEN 'Declined' THEN 'cancelled' WHEN 'Withdrawn' THEN 'cancelled'
        WHEN 'Cancelled' THEN 'cancelled' WHEN 'Not Taken' THEN 'cancelled'
        ELSE 'submitted' END,
      'agent_link',
      CASE al_status
        WHEN 'Active' THEN 'approved' WHEN 'Issued' THEN 'approved' WHEN 'Approved' THEN 'approved'
        WHEN 'Lapsed' THEN 'lapsed' ELSE 'submitted' END,
      external_id, d->>'notes'
    FROM resolved WHERE agent_id IS NOT NULL
    ON CONFLICT (external_deal_id) DO UPDATE SET
      monthly_premium=EXCLUDED.monthly_premium, annual_premium=EXCLUDED.annual_premium,
      face_amount=EXCLUDED.face_amount, status=EXCLUDED.status,
      pipeline_stage=EXCLUDED.pipeline_stage, notes=EXCLUDED.notes, updated_at=now()
    RETURNING xmax = 0 AS was_insert
  )
  SELECT COUNT(*) FILTER (WHERE was_insert)::int, COUNT(*) FILTER (WHERE NOT was_insert)::int
  INTO v_inserted, v_updated FROM ins;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen=jsonb_array_length(v_payload),
         deals_inserted=v_inserted, deals_updated=v_updated,
         error_message=format('deals: %s new, %s updated', v_inserted, v_updated)
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;
ALTER FUNCTION public.agentlink_live_pull() SET statement_timeout='120s';

-- ── Pipeline / leads pull ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agentlink_pull_leads()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_req bigint; v_resp record;
  v_status_code int; v_body text; v_payload jsonb;
  v_inserted int := 0; v_updated int := 0;
BEGIN
  INSERT INTO public.agentlink_sync_log (status, error_message) VALUES ('running','leads') RETURNING * INTO v_log;
  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='leads: no cookie' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  SELECT net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/pipeline/clients',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept','application/json','User-Agent','APEX/1.0')
  ) INTO v_req;
  UPDATE public.agentlink_sync_log SET http_request_id=v_req WHERE id=v_log.id;

  SELECT * INTO v_resp FROM net.http_collect_response(v_req, async := false);
  v_status_code := (v_resp.response->>'status_code')::int;
  v_body := v_resp.response->>'body';
  UPDATE public.agentlink_sync_log SET upstream_status=v_status_code WHERE id=v_log.id;

  IF v_resp.status <> 'SUCCESS' OR v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('leads HTTP %s: %s', v_status_code, left(v_body,200))
     WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='leads: non-JSON' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  up AS (
    INSERT INTO public.agentlink_leads (
      external_id, agent_id, owner_user_id_al, stage, first_name, last_name,
      phone, email, date_of_birth, state, city, zip_code, is_smoker, raw,
      created_at_al, updated_at_al)
    SELECT (d->>'id')::text,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id=(d->>'ownerUserId')::int LIMIT 1),
      (d->>'ownerUserId')::int, d->>'stage', d->>'firstName', d->>'lastName',
      d->>'phone', d->>'email', NULLIF(d->>'dateOfBirth','')::date,
      d->>'state', d->>'city', d->>'zipCode',
      CASE WHEN d->>'isSmoker' IS NULL THEN NULL ELSE (d->>'isSmoker')::boolean END,
      d,
      NULLIF(d->>'createdAt','')::timestamptz, NULLIF(d->>'updatedAt','')::timestamptz
    FROM raw
    ON CONFLICT (external_id) DO UPDATE SET
      stage=EXCLUDED.stage, agent_id=EXCLUDED.agent_id, phone=EXCLUDED.phone, email=EXCLUDED.email,
      raw=EXCLUDED.raw, updated_at_al=EXCLUDED.updated_at_al, synced_at=now()
    RETURNING xmax = 0 AS was_insert
  )
  SELECT COUNT(*) FILTER (WHERE was_insert)::int, COUNT(*) FILTER (WHERE NOT was_insert)::int
  INTO v_inserted, v_updated FROM up;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen=jsonb_array_length(v_payload),
         deals_inserted=v_inserted, deals_updated=v_updated,
         error_message=format('leads: %s new, %s updated', v_inserted, v_updated)
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;
ALTER FUNCTION public.agentlink_pull_leads() SET statement_timeout='120s';

-- ── Downline refresh ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agentlink_refresh_downline()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_req bigint; v_resp record;
  v_code int; v_body text; v_payload jsonb; v_matched int := 0;
BEGIN
  INSERT INTO public.agentlink_sync_log (status, error_message) VALUES ('running','downline') RETURNING * INTO v_log;
  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='downline: no cookie' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  SELECT net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/agents/downline',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept','application/json','User-Agent','APEX/1.0')
  ) INTO v_req;
  UPDATE public.agentlink_sync_log SET http_request_id=v_req WHERE id=v_log.id;

  SELECT * INTO v_resp FROM net.http_collect_response(v_req, async := false);
  v_code := (v_resp.response->>'status_code')::int;
  v_body := v_resp.response->>'body';
  UPDATE public.agentlink_sync_log SET upstream_status=v_code WHERE id=v_log.id;

  IF v_resp.status <> 'SUCCESS' OR v_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('downline HTTP %s', v_code) WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='downline: non-JSON' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  upd AS (
    UPDATE public.agents a
    SET insuracloud_user_id = (raw.d->>'id')::int
    FROM raw
    JOIN public.profiles p ON LOWER(TRIM(p.email)) = LOWER(TRIM(raw.d->>'email'))
    WHERE a.profile_id = p.id AND (a.insuracloud_user_id IS NULL OR a.insuracloud_user_id = 0)
    RETURNING a.id
  )
  SELECT COUNT(*)::int INTO v_matched FROM upd;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen=jsonb_array_length(v_payload),
         deals_inserted=v_matched,
         error_message=format('downline: %s newly-mapped agents', v_matched)
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;
ALTER FUNCTION public.agentlink_refresh_downline() SET statement_timeout='90s';

-- ── Watchdog — never-stops health monitor ───────────────────────────────
CREATE OR REPLACE FUNCTION public.agentlink_watchdog()
RETURNS TABLE(status text, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_last_ok timestamptz; v_hours_stale numeric;
  v_recent_fails int; v_recent_ok int; v_cookie_set boolean;
BEGIN
  SELECT MAX(started_at) INTO v_last_ok FROM public.agentlink_sync_log WHERE agentlink_sync_log.status='ok';
  v_hours_stale := ROUND((EXTRACT(EPOCH FROM (now() - COALESCE(v_last_ok, '2020-01-01'::timestamptz)))/3600.0)::numeric, 1);
  SELECT COUNT(*) INTO v_recent_fails FROM public.agentlink_sync_log
    WHERE started_at > now() - interval '1 hour' AND agentlink_sync_log.status='error';
  SELECT COUNT(*) INTO v_recent_ok FROM public.agentlink_sync_log
    WHERE started_at > now() - interval '1 hour' AND agentlink_sync_log.status='ok';
  SELECT EXISTS(SELECT 1 FROM public.system_settings WHERE key='agent_link_session_cookie' AND length(value) >= 20)
    INTO v_cookie_set;

  IF NOT v_cookie_set THEN
    INSERT INTO public.agentlink_alerts (severity, message, last_ok_at)
    VALUES ('critical','Agent Link cookie missing — live pull cannot run', v_last_ok);
    RETURN QUERY SELECT 'critical'::text, 'cookie missing'::text; RETURN;
  END IF;

  IF v_hours_stale > 2 THEN
    INSERT INTO public.agentlink_alerts (severity, message, last_ok_at)
    VALUES ('warning', 'No successful Agent Link sync for ' || v_hours_stale::text || 'h', v_last_ok);
    RETURN QUERY SELECT 'stale'::text, v_hours_stale::text || 'h stale'; RETURN;
  END IF;

  IF v_recent_fails > 3 AND v_recent_ok = 0 THEN
    INSERT INTO public.agentlink_alerts (severity, message, last_ok_at)
    VALUES ('warning', v_recent_fails::text || ' failed runs in last hour, 0 successful', v_last_ok);
    RETURN QUERY SELECT 'failing'::text, v_recent_fails::text || ' failures'; RETURN;
  END IF;

  UPDATE public.agentlink_alerts SET resolved_at = now() WHERE resolved_at IS NULL;
  RETURN QUERY SELECT 'healthy'::text, 'last ok ' || ROUND(v_hours_stale*60)::text || ' min ago';
END $fn$;

GRANT EXECUTE ON FUNCTION public.agentlink_pull_leads()       TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.agentlink_refresh_downline() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.agentlink_watchdog()         TO service_role, authenticated;

-- ── Schedules ───────────────────────────────────────────────────────────
DO $outer$ BEGIN
  -- Deals every 30 min (already exists from v1; reschedule idempotently)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agentlink-live-pull') THEN
    PERFORM cron.unschedule('agentlink-live-pull'); END IF;
  PERFORM cron.schedule('agentlink-live-pull', '*/30 * * * *',
    $cron$ SELECT public.agentlink_live_pull(); $cron$);

  -- Leads every hour at :17
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agentlink-leads-pull') THEN
    PERFORM cron.unschedule('agentlink-leads-pull'); END IF;
  PERFORM cron.schedule('agentlink-leads-pull', '17 * * * *',
    $cron$ SELECT public.agentlink_pull_leads(); $cron$);

  -- Downline daily at 06:00 UTC
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agentlink-downline-refresh') THEN
    PERFORM cron.unschedule('agentlink-downline-refresh'); END IF;
  PERFORM cron.schedule('agentlink-downline-refresh', '0 6 * * *',
    $cron$ SELECT public.agentlink_refresh_downline(); $cron$);

  -- Watchdog every 5 minutes
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agentlink-watchdog') THEN
    PERFORM cron.unschedule('agentlink-watchdog'); END IF;
  PERFORM cron.schedule('agentlink-watchdog', '*/5 * * * *',
    $cron$ SELECT public.agentlink_watchdog(); $cron$);
END $outer$;
