-- ============================================================
-- Overseer bot: hourly self-audit + auto-heal
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;

  PERFORM cron.unschedule('overseer-bot')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overseer-bot');
  PERFORM cron.schedule(
    'overseer-bot',
    '0 * * * *',   -- top of every hour
    $sql$SELECT public.run_automation_job('overseer-bot','overseer-bot','{}'::jsonb)$sql$
  );
END $$;
