-- Update cron job to run every 15 minutes instead of once daily
-- This ensures abandoned leads are detected quickly after dropping off

-- First, remove the old daily schedule if it exists
SELECT cron.unschedule('check-abandoned-applications-daily')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-abandoned-applications-daily'
);

-- Create new schedule to run every 15 minutes, 7 AM - 10 PM EST (12:00 - 03:00 UTC next day)
SELECT cron.schedule(
  'check-abandoned-applications-frequent',
  '*/15 * * * *',  -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/check-abandoned-applications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);