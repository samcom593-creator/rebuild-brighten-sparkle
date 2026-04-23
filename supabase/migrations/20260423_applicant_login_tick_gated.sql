-- ════════════════════════════════════════════════════════════════════════
-- Gated applicant-login tick. Problem v2 had: the drain cron would burn
-- against a 404 when the applicant-magic-link edge fn hadn't deployed yet,
-- marking every queued row 'error' before it could ever succeed.
--
-- Fix: separate queuing from firing. The trigger only INSERTs queue rows.
-- Every 3 min a tick probes the edge fn via pg_net; if it returns 404, the
-- tick returns 'skipped' and waits. The moment it returns anything else,
-- the next tick runs fire/drain/send end-to-end.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_applicant_autoprovision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  IF NEW.terminated_at IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.applicant_login_queue (application_id, email, first_name, status)
  VALUES (NEW.id, NEW.email, NEW.first_name, 'queued')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.applicant_login_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_base text; v_req bigint; v_status int; i int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  IF v_base IS NULL THEN RETURN jsonb_build_object('skipped','no_url'); END IF;

  v_req := net.http_post(
    url := v_base || '/functions/v1/applicant-magic-link',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('email','__probe__@apex'),
    timeout_milliseconds := 5000);
  FOR i IN 1..10 LOOP
    PERFORM pg_sleep(0.5);
    SELECT status_code INTO v_status FROM net._http_response WHERE id = v_req;
    EXIT WHEN v_status IS NOT NULL;
  END LOOP;

  IF v_status IS NULL OR v_status = 404 THEN
    RETURN jsonb_build_object('skipped','edge_fn_not_deployed','status',v_status);
  END IF;

  PERFORM public.applicant_login_fire(50);
  PERFORM pg_sleep(3);
  PERFORM public.applicant_login_drain();
  PERFORM public.applicant_login_send(30);
  RETURN jsonb_build_object('alive', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.applicant_login_tick() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='applicant-login-drain-send') THEN
    PERFORM cron.unschedule('applicant-login-drain-send'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='applicant-login-tick') THEN
    PERFORM cron.unschedule('applicant-login-tick'); END IF;
  PERFORM cron.schedule('applicant-login-tick', '*/3 * * * *',
    $j$ SELECT public.applicant_login_tick(); $j$);
END $outer$;

SELECT 'applicant_login_tick gated on deploy; 3min cron installed' AS r;
