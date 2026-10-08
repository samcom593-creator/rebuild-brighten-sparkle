-- PL-WIB-SEND-INSTAGRAM-DM-AUTH (2026-10-08). Hand-applied via bot-sql before the
-- send-instagram-dm gate was pushed, so there was no window where the gate refused
-- a real caller; CREATE OR REPLACE makes the CI re-apply a no-op.
--
-- dm_send_retry is the only pg function that posts to send-instagram-dm. It sent
-- system_settings.supabase_anon_key, which ships in the browser bundle and which
-- requireSendAuth refuses. It now sends system_settings.service_role_key, the key
-- the three edge-function callers (instagram-webhook, instagram-comments-backfill,
-- instagram-dm-replay) already present.
--
-- No cron job schedules dm_send_retry today (0 rows in cron.job, 0 runs in
-- cron.job_run_details back to 2026-10-01, 0 edge/postgres log hits in 24h). It is
-- switched anyway so re-scheduling it cannot 401 in silence.
--
-- Body is pg_get_functiondef() of the live function with only the key lookup
-- changed, not a reconstruction from older migrations.

CREATE OR REPLACE FUNCTION public.dm_send_retry()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_svc_url text;
  v_svc_key text;
  v_attempted int := 0;
  v_drained int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  FOR r IN
    SELECT id, external_id, body
    FROM public.inbox_messages
    WHERE source = 'instagram'
      AND direction = 'outbound'
      AND auto_replied = false
      AND COALESCE(raw_payload->>'queued', 'false') = 'true'
      AND created_at > NOW() - INTERVAL '23 hours'   -- 24h Meta window
    ORDER BY created_at ASC
    LIMIT 25
  LOOP
    v_attempted := v_attempted + 1;
    IF v_svc_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-instagram-dm',
        body := jsonb_build_object('recipient_id', r.external_id, 'message', r.body),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,
          'apikey', v_svc_key));
      -- Optimistically mark as sent. If the send still fails, the function
      -- itself re-queues a fresh row.
      UPDATE public.inbox_messages
      SET auto_replied = true,
          raw_payload = raw_payload || jsonb_build_object('drained_at', NOW()::text)
      WHERE id = r.id;
      v_drained := v_drained + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('attempted', v_attempted, 'drained', v_drained);
END;
$function$;
