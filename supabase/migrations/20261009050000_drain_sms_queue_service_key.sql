-- send-sms-via-email now refuses a request without a credential
-- (requireSendAuth, admin_or_manager floor). drain_sms_fallback_queue() was its
-- only pg caller and posted with no Authorization header, so after the gate it
-- would get a 401 that pg_net records and nothing reads. Present the service
-- key the way applicant_login_send does (system_settings.service_role_key).
-- Not scheduled, not executable by anon or authenticated; the queue holds 0
-- rows on 2026-10-09. This keeps the one internal path working, it does not
-- turn anything on.
CREATE OR REPLACE FUNCTION public.drain_sms_fallback_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE v_req bigint; v_key text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_key FROM public.system_settings WHERE key = 'service_role_key';
  IF coalesce(v_key, '') = '' THEN
    RETURN jsonb_build_object('dispatched', false, 'reason', 'service_role_key missing');
  END IF;
  v_req := net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-sms-via-email',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer '||v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
  RETURN jsonb_build_object('dispatched', true, 'request_id', v_req);
END $function$;

REVOKE ALL ON FUNCTION public.drain_sms_fallback_queue() FROM PUBLIC, anon, authenticated;
