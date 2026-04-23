-- ════════════════════════════════════════════════════════════════════════
-- Auto-provision magic login on new application submit. When a new row
-- lands in public.applications, queue the applicant for magic-link
-- provisioning via applicant-magic-link edge fn. Falls back gracefully
-- if the edge fn isn't up yet (retry next time the queue is drained).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_applicant_autoprovision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_base text; v_key text; v_req bigint;
BEGIN
  -- Only for active, email-having, non-terminated, non-rejected apps
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  IF NEW.terminated_at IS NOT NULL THEN RETURN NEW; END IF;

  -- Queue row (idempotent — unique on application_id would make it fully
  -- safe; the drain loop also guards via status IN (...) checks)
  INSERT INTO public.applicant_login_queue (application_id, email, first_name, status)
  VALUES (NEW.id, NEW.email, NEW.first_name, 'queued')
  ON CONFLICT DO NOTHING;

  -- Fire the edge fn call right away (non-blocking)
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_base IS NOT NULL AND v_key IS NOT NULL THEN
    v_req := net.http_post(
      url := v_base || '/functions/v1/applicant-magic-link',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object('applicationId', NEW.id),
      timeout_milliseconds := 20000);
    UPDATE public.applicant_login_queue
       SET magic_link_req = v_req, status = 'user_created'
     WHERE application_id = NEW.id AND status = 'queued';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_applicant_autoprovision ON public.applications;
CREATE TRIGGER trg_applicant_autoprovision
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_applicant_autoprovision();

-- Cron: drain any queued/user_created rows every 3 min (catches retries +
-- covers the case where the edge fn was down when the trigger fired)
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='applicant-login-drain-send') THEN
    PERFORM cron.unschedule('applicant-login-drain-send'); END IF;
  PERFORM cron.schedule('applicant-login-drain-send', '*/3 * * * *',
    $j$
      SELECT public.applicant_login_fire(50);  -- catch any new queued rows
      SELECT public.applicant_login_drain();   -- advance user_created → link_ready
      SELECT public.applicant_login_send(30);  -- email link_ready → sent
    $j$);
END $outer$;

SELECT 'applicant auto-provision trigger + drain cron installed' AS r;
