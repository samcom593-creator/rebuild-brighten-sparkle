-- MP-224: Auto-enqueue Calendly invite for unlicensed applicants
-- Trigger fires AFTER INSERT or UPDATE on applications.
-- Enqueues a row in outreach_queue with source_run='calendly-invite' when
-- license_status IS NULL or 'unlicensed'. Idempotency_key = 'calendly-' || id
-- so a partial unique index keeps this safe to fire repeatedly.
-- Worker (edge fn send-calendly-invite) honors do_not_contact + sent_at.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.fn_enqueue_calendly_for_unlicensed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' OR position('@' in NEW.email) = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.license_status IS NULL
     OR lower(NEW.license_status::text) = 'unlicensed' THEN
    INSERT INTO public.outreach_queue (
      channel,
      source_run,
      application_id,
      to_email,
      subject,
      template_key,
      status,
      scheduled_for,
      idempotency_key
    )
    VALUES (
      'email',
      'calendly-invite',
      NEW.id,
      NEW.email,
      'Personal invite from Samuel James — let''s talk about your career',
      'calendly-invite-v1',
      'pending',
      now(),
      'calendly-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendly_for_unlicensed_ins ON public.applications;
CREATE TRIGGER trg_calendly_for_unlicensed_ins
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_calendly_for_unlicensed();

DROP TRIGGER IF EXISTS trg_calendly_for_unlicensed_upd ON public.applications;
CREATE TRIGGER trg_calendly_for_unlicensed_upd
  AFTER UPDATE OF license_status, email ON public.applications
  FOR EACH ROW
  WHEN (NEW.license_status IS DISTINCT FROM OLD.license_status
        OR NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.fn_enqueue_calendly_for_unlicensed();

COMMENT ON FUNCTION public.fn_enqueue_calendly_for_unlicensed() IS
  'MP-224: enqueues calendly-invite row in outreach_queue for unlicensed applicants. Idempotent via outreach_queue_idempotency_key_uniq.';
