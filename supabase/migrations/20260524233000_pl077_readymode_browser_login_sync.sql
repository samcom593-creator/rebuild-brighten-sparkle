-- PL-077 ReadyMode sync: switch Apex from nonexistent REST key mode to
-- browser-login call-log pull mode. Secrets stay in Supabase Edge secrets.

BEGIN;

CREATE TABLE IF NOT EXISTS public.readymode_bot_state (
  id                 integer PRIMARY KEY DEFAULT 1,
  bot_version        text DEFAULT '1.0.0',
  current_mode       text DEFAULT 'AWAITING_WEBHOOK',
  webhook_enabled    boolean DEFAULT false,
  pull_enabled       boolean DEFAULT false,
  last_heartbeat_at  timestamptz,
  last_ingest_at     timestamptz,
  last_audit_at      timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  ingest_total       bigint DEFAULT 0,
  ingest_24h         integer DEFAULT 0,
  CONSTRAINT readymode_bot_state_singleton CHECK (id = 1)
);

INSERT INTO public.readymode_bot_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_settings (key, value, updated_at) VALUES
  ('readymode_api_base_url', 'https://apexfinancial.readymode.com', now()),
  ('readymode_account_id', 'apexfinancial', now()),
  ('readymode_auth_mode', 'browser_login', now()),
  ('readymode_sync_enabled', 'true', now())
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();

UPDATE public.readymode_bot_state
SET current_mode = 'PULL',
    pull_enabled = true,
    last_error = NULL,
    last_error_at = NULL
WHERE id = 1;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'readymode-sync-pull') THEN
      PERFORM cron.unschedule('readymode-sync-pull');
    END IF;

    PERFORM cron.schedule(
      'readymode-sync-pull',
      '*/5 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/readymode-sync',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object('source', 'pg_cron', 'max_pages', 12)
        );
      $cron$
    );
  END IF;
END $$;

COMMIT;
