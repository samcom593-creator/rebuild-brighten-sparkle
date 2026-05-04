-- ════════════════════════════════════════════════════════════════════════
-- SMS via carrier email-gateways — Twilio-free, free-forever
-- Fan-out across 5 major US carriers when carrier is unknown.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.drain_sms_fallback_queue()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_req bigint;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_req := net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-sms-via-email',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
  RETURN jsonb_build_object('dispatched', true, 'request_id', v_req);
END $fn$;
GRANT EXECUTE ON FUNCTION public.drain_sms_fallback_queue() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='sms-fallback-drainer') THEN
    PERFORM cron.unschedule('sms-fallback-drainer'); END IF;
  PERFORM cron.schedule('sms-fallback-drainer', '*/2 * * * *',
    $j$ SELECT public.drain_sms_fallback_queue(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.queue_sms(p_phone text, p_body text, p_carrier text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.sms_fallback_queue (phone, body, carrier_hint)
  VALUES (p_phone, p_body, p_carrier) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
GRANT EXECUTE ON FUNCTION public.queue_sms(text,text,text) TO service_role, authenticated;
