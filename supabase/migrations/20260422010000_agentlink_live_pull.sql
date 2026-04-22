-- ════════════════════════════════════════════════════════════════════════
-- Agent Link LIVE PULL — runs entirely inside Postgres via pg_cron + pg_net
-- No edge function deploy needed.
--
-- Setup: user pastes their Agent Link session cookie via /dashboard/agentlink-sync.
-- Cookie and target agent_id go into system_settings. pg_cron runs the pull
-- every 30 min, writing results into public.agentlink_sync_log.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Sync log
CREATE TABLE IF NOT EXISTS public.agentlink_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running',
  upstream_status int,
  policies_seen   int DEFAULT 0,
  deals_inserted  int DEFAULT 0,
  deals_updated   int DEFAULT 0,
  error_message   text,
  http_request_id bigint
);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON public.agentlink_sync_log(started_at DESC);
ALTER TABLE public.agentlink_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_log_admin_read   ON public.agentlink_sync_log;
DROP POLICY IF EXISTS sync_log_service_all  ON public.agentlink_sync_log;
CREATE POLICY sync_log_admin_read  ON public.agentlink_sync_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY sync_log_service_all ON public.agentlink_sync_log FOR ALL    TO service_role USING (true);

-- 2. Unique index on external_deal_id (required for ON CONFLICT in live-pull)
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_external_deal_id_unique
  ON public.deals(external_deal_id) WHERE external_deal_id IS NOT NULL;

-- 3. Live-pull function (see commit message for full spec)
CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_agent_id uuid; v_request_id bigint;
  v_response record; v_deadline timestamptz;
  v_payload jsonb; v_policies jsonb; v_policy jsonb;
  v_external text; v_carrier_id uuid;
  v_inserted int := 0; v_updated int := 0; v_was_new boolean;
BEGIN
  INSERT INTO public.agentlink_sync_log (status) VALUES ('running') RETURNING * INTO v_log;

  SELECT value         INTO v_cookie   FROM public.system_settings WHERE key = 'agent_link_session_cookie';
  SELECT value::uuid   INTO v_agent_id FROM public.system_settings WHERE key = 'agent_link_live_agent_id';

  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='No cookie configured' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;
  IF v_agent_id IS NULL THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='No target agent_id configured' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  SELECT net.http_get(
    url     := 'https://agentlink.insuracloud.ai/api/v1/book-of-business',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept', 'application/json',
                                  'User-Agent', 'APEX-live-pull/1.0', 'X-Requested-With', 'XMLHttpRequest')
  ) INTO v_request_id;
  UPDATE public.agentlink_sync_log SET http_request_id=v_request_id WHERE id=v_log.id;

  v_deadline := clock_timestamp() + interval '20 seconds';
  LOOP
    SELECT status, status_code, content INTO v_response FROM net._http_response WHERE id = v_request_id;
    EXIT WHEN v_response IS NOT NULL OR clock_timestamp() > v_deadline;
    PERFORM pg_sleep(0.5);
  END LOOP;

  IF v_response IS NULL THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='Timeout waiting for Agent Link' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  UPDATE public.agentlink_sync_log SET upstream_status=v_response.status_code WHERE id=v_log.id;

  IF v_response.status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('Agent Link HTTP %s: %s', v_response.status_code, left(v_response.content, 300))
     WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_payload := v_response.content::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='Non-JSON response from Agent Link' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  v_policies := COALESCE(
    CASE jsonb_typeof(v_payload) WHEN 'array' THEN v_payload ELSE v_payload->'policies' END,
    v_payload->'data', v_payload->'deals', '[]'::jsonb);

  IF jsonb_typeof(v_policies) <> 'array' OR jsonb_array_length(v_policies) = 0 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='empty', policies_seen=0,
           error_message='Agent Link returned empty book' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  FOR v_policy IN SELECT * FROM jsonb_array_elements(v_policies) LOOP
    v_external := COALESCE(v_policy->>'id', v_policy->>'policy_number');
    IF v_external IS NULL OR v_external = '' THEN CONTINUE; END IF;

    SELECT id INTO v_carrier_id FROM public.carriers
     WHERE (insuracloud_carrier_id IS NOT NULL AND insuracloud_carrier_id::text = v_policy->>'carrier_id')
        OR (v_policy ? 'carrier_name' AND lower(name) = lower(v_policy->>'carrier_name'))
     LIMIT 1;

    v_was_new := NOT EXISTS (SELECT 1 FROM public.deals WHERE external_deal_id = v_external);

    INSERT INTO public.deals (
      agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, status, source, pipeline_stage, external_deal_id)
    VALUES (
      v_agent_id, v_carrier_id,
      COALESCE(v_policy->>'client_first_name','Unknown'),
      COALESCE(v_policy->>'client_last_name','Unknown'),
      COALESCE(v_policy->>'client_phone','UNKNOWN'),
      COALESCE((v_policy->>'client_dob')::date,'1970-01-01'::date),
      COALESCE(v_policy->>'product_sold', v_policy->>'product'),
      COALESCE(v_policy->>'policy_number', v_external),
      COALESCE((v_policy->>'monthly_premium')::numeric, 0),
      COALESCE((v_policy->>'annual_premium')::numeric, (v_policy->>'monthly_premium')::numeric*12, 0),
      COALESCE((v_policy->>'face_amount')::numeric, 0),
      COALESCE((v_policy->>'effective_date')::date, CURRENT_DATE),
      COALESCE(v_policy->>'status','submitted'),
      'agent_link_live',
      COALESCE(v_policy->>'pipeline_stage','submitted'),
      v_external)
    ON CONFLICT (external_deal_id) DO UPDATE SET
      monthly_premium = EXCLUDED.monthly_premium,
      annual_premium  = EXCLUDED.annual_premium,
      face_amount     = EXCLUDED.face_amount,
      status          = EXCLUDED.status,
      pipeline_stage  = EXCLUDED.pipeline_stage,
      updated_at      = now();

    IF v_was_new THEN v_inserted := v_inserted + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen=jsonb_array_length(v_policies),
         deals_inserted=v_inserted, deals_updated=v_updated
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;

GRANT EXECUTE ON FUNCTION public.agentlink_live_pull() TO service_role, authenticated;

-- 4. pg_cron schedule — every 30 min
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agentlink-live-pull') THEN
    PERFORM cron.unschedule('agentlink-live-pull');
  END IF;
  PERFORM cron.schedule('agentlink-live-pull', '*/30 * * * *',
    $cron$ SELECT public.agentlink_live_pull(); $cron$);
END $outer$;
