-- Daily contracting-nudge sweep (MP-CONTRACTING-MGN-LINK). 17:00 UTC = 10:00 Phoenix, inside the
-- team's working morning. The function enforces its own throttle (5 per run, 14-day cooldown,
-- 2 lifetime per person); this job only asks it to run. Pause = select cron.unschedule('apex-contracting-nudge-daily');
select cron.schedule(
  'apex-contracting-nudge-daily',
  '0 17 * * *',
  $$
  select net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/contracting-nudge-sweep',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token' limit 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
