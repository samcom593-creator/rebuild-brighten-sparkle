
-- 1. Automation run log
CREATE TABLE IF NOT EXISTS public.automation_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  http_status integer,
  response_body jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_run_log_job_time ON public.automation_run_log(job_name, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_run_log_status ON public.automation_run_log(status, triggered_at DESC);

ALTER TABLE public.automation_run_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_log_admin_all" ON public.automation_run_log;
CREATE POLICY "automation_log_admin_all" ON public.automation_run_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Wrapper function
CREATE OR REPLACE FUNCTION public.run_automation_job(
  p_job_name text,
  p_function_name text,
  p_body jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_log_id uuid;
  v_url text;
  v_service_key text;
  v_start timestamptz;
BEGIN
  v_start := clock_timestamp();

  INSERT INTO public.automation_run_log (job_name, status)
  VALUES (p_job_name, 'running')
  RETURNING id INTO v_log_id;

  v_url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/' || p_function_name;
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_service_key IS NULL OR v_service_key = '' THEN
    UPDATE public.automation_run_log
    SET status = 'error',
        error = 'app.settings.service_role_key not set. Run: ALTER DATABASE postgres SET app.settings.service_role_key = ''YOUR_SERVICE_KEY'';',
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
      'Authorization', 'Bearer ' || v_service_key,
      'x-automation-job', p_job_name,
      'x-automation-log-id', v_log_id::text
    )
  );

  UPDATE public.automation_run_log
  SET status = 'success',
      completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  WHERE id = v_log_id;

  RETURN v_log_id;
EXCEPTION WHEN others THEN
  UPDATE public.automation_run_log
  SET status = 'error',
      error = SQLERRM,
      completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  WHERE id = v_log_id;
  RAISE;
END;
$$;

-- 3. Idempotent unschedule of any prior apex-* jobs
DO $$
DECLARE
  v_job text;
BEGIN
  FOR v_job IN SELECT jobname FROM cron.job WHERE jobname LIKE 'apex-%'
  LOOP
    PERFORM cron.unschedule(v_job);
  END LOOP;
END $$;

-- 4. Schedule jobs
SELECT cron.schedule('apex-daily-plaques', '0 5 * * *',
  $$SELECT public.run_automation_job('apex-daily-plaques', 'check-daily-plaques')$$);
SELECT cron.schedule('apex-daily-awards', '5 5 * * *',
  $$SELECT public.run_automation_job('apex-daily-awards', 'check-daily-awards')$$);
SELECT cron.schedule('apex-streak-milestones', '10 5 * * *',
  $$SELECT public.run_automation_job('apex-streak-milestones', 'check-streak-milestones')$$);
SELECT cron.schedule('apex-comeback-milestones', '15 5 * * *',
  $$SELECT public.run_automation_job('apex-comeback-milestones', 'check-comeback-milestones')$$);
SELECT cron.schedule('apex-weekly-milestones', '30 6 * * 1',
  $$SELECT public.run_automation_job('apex-weekly-milestones', 'check-weekly-milestones')$$);
SELECT cron.schedule('apex-monthly-milestones', '0 7 1 * *',
  $$SELECT public.run_automation_job('apex-monthly-milestones', 'check-monthly-milestones')$$);
SELECT cron.schedule('apex-team-milestones', '30 5 * * *',
  $$SELECT public.run_automation_job('apex-team-milestones', 'check-team-milestones')$$);
SELECT cron.schedule('apex-recruiting-milestones', '35 5 * * *',
  $$SELECT public.run_automation_job('apex-recruiting-milestones', 'check-recruiting-milestones')$$);
SELECT cron.schedule('apex-early-performance', '40 5 * * *',
  $$SELECT public.run_automation_job('apex-early-performance', 'check-early-performance')$$);
SELECT cron.schedule('apex-churn-risk', '0 12 * * *',
  $$SELECT public.run_automation_job('apex-churn-risk', 'check-churn-risk')$$);
SELECT cron.schedule('apex-stale-onboarding', '0 13 * * *',
  $$SELECT public.run_automation_job('apex-stale-onboarding', 'check-stale-onboarding')$$);
SELECT cron.schedule('apex-overdue-tasks', '0 14 * * *',
  $$SELECT public.run_automation_job('apex-overdue-tasks', 'check-overdue-tasks')$$);
SELECT cron.schedule('apex-abandoned-applications', '0 15 * * *',
  $$SELECT public.run_automation_job('apex-abandoned-applications', 'check-abandoned-applications')$$);
SELECT cron.schedule('apex-dropped-leads', '0 16 * * *',
  $$SELECT public.run_automation_job('apex-dropped-leads', 'detect-dropped-leads')$$);
SELECT cron.schedule('apex-ghosted-applicants', '15 16 * * *',
  $$SELECT public.run_automation_job('apex-ghosted-applicants', 'detect-ghosted-applicants')$$);
SELECT cron.schedule('apex-production-gaps', '0 23 * * *',
  $$SELECT public.run_automation_job('apex-production-gaps', 'detect-production-gaps')$$);
SELECT cron.schedule('apex-low-aop-friday', '0 21 * * 5',
  $$SELECT public.run_automation_job('apex-low-aop-friday', 'check-low-aop-friday')$$);
SELECT cron.schedule('apex-detect-duplicates', '0 10 * * *',
  $$SELECT public.run_automation_job('apex-detect-duplicates', 'detect-duplicates')$$);
SELECT cron.schedule('apex-detect-inactive', '0 8 * * *',
  $$SELECT public.run_automation_job('apex-detect-inactive', 'detect-inactive-agents')$$);
SELECT cron.schedule('apex-email-status', '0 */2 * * *',
  $$SELECT public.run_automation_job('apex-email-status', 'check-email-status')$$);
SELECT cron.schedule('apex-insuracloud-sync', '0 13-23,0-5 * * *',
  $$
    SELECT public.run_automation_job(
      'apex-insuracloud-sync-' || a.id::text,
      'sync-insuracloud',
      jsonb_build_object('agentId', a.id)
    )
    FROM public.agents a
    WHERE a.is_deactivated = false
  $$);
SELECT cron.schedule('apex-morning-report', '0 12 * * *',
  $$SELECT public.run_automation_job('apex-morning-report', 'send-sam-morning-report')$$);
SELECT cron.schedule('apex-log-cleanup', '0 3 * * *',
  $$
    DELETE FROM public.automation_run_log WHERE triggered_at < now() - interval '30 days';
    DELETE FROM public.email_delivery_log WHERE created_at < now() - interval '90 days';
  $$);

-- 5. Health view
CREATE OR REPLACE VIEW public.automation_health AS
WITH recent AS (
  SELECT
    job_name,
    MAX(triggered_at) AS last_run,
    COUNT(*) FILTER (WHERE status = 'success') AS success_count_24h,
    COUNT(*) FILTER (WHERE status = 'error') AS error_count_24h,
    COUNT(*) AS total_24h,
    AVG(duration_ms) FILTER (WHERE status = 'success') AS avg_duration_ms,
    MAX(error) FILTER (WHERE status = 'error') AS last_error
  FROM public.automation_run_log
  WHERE triggered_at > now() - interval '24 hours'
  GROUP BY job_name
)
SELECT
  job_name,
  last_run,
  success_count_24h,
  error_count_24h,
  total_24h,
  ROUND(avg_duration_ms)::integer AS avg_duration_ms,
  last_error,
  CASE
    WHEN last_run < now() - interval '2 days' THEN 'stale'
    WHEN error_count_24h > 0 AND success_count_24h = 0 THEN 'broken'
    WHEN error_count_24h > 0 THEN 'flaky'
    ELSE 'healthy'
  END AS health_status
FROM recent;

GRANT SELECT ON public.automation_health TO authenticated;

-- 6. Failure alert trigger
CREATE OR REPLACE FUNCTION public.alert_on_repeated_automation_failures()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recent_errors integer;
  v_recent_successes integer;
BEGIN
  IF NEW.status <> 'error' THEN RETURN NEW; END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'error'),
    COUNT(*) FILTER (WHERE status = 'success')
  INTO v_recent_errors, v_recent_successes
  FROM public.automation_run_log
  WHERE job_name = NEW.job_name
    AND triggered_at > now() - interval '24 hours';

  IF v_recent_errors >= 3 AND v_recent_successes = 0 THEN
    INSERT INTO public.notifications (user_id, title, body, type, priority, created_at)
    SELECT
      ur.user_id,
      'Automation broken: ' || NEW.job_name,
      'Job has failed ' || v_recent_errors || ' times in 24h with 0 successes. Check Automation Health.',
      'system_alert',
      'high',
      now()
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = ur.user_id
          AND n.title = 'Automation broken: ' || NEW.job_name
          AND n.created_at > now() - interval '6 hours'
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_automation_failures ON public.automation_run_log;
CREATE TRIGGER trg_alert_automation_failures
  AFTER INSERT OR UPDATE OF status ON public.automation_run_log
  FOR EACH ROW EXECUTE FUNCTION public.alert_on_repeated_automation_failures();
