
-- Schedule morning report: 6am CST = 12pm UTC
SELECT cron.schedule(
  'sam-morning-report',
  '0 12 * * *',
  $$SELECT net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/send-sam-morning-report',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
  )$$
);

-- Schedule task overdue check: 8am CST = 2pm UTC
SELECT cron.schedule(
  'task-overdue-check',
  '0 14 * * *',
  $$SELECT net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/check-overdue-tasks',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
  )$$
);
