-- Wire the 4 crons referenced by system_health checks to call real edge
-- functions instead of just heartbeating. 2026-05-17.
--
-- Background: system_health_logs was reporting overall_status='critical'
-- because the health checker expected these 4 jobs but they either didn't
-- exist or only stamped timestamps without calling their underlying
-- automation.

DO $$ BEGIN
  PERFORM cron.unschedule('apex-numbers-reminder');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'apex-numbers-reminder',
    '0 21 * * 1-5',  -- 5pm Eastern, M-F
    $cmd$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/numbers-reminder',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cmd$
  );
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('apex-manager-daily-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'apex-manager-daily-digest',
    '0 13 * * 1-6',  -- 8am Central, Mon-Sat
    $cmd$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/manager-daily-digest',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cmd$
  );
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('apex-licensing-sequences');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'apex-licensing-sequences',
    '0 14 * * *',  -- 9am Central, daily
    $cmd$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-bulk-unlicensed-outreach',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cmd$
  );
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('apex-daily-churn-check');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'apex-daily-churn-check',
    '0 12 * * *',  -- 7am Central, daily
    $cmd$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/check-churn-risk',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cmd$
  );
END $$;
