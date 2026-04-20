-- ============================================================
-- Backlog nudge crons — work the 175 untouched apps + 86 stuck agents
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping backlog nudge cron setup';
    RETURN;
  END IF;

  -- ── Unworked applications sweep — daily 6am EST (11:00 UTC) ──
  PERFORM cron.unschedule('nudge-unworked-applications')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nudge-unworked-applications');
  PERFORM cron.schedule(
    'nudge-unworked-applications',
    '0 11 * * *',
    $sql$SELECT public.run_automation_job('nudge-unworked-applications','nudge-unworked-applications','{}'::jsonb)$sql$
  );

  -- ── Stuck-in-onboarding sweep — daily 9am EST (14:00 UTC) ──
  PERFORM cron.unschedule('onboarding-nudge-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onboarding-nudge-sweep');
  PERFORM cron.schedule(
    'onboarding-nudge-sweep',
    '0 14 * * *',
    $sql$SELECT public.run_automation_job('onboarding-nudge-sweep','onboarding-nudge-sweep','{}'::jsonb)$sql$
  );

  RAISE NOTICE 'Backlog nudge cron jobs scheduled.';
END $$;
