-- PL-066: Schedule auto-population for live policy drafts + post-test follow-ups.
-- - Edge function writes idempotent calendar_events rows with source='schedule-auto-populate'.
-- - Daily cron asks the edge function to refresh the next 45 days.

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_schedule_auto_external
  ON public.calendar_events(source, external_id)
  WHERE source = 'schedule-auto-populate' AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_schedule_auto_kind
  ON public.calendar_events ((metadata->>'kind'), starts_at)
  WHERE source = 'schedule-auto-populate';

CREATE OR REPLACE VIEW public.v_schedule_auto_events AS
SELECT
  id,
  title,
  starts_at,
  ends_at,
  status,
  user_id,
  external_id,
  metadata,
  metadata->>'kind' AS kind,
  metadata->>'person_name' AS person_name,
  metadata->>'manager_name' AS manager_name,
  created_at,
  updated_at
FROM public.calendar_events
WHERE source = 'schedule-auto-populate';

GRANT SELECT ON public.v_schedule_auto_events TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_auto_populate_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_base text;
  v_key text;
BEGIN
  SELECT value INTO v_base FROM public.system_settings WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.system_settings WHERE key = 'service_role_key';

  IF v_base IS NULL OR v_key IS NULL THEN
    INSERT INTO public.automation_run_log (job_name, status, error, completed_at)
    VALUES (
      'apex-schedule-auto-populate',
      'error',
      'Missing system_settings.supabase_url or system_settings.service_role_key',
      now()
    );
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_base || '/functions/v1/schedule-auto-populate',
    body := jsonb_build_object('lookahead_days', 45, 'source', 'cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'x-automation-job', 'apex-schedule-auto-populate'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_auto_populate_tick() TO service_role, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-schedule-auto-populate') THEN
    PERFORM cron.unschedule('apex-schedule-auto-populate');
  END IF;
END $$;

SELECT cron.schedule(
  'apex-schedule-auto-populate',
  '11 12 * * *',
  $$SELECT public.schedule_auto_populate_tick();$$
);
