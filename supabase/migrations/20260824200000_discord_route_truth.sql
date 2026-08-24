-- wave-discord-route-truth — discord_route recorded a delivery it never saw.
--
-- Two defects, both found while wiring the Vantage feed.
--
-- 1. FAKE SUCCESS. The function called net.http_post(...) and then, on the very
--    next statement, inserted discord_event_log with http_status = 204. pg_net
--    only QUEUES the request; the response arrives later in net._http_response.
--    So the log recorded "Discord accepted this" for every post, including ones
--    Discord rejected, timed out on, or never received. That is the same class
--    as the 465 fake-success InsuraCloud sync rows: a receipt written before
--    there was anything to receipt.
--
--    Fixed by recording what is actually known at that moment — the request was
--    QUEUED — and storing pg_net's request id so the real outcome can be
--    reconciled from net._http_response afterwards. http_status is left NULL,
--    because "I do not know yet" is a state this table needs to be able to
--    express. It could not before.
--
-- 2. FOUR CHANNELS THAT SILENTLY COLLAPSE INTO ONE. The channel map points at
--    discord_webhook_sales_wins, discord_webhook_hiring_pipeline,
--    discord_webhook_leadership and discord_webhook_system_health. MEASURED:
--    none of those four keys exists in system_settings. Every one falls through
--    to discord_webhook_url, so posts meant for four separate channels have all
--    been landing in the main one with nothing saying so. The fallback is kept
--    (dropping posts would be worse) but it is now RECORDED: the log row says
--    which key was requested and which was actually used, so the collapse is
--    visible instead of invisible.

begin;

create or replace function public.discord_route(p_event_type text, p_entity_id text, p_channel text, p_body jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'net'
as $function$
DECLARE
  v_webhook_key text;
  v_webhook text;
  v_fallback text;
  v_used_key text;
  v_req bigint;
  v_is_dup boolean;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  DECLARE
    v_paused boolean;
    v_allowed boolean;
  BEGIN
    SELECT (value::text::boolean) INTO v_paused FROM public.system_settings WHERE key='discord_notifications_paused';
    IF COALESCE(v_paused, false) THEN
      RETURN jsonb_build_object('skipped','kill_switch','event_type',p_event_type);
    END IF;
    SELECT public.should_post_to_discord(COALESCE(p_channel, 'default'), 5) INTO v_allowed;
    IF NOT v_allowed THEN
      RETURN jsonb_build_object('skipped','rate_limit','event_type',p_event_type,'category',p_channel);
    END IF;
  END;

  IF p_entity_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.discord_event_log
      WHERE event_type = p_event_type AND entity_id = p_entity_id
        AND posted_at > now() - interval '60 minutes'
    ) INTO v_is_dup;
    IF v_is_dup THEN RETURN jsonb_build_object('skipped','dedup','event_type',p_event_type,'entity_id',p_entity_id); END IF;
  END IF;

  v_webhook_key := CASE p_channel
    WHEN 'sales'      THEN 'discord_webhook_sales_wins'
    WHEN 'retention'  THEN 'discord_webhook_retention_alerts'
    WHEN 'hiring'     THEN 'discord_webhook_hiring_pipeline'
    WHEN 'leadership' THEN 'discord_webhook_leadership'
    WHEN 'system'     THEN 'discord_webhook_system_health'
    ELSE 'discord_webhook_url'
  END;

  SELECT value INTO v_webhook  FROM public.system_settings WHERE key = v_webhook_key;
  SELECT value INTO v_fallback FROM public.system_settings WHERE key = 'discord_webhook_url';

  -- Record which key actually carried the post. Four of the five channel keys
  -- do not exist, so without this the collapse into the main channel is silent.
  IF v_webhook IS NOT NULL THEN
    v_used_key := v_webhook_key;
  ELSE
    v_webhook := v_fallback;
    v_used_key := 'discord_webhook_url';
  END IF;

  IF v_webhook IS NULL THEN
    INSERT INTO public.discord_event_log (event_type, entity_id, channel, http_status, payload)
    VALUES (p_event_type, p_entity_id, p_channel, 0,
            jsonb_build_object('error','no_webhook_configured','requested_key',v_webhook_key));
    RETURN jsonb_build_object('error','no_webhook');
  END IF;

  v_req := net.http_post(
    url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := p_body,
    timeout_milliseconds := 10000
  );

  -- http_status stays NULL: the request is queued, not answered. The previous
  -- version wrote 204 here, which was a delivery receipt for something nobody
  -- had observed. net_request_id lets the real outcome be reconciled from
  -- net._http_response later.
  INSERT INTO public.discord_event_log (event_type, entity_id, channel, http_status, payload)
  VALUES (p_event_type, p_entity_id, p_channel, NULL,
          p_body || jsonb_build_object(
            '_delivery', jsonb_build_object(
              'state','queued',
              'net_request_id', v_req,
              'requested_key', v_webhook_key,
              'used_key', v_used_key,
              'fell_back', (v_used_key IS DISTINCT FROM v_webhook_key)
            )));

  RETURN jsonb_build_object('queued', true, 'channel', p_channel,
                            'requested_key', v_webhook_key, 'used_key', v_used_key,
                            'request_id', v_req);
EXCEPTION WHEN others THEN
  INSERT INTO public.discord_event_log (event_type, entity_id, channel, http_status, payload)
  VALUES (p_event_type, p_entity_id, p_channel, -1, jsonb_build_object('error', SQLERRM));
  RAISE;
END $function$;

commit;
