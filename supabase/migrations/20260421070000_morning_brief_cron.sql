-- Morning brief — 6am CST daily (11:00 UTC)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  PERFORM cron.unschedule('morning-brief') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief');
  PERFORM cron.schedule('morning-brief', '0 11 * * *',
    $c$SELECT public.run_automation_job('morning-brief','morning-brief','{}'::jsonb)$c$);
END $$;
