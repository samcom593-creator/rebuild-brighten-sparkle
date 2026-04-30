-- ════════════════════════════════════════════════════════════════════════
-- Automation Hub fix — sync automation_settings from cron.job_run_details
-- Every row on /dashboard/automation was showing "never run" because the
-- rows were seeded once and never connected to the real cron log. This
-- function matches human-friendly automation names to cron jobnames and
-- pulls the latest run from Postgres's built-in pg_cron log every 5 min.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_automation_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $fn$
DECLARE v_updated int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH mapping(name, jobname) AS (VALUES
    ('Abandoned Check-in',    'check-abandoned-applications-frequent'),
    ('Daily Churn Check',     'apex-churn-risk'),
    ('Daily Spotlight',       'apex-daily-plaques'),
    ('Discord Webhook',       'webhook-health-check'),
    ('Licensing Sequence',    'licensing-weekly-nudge'),
    ('Low Close Rate',        'apex-production-gaps'),
    ('Manager Digest',        'admin-daily-summary-9pm-cst'),
    ('Monthly Milestones',    'apex-monthly-milestones'),
    ('No Deal Today',         'check-monthly-milestones-1st'),
    ('Seminar Reminders',     'attendance-reminder-meeting-930am'),
    ('Streak Milestones',     'apex-streak-milestones'),
    ('Weekly Milestones',     'apex-weekly-milestones'),
    ('Weekly Coaching',       'apex-evening-report')),
  latest AS (
    SELECT m.name, d.start_time, d.status, d.return_message
    FROM mapping m
    JOIN cron.job j ON j.jobname = m.jobname
    JOIN LATERAL (
      SELECT start_time, status, return_message
      FROM cron.job_run_details d0 WHERE d0.jobid = j.jobid
      ORDER BY start_time DESC LIMIT 1) d ON true),
  upd AS (
    UPDATE public.automation_settings a
    SET last_run_at = latest.start_time,
        last_status = CASE
          WHEN latest.status = 'succeeded' THEN 'success'
          WHEN latest.status = 'failed' THEN 'error'
          ELSE latest.status END,
        last_affected_count = 0
    FROM latest WHERE a.name = latest.name
    RETURNING a.id)
  SELECT COUNT(*)::int INTO v_updated FROM upd;
  RETURN jsonb_build_object('updated', v_updated);
END $fn$;
GRANT EXECUTE ON FUNCTION public.sync_automation_status() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='sync-automation-status') THEN
    PERFORM cron.unschedule('sync-automation-status'); END IF;
  PERFORM cron.schedule('sync-automation-status', '*/5 * * * *',
    $j$ SELECT public.sync_automation_status(); $j$);
END $outer$;
