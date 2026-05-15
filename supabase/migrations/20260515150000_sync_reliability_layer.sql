-- 2026-05-15 — Sync Reliability Layer
--
-- Sam's loop-breaker. Surfaces every integration's last successful sync,
-- last attempt, status, and "is_stale" flag in a single place so the
-- dashboard can show truth without scattered component math.
--
-- Sources covered:
--   agentlink  — agentlink_sync_log (browser-cookie pull)
--   insuracloud — insuracloud_sync_log (Bearer token pull, autonomous)
--   stripe      — lead_purchases (most recent charged_at)
--   notifications — notification_log (most recent created_at)
--   seminar_reminders — idempotency_keys (most recent seminar_reminder:*)
--   github_cron — system_settings.last_external_cron_run (set by the
--                 refresh_sync_health() function we call from the cron)
--
-- Idempotent.

BEGIN;

CREATE OR REPLACE VIEW public.v_sync_health AS
WITH sources AS (
  SELECT 'agentlink'::text AS source,
         (SELECT started_at FROM public.agentlink_sync_log ORDER BY started_at DESC LIMIT 1) AS last_attempt_at,
         (SELECT finished_at FROM public.agentlink_sync_log WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1) AS last_success_at,
         (SELECT status FROM public.agentlink_sync_log ORDER BY started_at DESC LIMIT 1) AS last_status,
         (SELECT error_message FROM public.agentlink_sync_log WHERE error_message IS NOT NULL ORDER BY started_at DESC LIMIT 1) AS last_error,
         15::int AS stale_threshold_minutes
  UNION ALL
  SELECT 'insuracloud',
         (SELECT created_at FROM public.insuracloud_sync_log ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.insuracloud_sync_log WHERE COALESCE(status, 'ok') NOT ILIKE '%error%' ORDER BY created_at DESC LIMIT 1),
         (SELECT status FROM public.insuracloud_sync_log ORDER BY created_at DESC LIMIT 1),
         (SELECT status FROM public.insuracloud_sync_log WHERE status ILIKE '%error%' ORDER BY created_at DESC LIMIT 1),
         15
  UNION ALL
  SELECT 'stripe_lead_purchases',
         (SELECT charged_at FROM public.lead_purchases ORDER BY charged_at DESC LIMIT 1),
         (SELECT charged_at FROM public.lead_purchases ORDER BY charged_at DESC LIMIT 1),
         'ok',
         NULL,
         24 * 60
  UNION ALL
  SELECT 'notifications',
         (SELECT created_at FROM public.notification_log ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.notification_log ORDER BY created_at DESC LIMIT 1),
         'ok',
         NULL,
         60
  UNION ALL
  SELECT 'seminar_reminders',
         (SELECT created_at FROM public.idempotency_keys WHERE idempotency_key LIKE 'seminar_reminder:%' ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.idempotency_keys WHERE idempotency_key LIKE 'seminar_reminder:%' ORDER BY created_at DESC LIMIT 1),
         'ok',
         NULL,
         24 * 60
  UNION ALL
  SELECT 'github_external_cron',
         (SELECT (value)::timestamptz FROM public.system_settings WHERE key = 'last_external_cron_run' LIMIT 1),
         (SELECT (value)::timestamptz FROM public.system_settings WHERE key = 'last_external_cron_run' LIMIT 1),
         'ok',
         NULL,
         20
)
SELECT
  source,
  last_attempt_at,
  last_success_at,
  last_status,
  last_error,
  stale_threshold_minutes,
  CASE
    WHEN last_success_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (NOW() - last_success_at))::int / 60
  END AS stale_minutes,
  CASE
    WHEN last_success_at IS NULL THEN true
    WHEN EXTRACT(EPOCH FROM (NOW() - last_success_at))::int / 60 > stale_threshold_minutes THEN true
    ELSE false
  END AS is_stale
FROM sources;

GRANT SELECT ON public.v_sync_health TO authenticated;

-- A short JSON-blob RPC for the dashboard banner — single round-trip.
CREATE OR REPLACE FUNCTION public.sync_health_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'as_of', NOW(),
    'sources', jsonb_agg(jsonb_build_object(
      'source', source,
      'last_success_at', last_success_at,
      'last_attempt_at', last_attempt_at,
      'last_status', last_status,
      'last_error', last_error,
      'stale_minutes', stale_minutes,
      'is_stale', is_stale,
      'stale_threshold_minutes', stale_threshold_minutes
    ) ORDER BY source),
    'any_stale', bool_or(is_stale),
    'stale_count', COUNT(*) FILTER (WHERE is_stale)
  )
  FROM public.v_sync_health;
$$;

GRANT EXECUTE ON FUNCTION public.sync_health_summary() TO authenticated;

-- refresh_sync_health() — called by the external GH cron after every tick.
-- Updates a single system_settings row so v_sync_health can see "last
-- external cron run" without a separate table.
CREATE OR REPLACE FUNCTION public.refresh_sync_health()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.system_settings (key, value, updated_at)
  VALUES ('last_external_cron_run', NOW()::text, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_sync_health() TO authenticated, anon;

COMMIT;
