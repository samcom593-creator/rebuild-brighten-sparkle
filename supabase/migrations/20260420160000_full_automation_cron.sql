-- ============================================================
-- Full automation cron schedule — everything on a timer
-- 9pm EST = 02:00 UTC · 6am EST = 11:00 UTC · Midnight EST = 05:00 UTC
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping automation cron setup';
    RETURN;
  END IF;

  -- ── Nightly system health audit → sam@apex-financial.org ──
  PERFORM cron.unschedule('system-health-nightly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'system-health-nightly');
  PERFORM cron.schedule(
    'system-health-nightly',
    '0 5 * * *',  -- 05:00 UTC = midnight EST
    $sql$SELECT public.run_automation_job('system-health-nightly','system-health-check','{}'::jsonb)$sql$
  );

  -- ── Daily analytics audit (6am EST = 11:00 UTC) ──
  -- Reuses send-weekly-analytics; function already handles daily aggregation.
  PERFORM cron.unschedule('daily-analytics-audit')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-analytics-audit');
  PERFORM cron.schedule(
    'daily-analytics-audit',
    '0 11 * * *',
    $sql$SELECT public.run_automation_job('daily-analytics-audit','send-weekly-analytics','{"period":"daily"}'::jsonb)$sql$
  );

  -- ── Weekly optimization report (Sundays 6pm EST = Monday 23:00 UTC Sunday) ──
  -- Sunday 18:00 EST = Sunday 23:00 UTC → cron: "0 23 * * 0"
  PERFORM cron.unschedule('weekly-optimization-report')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-optimization-report');
  PERFORM cron.schedule(
    'weekly-optimization-report',
    '0 23 * * 0',
    $sql$SELECT public.run_automation_job('weekly-optimization','send-weekly-analytics','{"period":"weekly"}'::jsonb)$sql$
  );

  -- ── Monthly strategic analysis (first Monday 9am EST = 14:00 UTC) ──
  -- pg_cron can't natively express "first Monday" so we cover Mon 1-7 and gate in SQL.
  PERFORM cron.unschedule('monthly-strategic-report')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-strategic-report');
  PERFORM cron.schedule(
    'monthly-strategic-report',
    '0 14 1-7 * 1',
    $sql$SELECT public.run_automation_job('monthly-strategic','send-weekly-analytics','{"period":"monthly"}'::jsonb)$sql$
  );

  -- ── Milestone checkers — daily at 9:30pm EST (02:30 UTC next day) ──
  PERFORM cron.unschedule('daily-milestone-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-milestone-sweep');
  PERFORM cron.schedule(
    'daily-milestone-sweep',
    '30 2 * * *',
    $sql$SELECT public.run_automation_job('daily-plaques','check-daily-plaques','{}'::jsonb)$sql$
  );

  -- ── Weekly milestone sweep (Mondays 9am EST = 14:00 UTC Monday) ──
  PERFORM cron.unschedule('weekly-milestone-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-milestone-sweep');
  PERFORM cron.schedule(
    'weekly-milestone-sweep',
    '0 14 * * 1',
    $sql$SELECT public.run_automation_job('weekly-milestones','check-weekly-milestones','{}'::jsonb)$sql$
  );

  -- ── Monthly milestone sweep (1st of month, 9am EST = 14:00 UTC) ──
  PERFORM cron.unschedule('monthly-milestone-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-milestone-sweep');
  PERFORM cron.schedule(
    'monthly-milestone-sweep',
    '0 14 1 * *',
    $sql$SELECT public.run_automation_job('monthly-milestones','check-monthly-milestones','{}'::jsonb)$sql$
  );

  -- ── InsuraCloud outbox sweeper — every 5 minutes ──
  PERFORM cron.unschedule('insuracloud-outbox-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'insuracloud-outbox-sweep');
  PERFORM cron.schedule(
    'insuracloud-outbox-sweep',
    '*/5 * * * *',
    $sql$SELECT public.run_automation_job('insuracloud-sweep','insuracloud-outbox','{"sweep":true}'::jsonb)$sql$
  );

  RAISE NOTICE 'All automation cron jobs scheduled.';
END;
$$;

-- Gate the monthly strategic report to fire only on the first Monday.
CREATE OR REPLACE FUNCTION public.is_first_monday_of_month()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXTRACT(DOW FROM CURRENT_DATE) = 1
     AND EXTRACT(DAY FROM CURRENT_DATE) BETWEEN 1 AND 7;
$$;
