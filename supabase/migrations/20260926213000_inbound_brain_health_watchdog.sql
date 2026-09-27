-- Always-on watchdog for the inbound DM routing brain (manychat-webhook).
-- Sam: "this has to be running at all times, not just when tokens are down."
-- The brain is serverless (no session/token dependency), but a bad deploy could
-- take it dark silently. This pings its authenticated health no-op every 5 min
-- and pages Sam's phone ONLY if the responder itself is unreachable/errors — it
-- never pages on quiet traffic (no cry-wolf). Secret read from Vault by name; if
-- absent the function 401s and pages no one (safe no-op).
select cron.schedule(
  'apex-inbound-brain-health-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/cron-inbound-brain-health',
    headers := jsonb_build_object(
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='inbound_health_secret' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);
