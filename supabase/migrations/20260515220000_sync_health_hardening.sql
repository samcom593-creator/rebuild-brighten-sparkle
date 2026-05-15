-- 2026-05-15 — Sync Health hardening
--
-- 1. v_sync_health gains four new sources:
--      readymode_inventory      — system_settings.readymode_available_leads + _updated_at
--      email_logs               — email_delivery_log most recent
--      sms_logs                 — sms_send_guard most recent
--      automation_logs          — automation_run_log most recent
--    Plus an `agentlink_upstream` source that ONLY reads the cookie-pull
--    log (not coalesced with insuracloud) — so the operator can see the
--    transport-level failure even when data is fresh via the API path.
--
-- 2. refresh_sync_health() is locked to service_role. anon/authenticated
--    no longer have EXECUTE — the function only writes a heartbeat into
--    system_settings and there's zero reason a public visitor should be
--    able to invoke it.
--
-- 3. The view exposes is_partial (true when transport is fresh but a
--    twinned upstream is stale, e.g. insuracloud green but agentlink
--    cookie path silently dead) and action_required (short string the
--    UI can show under the source row).
--
-- Idempotent.

BEGIN;

CREATE OR REPLACE VIEW public.v_sync_health AS
WITH ic AS (
  SELECT
    (SELECT created_at FROM public.insuracloud_sync_log ORDER BY created_at DESC LIMIT 1) AS last_attempt,
    (SELECT created_at FROM public.insuracloud_sync_log WHERE COALESCE(status, 'success') NOT ILIKE '%error%' ORDER BY created_at DESC LIMIT 1) AS last_success,
    (SELECT status FROM public.insuracloud_sync_log ORDER BY created_at DESC LIMIT 1) AS last_status,
    (SELECT error_message FROM public.insuracloud_sync_log WHERE error_message IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS last_error,
    (SELECT records_synced FROM public.insuracloud_sync_log ORDER BY created_at DESC LIMIT 1) AS last_records
),
al AS (
  SELECT
    (SELECT started_at FROM public.agentlink_sync_log ORDER BY started_at DESC LIMIT 1) AS last_attempt,
    (SELECT finished_at FROM public.agentlink_sync_log WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1) AS last_success,
    (SELECT status FROM public.agentlink_sync_log ORDER BY started_at DESC LIMIT 1) AS last_status,
    (SELECT error_message FROM public.agentlink_sync_log WHERE error_message IS NOT NULL ORDER BY started_at DESC LIMIT 1) AS last_error
),
rm AS (
  SELECT
    (SELECT updated_at FROM public.system_settings WHERE key = 'readymode_available_leads' LIMIT 1) AS last_attempt,
    (SELECT updated_at FROM public.system_settings WHERE key = 'readymode_available_leads' LIMIT 1) AS last_success,
    (SELECT value FROM public.system_settings WHERE key = 'readymode_available_leads' LIMIT 1) AS count_value
),
sources AS (
  -- Operator-facing "AgentLink upstream is fresh" — coalesces transports.
  SELECT 'agentlink'::text AS source,
         GREATEST((SELECT last_attempt FROM al), (SELECT last_attempt FROM ic)) AS last_attempt_at,
         GREATEST((SELECT last_success FROM al), (SELECT last_success FROM ic)) AS last_success_at,
         'ok'::text AS last_status,
         NULL::text AS last_error,
         15::int AS stale_threshold_minutes,
         -- Partial = upstream looks fresh, but the cookie transport itself
         -- is dead (>1h since last cookie-pull success). Lets the dashboard
         -- show "data fresh / cookie needs rotation".
         CASE WHEN (SELECT last_success FROM al) IS NULL THEN true
              WHEN (SELECT last_success FROM ic) > (SELECT last_success FROM al)
                   + INTERVAL '1 hour' THEN true
              ELSE false END AS is_partial,
         CASE WHEN (SELECT last_success FROM al) IS NULL
                OR (SELECT last_success FROM ic) > (SELECT last_success FROM al)
                   + INTERVAL '6 hours'
              THEN 'Rotate AgentLink browser cookie at /dashboard/agentlink-sync'
              ELSE NULL END AS action_required
  UNION ALL
  -- The cookie-only transport, exposed as a separate row so operators
  -- can see WHEN the cookie last worked.
  SELECT 'agentlink_cookie_pull',
         (SELECT last_attempt FROM al),
         (SELECT last_success FROM al),
         COALESCE((SELECT last_status FROM al), 'never_run'),
         (SELECT last_error FROM al),
         60,
         false,
         CASE WHEN (SELECT last_success FROM al) IS NULL
                OR (SELECT last_success FROM al) < NOW() - INTERVAL '6 hours'
              THEN 'Cookie likely expired — rotate from a logged-in AgentLink tab'
              ELSE NULL END
  UNION ALL
  -- The Bearer-token transport — primary path, runs automatically.
  SELECT 'insuracloud_api_pull',
         (SELECT last_attempt FROM ic),
         (SELECT last_success FROM ic),
         COALESCE((SELECT last_status FROM ic), 'never_run'),
         (SELECT last_error FROM ic),
         15,
         false,
         CASE WHEN (SELECT last_success FROM ic) IS NULL
                OR (SELECT last_success FROM ic) < NOW() - INTERVAL '30 minutes'
              THEN 'Check insuracloud-sync function logs + per-agent insuracloud_api_token rows'
              ELSE NULL END
  UNION ALL
  -- ReadyMode inventory
  SELECT 'readymode_inventory',
         (SELECT last_attempt FROM rm),
         (SELECT last_success FROM rm),
         CASE WHEN (SELECT count_value FROM rm) IS NULL THEN 'never_configured' ELSE 'ok' END,
         NULL,
         60,
         false,
         CASE WHEN (SELECT count_value FROM rm) IS NULL
              THEN 'ReadyMode inventory not wired — UI shows unavailable until system_settings.readymode_available_leads is populated by a sync'
              WHEN (SELECT last_success FROM rm) < NOW() - INTERVAL '1 hour'
              THEN 'ReadyMode inventory > 1h stale — verify the upstream sync job'
              ELSE NULL END
  UNION ALL
  SELECT 'stripe_lead_purchases',
         (SELECT charged_at FROM public.lead_purchases ORDER BY charged_at DESC LIMIT 1),
         (SELECT charged_at FROM public.lead_purchases ORDER BY charged_at DESC LIMIT 1),
         'ok',
         NULL,
         24 * 60,
         false,
         NULL
  UNION ALL
  SELECT 'email_logs',
         (SELECT created_at FROM public.email_delivery_log ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.email_delivery_log ORDER BY created_at DESC LIMIT 1),
         'ok',
         NULL,
         24 * 60,
         false,
         NULL
  UNION ALL
  SELECT 'sms_logs',
         -- sms_send_guard tracks `last_sent_at` per phone, not created_at.
         (SELECT last_sent_at FROM public.sms_send_guard ORDER BY last_sent_at DESC LIMIT 1),
         (SELECT last_sent_at FROM public.sms_send_guard ORDER BY last_sent_at DESC LIMIT 1),
         'ok',
         NULL,
         24 * 60,
         false,
         NULL
  UNION ALL
  SELECT 'automation_logs',
         (SELECT created_at FROM public.automation_run_log ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.automation_run_log ORDER BY created_at DESC LIMIT 1),
         'ok',
         NULL,
         60,
         false,
         NULL
  UNION ALL
  SELECT 'notifications',
         (SELECT created_at FROM public.notification_log ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.notification_log ORDER BY created_at DESC LIMIT 1),
         'ok',
         NULL,
         60,
         false,
         NULL
  UNION ALL
  SELECT 'seminar_reminders',
         (SELECT created_at FROM public.idempotency_keys WHERE idempotency_key LIKE 'seminar_reminder:%' ORDER BY created_at DESC LIMIT 1),
         (SELECT created_at FROM public.idempotency_keys WHERE idempotency_key LIKE 'seminar_reminder:%' ORDER BY created_at DESC LIMIT 1),
         'ok',
         NULL,
         24 * 60,
         false,
         NULL
  UNION ALL
  SELECT 'github_external_cron',
         (SELECT (value)::timestamptz FROM public.system_settings WHERE key = 'last_external_cron_run' LIMIT 1),
         (SELECT (value)::timestamptz FROM public.system_settings WHERE key = 'last_external_cron_run' LIMIT 1),
         'ok',
         NULL,
         20,
         false,
         NULL
  UNION ALL
  SELECT 'supabase_pg_cron',
         (SELECT MAX(start_time) FROM cron.job_run_details),
         (SELECT MAX(start_time) FROM cron.job_run_details WHERE status = 'succeeded'),
         CASE WHEN (SELECT MAX(start_time) FROM cron.job_run_details) IS NULL THEN 'never_run' ELSE 'ok' END,
         NULL,
         20,
         false,
         CASE WHEN (SELECT MAX(start_time) FROM cron.job_run_details) IS NULL
              THEN 'pg_cron bgworker is asleep — toggle pg_cron extension off→on in Supabase Dashboard → Database → Extensions'
              ELSE NULL END
)
SELECT
  source,
  last_attempt_at,
  last_success_at,
  last_status,
  last_error,
  stale_threshold_minutes,
  is_partial,
  action_required,
  CASE WHEN last_success_at IS NULL THEN NULL
       ELSE EXTRACT(EPOCH FROM (NOW() - last_success_at))::int / 60 END AS stale_minutes,
  CASE WHEN last_success_at IS NULL THEN true
       WHEN EXTRACT(EPOCH FROM (NOW() - last_success_at))::int / 60 > stale_threshold_minutes THEN true
       ELSE false END AS is_stale
FROM sources;

GRANT SELECT ON public.v_sync_health TO authenticated;

-- Lock refresh_sync_health() to service_role only. The function writes a
-- heartbeat row to system_settings and must NOT be a public anon endpoint.
REVOKE EXECUTE ON FUNCTION public.refresh_sync_health() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_sync_health() TO service_role;

-- sync_health_summary() is rebuilt to expose the new fields too.
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
      'last_attempt_at', last_attempt_at,
      'last_success_at', last_success_at,
      'last_status', last_status,
      'last_error', last_error,
      'stale_minutes', stale_minutes,
      'stale_threshold_minutes', stale_threshold_minutes,
      'is_stale', is_stale,
      'is_partial', is_partial,
      'action_required', action_required
    ) ORDER BY source),
    'any_stale', bool_or(is_stale),
    'any_partial', bool_or(is_partial),
    'stale_count', COUNT(*) FILTER (WHERE is_stale),
    'partial_count', COUNT(*) FILTER (WHERE is_partial)
  )
  FROM public.v_sync_health;
$$;

GRANT EXECUTE ON FUNCTION public.sync_health_summary() TO authenticated;

COMMIT;
