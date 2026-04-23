-- Rewrite agentlink_refresh_downline to use async pg_net polling instead of
-- blocking http_collect_response. Fixes the statement-timeout bomb that kept
-- the cron from ever succeeding.
--
-- Old pattern: net.http_collect_response(v_req, async := false) — blocks
-- via internal pg_sleep loop which hits the cron statement_timeout and
-- dies mid-wait. Even with SET LOCAL statement_timeout = 0 on the cron
-- command, the pg_net worker has its own thresholds.
--
-- New pattern: fire the request → poll net._http_response.status_code in
-- a controlled loop with explicit pg_sleep(1.5) intervals, cap at 40
-- iterations (=60s). If Agent Link is slower than that, return status
-- 'pending' and let the next cron tick collect the already-queued
-- response.

CREATE OR REPLACE FUNCTION public.agentlink_refresh_downline()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_log       public.agentlink_sync_log;
  v_cookie    text;
  v_req_id    bigint;
  v_my_id     text;
  v_status    int;
  v_body      text;
  v_payload   jsonb;
  v_poll      int := 0;
  v_max_poll  int := 40;
  v_inserted  int := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  INSERT INTO public.agentlink_sync_log (status, error_message)
  VALUES ('running', 'downline')
  RETURNING * INTO v_log;

  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  SELECT value INTO v_my_id  FROM public.system_settings WHERE key='agent_link_live_agent_id';

  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at=now(), status='no_cookie', error_message='downline: no cookie'
    WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req_id := net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/agents/downline',
    headers := jsonb_build_object(
      'Cookie', v_cookie,
      'Accept', 'application/json',
      'User-Agent', 'APEX/1.0'),
    timeout_milliseconds := 90000
  );

  UPDATE public.agentlink_sync_log SET http_request_id=v_req_id WHERE id=v_log.id;

  LOOP
    SELECT status_code, content::text INTO v_status, v_body
    FROM net._http_response WHERE id = v_req_id;
    EXIT WHEN v_status IS NOT NULL;
    v_poll := v_poll + 1;
    EXIT WHEN v_poll >= v_max_poll;
    PERFORM pg_sleep(1.5);
  END LOOP;

  IF v_status IS NULL THEN
    UPDATE public.agentlink_sync_log
    SET finished_at=now(), status='pending',
        error_message='downline: response not ready after 60s; next tick will process'
    WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  UPDATE public.agentlink_sync_log SET upstream_status=v_status WHERE id=v_log.id;

  IF v_status NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at=now(), status='error',
        error_message=format('downline HTTP %s: %s', v_status, left(COALESCE(v_body,''), 200))
    WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN
    v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log
    SET finished_at=now(), status='error', error_message='downline: non-JSON body'
    WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_payload) <> 'array' OR jsonb_array_length(v_payload) = 0 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at=now(), status='empty', policies_seen=0,
        error_message='downline: empty response'
    WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  DELETE FROM public.insuracloud_downline WHERE agent_id = v_my_id::uuid;

  INSERT INTO public.insuracloud_downline (
    agent_id, downline_name, downline_external_id, total_commission,
    policy_count, rank, period_start, period_end, raw_payload, synced_at
  )
  SELECT
    v_my_id::uuid,
    COALESCE(elem->>'firstName','') || ' ' || COALESCE(elem->>'lastName',''),
    (elem->>'id')::text,
    0::numeric,
    COALESCE((elem->>'contractCount')::int, 0),
    ROW_NUMBER() OVER (),
    date_trunc('month', CURRENT_DATE)::date,
    CURRENT_DATE,
    elem,
    NOW()
  FROM jsonb_array_elements(v_payload) AS elem;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Opportunistic backfill: link agents rows to their Agent Link user_id
  -- wherever we have a matching email and haven't linked yet.
  UPDATE public.agents a
  SET insuracloud_user_id = (elem->>'id')::int,
      display_name = COALESCE(NULLIF(a.display_name,''),
                              (elem->>'firstName') || ' ' || (elem->>'lastName'))
  FROM profiles p,
       jsonb_array_elements(v_payload) AS elem
  WHERE p.id = a.profile_id
    AND LOWER(p.email) = LOWER(elem->>'email')
    AND a.insuracloud_user_id IS NULL;

  UPDATE public.agentlink_sync_log
  SET finished_at=now(),
      status='ok',
      policies_seen=v_inserted,
      error_message=format('downline: %s rows refreshed', v_inserted)
  WHERE id=v_log.id RETURNING * INTO v_log;

  RETURN v_log;
END;
$body$;
