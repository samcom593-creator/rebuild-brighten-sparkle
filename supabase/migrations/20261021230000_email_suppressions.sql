-- PL-WIB-RESEND-SUPPRESSION (2026-10-21)
-- Resend's suppression list, mirrored so _shared/email.ts#sendEmail can skip it.
-- Written only by resend-suppression-sync (service role); read only by sendEmail
-- (service role). No anon/authenticated access: it is a list of addresses.
--
-- Why: Resend accepts a send to a suppressed address, returns an id, and never
-- attempts it. Every sender logged those as sent. 7d before this: 10 non-gateway
-- addresses suppressed 2-7x each, numbers-reminder hitting one active agent row
-- daily with email_status='sent'.

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email           text PRIMARY KEY CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
  last_event      text NOT NULL CHECK (last_event = 'suppressed'),
  resend_email_id text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_suppressions IS
  'Addresses Resend suppressed on their latest send (hard bounce or complaint). sendEmail refuses an address with last_seen_at in the last 30 days; resend-suppression-sync deletes the row once a send is delivered.';

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_suppressions TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-resend-suppression-sync') THEN
    PERFORM cron.unschedule('apex-resend-suppression-sync');
  END IF;
  -- :41 keeps clear of the :00 numbers-reminder and the */15 health check.
  PERFORM cron.schedule('apex-resend-suppression-sync', '41 * * * *', $j$
    SELECT net.http_post(
      url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/resend-suppression-sync',
      headers := jsonb_build_object('Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),'Content-Type','application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
  $j$);
END $$;
