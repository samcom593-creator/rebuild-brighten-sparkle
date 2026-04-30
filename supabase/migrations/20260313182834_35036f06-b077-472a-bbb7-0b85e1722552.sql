DO $$ BEGIN
  PERFORM cron.alter_job(15, schedule := '0 14 * * *');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
