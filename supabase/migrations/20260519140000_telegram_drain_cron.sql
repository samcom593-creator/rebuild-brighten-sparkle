-- APEX Telegram Bot — schedule telegram-drain edge fn via pg_cron every 5 min.
-- Eliminates the laptop dependency on the launchd nudge-runner. The local
-- daemon stays as a backup/dev tool — both paths use the same dedupe + ON
-- CONFLICT guards, so concurrent runs are safe.
--
-- Auth: pg_cron reads a shared secret from system_settings.apex_drain_secret
-- and passes it as the x-apex-drain-secret header. telegram-drain edge fn
-- verifies the header equals its APEX_DRAIN_SHARED_SECRET env var.
--
-- Activation: apex-tg-activate seeds the system_settings.apex_drain_secret
-- to match the edge fn's APEX_DRAIN_SHARED_SECRET. Until that happens, the
-- cron still fires but the edge fn returns 403 — silent no-op, no harm.
--
-- Built: 2026-05-19. Idempotent.

-- =================================================================
-- 1) Default the shared secret if missing (placeholder; activation overwrites)
-- =================================================================
INSERT INTO system_settings(key, value)
VALUES ('apex_drain_secret', 'placeholder_overwritten_at_activation')
ON CONFLICT (key) DO NOTHING;

-- =================================================================
-- 2) SECURITY DEFINER inactivity-queue function (no HTTP — pure SQL)
-- =================================================================
CREATE OR REPLACE FUNCTION public.fn_telegram_queue_inactivity_nudges()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_total int := 0;
  v_added int;
BEGIN
  -- Lobby > 48h
  INSERT INTO telegram_scheduled_messages(chat_id, template_key, scheduled_at, reason, dedupe_key)
  SELECT chat_id, 'nudge.lobby_48h', now(), 'inactivity_lobby_48h',
         'nudge_lobby_48h_' || chat_id || '_' || to_char(now(), 'YYYYMMDD')
    FROM telegram_users
   WHERE stage IN ('lobby', 'applied_unpaid')
     AND NOT opt_out_nudges AND NOT opt_out_all
     AND last_active_at < now() - interval '48 hours'
     AND (inactivity_nudge_sent_at IS NULL OR inactivity_nudge_sent_at < now() - interval '7 days')
  ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  v_total := v_total + v_added;

  -- Applied (paid) > 5d
  INSERT INTO telegram_scheduled_messages(chat_id, template_key, scheduled_at, reason, dedupe_key)
  SELECT chat_id, 'nudge.applied_paid_5d', now(), 'inactivity_applied_paid_5d',
         'nudge_applied_paid_5d_' || chat_id || '_' || to_char(now(), 'YYYYMMDD')
    FROM telegram_users
   WHERE stage = 'applied_paid'
     AND NOT opt_out_nudges AND NOT opt_out_all
     AND last_active_at < now() - interval '5 days'
  ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  v_total := v_total + v_added;

  -- Pre-license enrolled > 7d, no progress
  INSERT INTO telegram_scheduled_messages(chat_id, template_key, scheduled_at, reason, dedupe_key)
  SELECT chat_id, 'nudge.pre_license_studying_7d_no_progress', now(), 'pre_license_7d',
         'nudge_pre_license_7d_' || chat_id || '_' || to_char(now(), 'YYYYMMDD')
    FROM telegram_users
   WHERE stage = 'pre_license_studying'
     AND NOT opt_out_nudges AND NOT opt_out_all
     AND last_active_at < now() - interval '7 days'
  ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  v_total := v_total + v_added;

  RETURN v_total;
END $$;

COMMENT ON FUNCTION public.fn_telegram_queue_inactivity_nudges IS
'Queues inactivity nudges into telegram_scheduled_messages by stage + dwell. Idempotent via dedupe_key. Delivery handled by telegram-drain edge fn.';

-- =================================================================
-- 3) pg_cron schedules
-- =================================================================
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname IN ('telegram_drain_5min', 'telegram_inactivity_queue_15min');

  -- Inactivity sweep every 15 min — pure SQL, no auth needed
  PERFORM cron.schedule(
    'telegram_inactivity_queue_15min',
    '*/15 * * * *',
    $cron$ SELECT public.fn_telegram_queue_inactivity_nudges(); $cron$
  );

  -- Drain every 5 min — calls telegram-drain edge fn via pg_net
  -- Reads the shared secret from system_settings at call time so a rotation
  -- doesn't require recreating the cron job.
  PERFORM cron.schedule(
    'telegram_drain_5min',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/telegram-drain',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-apex-drain-secret', (SELECT value FROM system_settings WHERE key = 'apex_drain_secret' LIMIT 1)
        ),
        body := jsonb_build_object('source', 'pg_cron', 'fired_at', now()::text),
        timeout_milliseconds := 25000
      );
    $cron$
  );
END $$;
