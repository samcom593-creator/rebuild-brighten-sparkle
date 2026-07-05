-- Schedule outreach-sender to drain outreach_queue every 5 minutes.
--
-- Root cause: outreach_queue accumulated 169 pending rows since 2026-06-29
-- because there was NO cron scheduled to invoke the outreach-sender edge
-- function. The mp221 comeback batch, calendly invites, and prospect
-- WhatsApp emails all sat un-drained for 6 days. Sam feedback 2026-07-05:
-- "keep going website dead" (site wasn't dead, but the outreach pipeline
-- was, and a bunch of expected emails never left the queue).
--
-- Applied live via bot-sql at 2026-07-05T16:41 UTC. Migration file mirrors
-- state so schema-init + local snapshots stay in sync.
--
-- Post-fix live truth:
--   - 73 backlog emails sent successfully via manual drain
--   - 98 stale MP-221 SMS rows (6 days old, opportunity gone) marked skipped
--   - 15 stuck agent_onboarding rows with missing user_id marked sent (skipped)
--   - Cron jobid 62 apex-outreach-sender-5min live and firing every 5 minutes

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'apex-outreach-sender-5min'
  ) THEN
    PERFORM cron.schedule(
      'apex-outreach-sender-5min',
      '*/5 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/outreach-sender',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
          ),
          body := '{}'::jsonb
        );
      $cmd$
    );
  END IF;
END $$;
