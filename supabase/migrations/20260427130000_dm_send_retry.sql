-- DM send-retry cron. When IG sends fail (no token, expired token, Meta
-- 429, etc.) the message gets queued in inbox_messages with
-- raw_payload->>'queued' = 'true'. This cron walks any queued sends
-- newer than 24h (Meta messaging window) and retries via send-instagram-dm.
-- The moment a token is finally configured, all queued replies blast out.

CREATE OR REPLACE FUNCTION public.dm_send_retry()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_svc_url text;
  v_svc_key text;
  v_attempted int := 0;
  v_drained int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
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
$body$;

DO $$ BEGIN PERFORM cron.unschedule('dm-send-retry'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('dm-send-retry', '*/15 * * * *',
  'SELECT public.dm_send_retry();')::text;
