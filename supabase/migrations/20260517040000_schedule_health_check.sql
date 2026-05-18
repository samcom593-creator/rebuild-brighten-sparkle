-- Schedule system-health-check edge function to actually run every 15 min.
-- Was never scheduled — system_health_logs hadn't been written since
-- 2026-05-16 even though the function exists and works. That's why the
-- SystemHealth page was perpetually showing "critical" from a day-old
-- snapshot even after the underlying crons were fixed.

DO $$ BEGIN
  PERFORM cron.unschedule('apex-system-health-check');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'apex-system-health-check',
    '*/15 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/system-health-check',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$
  );
END $$;
