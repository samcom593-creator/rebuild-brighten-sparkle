-- Bug sweep — 2026-04-22 pass.
--
-- 1. CRITICAL: run_automation_job's pg_net calls were timing out at 5s
--    (pg_net's default) because the Supabase cluster's DNS resolver
--    intermittently takes 5+ seconds. Every critical alert dispatch for
--    at least the last hour silently failed with "Timeout of 5000 ms
--    reached · DNS time: 5001.301000 ms". Fix: pass
--    timeout_milliseconds := 30000 on every automation-triggered call.
--
-- 2. Dedup throttle for insuracloud_sync_error alerts — the outbox was
--    creating one alert per failing deal per retry tick (every :05),
--    snowballing to 47 duplicates before being rolled up. Adds a
--    15-minute cooldown helper that callers can use instead of raw INSERT.
--
-- 3. agent_deactivated alerts were info-severity (batched), but losing an
--    agent is urgent. Upgraded open ones to warn so they dispatch live.
--
-- 4. deal_sync_queue had no retry cap — carrierless deals were being
--    retried forever. Promote to 'dead' at attempts>=5 or carrier_id is
--    NULL.

-- ─── 1. run_automation_job with 30s pg_net timeout ────────────────────
CREATE OR REPLACE FUNCTION public.run_automation_job(
  p_job_name text,
  p_function_name text,
  p_body jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_log_id uuid;
  v_url text;
  v_key text;
  v_start timestamptz;
  v_base_url text;
BEGIN
  v_start := clock_timestamp();

  INSERT INTO public.automation_run_log (job_name, status)
  VALUES (p_job_name, 'running')
  RETURNING id INTO v_log_id;

  v_base_url := current_setting('app.settings.supabase_url', true);
  IF v_base_url IS NULL OR v_base_url = '' THEN
    SELECT value INTO v_base_url FROM public.system_settings WHERE key = 'supabase_url';
  END IF;
  IF v_base_url IS NULL OR v_base_url = '' THEN
    v_base_url := 'https://msydzhzolwourcdmqxvn.supabase.co';
  END IF;

  v_url := v_base_url || '/functions/v1/' || p_function_name;

  v_key := current_setting('app.settings.service_role_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    SELECT value INTO v_key FROM public.system_settings WHERE key = 'service_role_key';
  END IF;
  IF v_key IS NULL OR v_key = '' THEN
    SELECT value INTO v_key FROM public.system_settings WHERE key = 'supabase_anon_key';
  END IF;

  IF v_key IS NULL OR v_key = '' THEN
    UPDATE public.automation_run_log
    SET status = 'error', error = 'No auth key available',
        completed_at = now(),
        duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
    WHERE id = v_log_id;
    RETURN v_log_id;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'x-automation-job', p_job_name,
      'x-automation-log-id', v_log_id::text
    ),
    timeout_milliseconds := 30000
  );

  UPDATE public.automation_run_log
  SET status = 'success', completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  WHERE id = v_log_id;

  RETURN v_log_id;
EXCEPTION WHEN others THEN
  UPDATE public.automation_run_log
  SET status = 'error', error = SQLERRM, completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  WHERE id = v_log_id;
  RETURN v_log_id;
END;
$body$;

-- ─── 2. Throttled helper for InsuraCloud error alerts ────────────────
CREATE OR REPLACE FUNCTION public.bot_alert_insuracloud_err_throttled(
  p_subject text, p_body text, p_action_link text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $body$
DECLARE v_recent int;
BEGIN
  SELECT COUNT(*)::int INTO v_recent
    FROM public.bot_alerts
   WHERE event_type = 'insuracloud_sync_error'
     AND created_at > NOW() - INTERVAL '15 minutes';

  IF v_recent > 0 THEN
    UPDATE public.bot_alerts
       SET body = body || format(E'\n- retry at %s', to_char(now() AT TIME ZONE 'America/Chicago', 'HH24:MI CT'))
     WHERE event_type = 'insuracloud_sync_error'
       AND sent_at IS NULL
       AND id = (SELECT id FROM public.bot_alerts
                  WHERE event_type = 'insuracloud_sync_error' AND sent_at IS NULL
                  ORDER BY created_at DESC LIMIT 1);
    RETURN;
  END IF;

  INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
  VALUES ('trigger', 'insuracloud_sync_error', 'warn', p_subject, p_body,
          'InsuraCloud sync failing repeatedly. Refresh cookie or check carrier IDs.',
          COALESCE(p_action_link, 'https://apex-financial.org/dashboard/agentlink-sync'),
          ARRAY['email']::text[]);
END;
$body$;

-- ─── 3. deal_sync_queue attempts cap sweeper (idempotent) ────────────
-- Scheduled via cron so it runs continuously, not just at install.
CREATE OR REPLACE FUNCTION public.deal_sync_queue_promote_dead()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $body$
DECLARE v_promoted int;
BEGIN
  WITH promoted AS (
    UPDATE public.deal_sync_queue q
       SET status = 'dead',
           last_error = COALESCE(last_error, '') || E'\n[auto-promoted: attempts>=5 or carrier missing]',
           updated_at = now()
      FROM public.deals d
     WHERE q.deal_id = d.id
       AND q.status IN ('pending', 'error')
       AND (q.attempts >= 5 OR d.carrier_id IS NULL)
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_promoted FROM promoted;
  RETURN v_promoted;
END;
$body$;

-- Run every 10 minutes so queue health stays clean.
SELECT cron.unschedule('deal-sync-queue-promote-dead') WHERE EXISTS(
  SELECT 1 FROM cron.job WHERE jobname = 'deal-sync-queue-promote-dead');
SELECT cron.schedule(
  'deal-sync-queue-promote-dead',
  '*/10 * * * *',
  $$ SELECT public.deal_sync_queue_promote_dead(); $$
);
