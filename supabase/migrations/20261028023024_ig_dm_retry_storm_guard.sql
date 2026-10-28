-- MP-305 wave 0 (applied live via Supabase MCP 2026-10-28): stop the Instagram DM retry storm.
-- send-instagram-dm re-queued a FRESH row on every Meta failure and dm_send_retry re-sent every
-- queued row younger than 23h, so permanent errors ("outside of allowed window", "Invalid message id")
-- became an infinite loop: 1,028 of 1,067 outbound rows in 7d were re-sends, one person got 173 attempts.
UPDATE public.inbox_messages
SET raw_payload = raw_payload || jsonb_build_object('queued','dead','dead_reason','non_retryable_meta_error','settled_at', now()::text,'settled_by','MP-305 ig_dm_retry_storm_guard')
WHERE source = 'instagram' AND direction = 'outbound' AND raw_payload->>'queued' = 'true'
  AND COALESCE(raw_payload->>'error','') ~* '(outside of allowed window|Invalid message id|unknown error occurred)';

CREATE OR REPLACE FUNCTION public.dm_send_retry()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_svc_url text; v_svc_key text; v_attempted int := 0; v_drained int := 0; v_skipped_capped int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;
  FOR r IN
    SELECT id, external_id, body, sender_handle FROM public.inbox_messages m
    WHERE source = 'instagram' AND direction = 'outbound' AND auto_replied = false
      AND COALESCE(raw_payload->>'queued', 'false') = 'true'
      AND COALESCE(raw_payload->>'error','') !~* '(outside of allowed window|Invalid message id|unknown error occurred)'
      AND created_at > NOW() - INTERVAL '23 hours'
    ORDER BY created_at ASC LIMIT 25
  LOOP
    v_attempted := v_attempted + 1;
    IF (SELECT count(*) FROM public.inbox_messages x WHERE x.source='instagram' AND x.direction='outbound'
        AND x.sender_handle = r.sender_handle AND x.raw_payload->>'drained_at' IS NOT NULL AND x.created_at > NOW() - INTERVAL '24 hours') >= 3 THEN
      UPDATE public.inbox_messages SET raw_payload = raw_payload || jsonb_build_object('queued','dead','dead_reason','per_recipient_cap_24h','settled_at', now()::text) WHERE id = r.id;
      v_skipped_capped := v_skipped_capped + 1; CONTINUE;
    END IF;
    IF v_svc_key IS NOT NULL THEN
      PERFORM net.http_post(url := v_svc_url || '/functions/v1/send-instagram-dm',
        body := jsonb_build_object('recipient_id', r.external_id, 'message', r.body),
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
      UPDATE public.inbox_messages SET auto_replied = true, raw_payload = raw_payload || jsonb_build_object('drained_at', NOW()::text) WHERE id = r.id;
      v_drained := v_drained + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('attempted', v_attempted, 'drained', v_drained, 'skipped_capped', v_skipped_capped);
END; $function$;
