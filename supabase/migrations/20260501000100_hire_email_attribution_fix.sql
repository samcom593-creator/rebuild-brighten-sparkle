-- Two fixes for the "KJ isn't getting hire emails" complaint (Sam 2026-05-01)
--
-- 1. Add trigger trg_notify_hire_announcement on applications that fires
--    the existing notify-hire-announcement edge fn (broadcasts to all
--    managers + admin) whenever license_progress or license_status flips
--    to 'licensed'. The edge fn existed but had NO postgres trigger
--    calling it, so the broadcast never fired automatically.
--
-- 2. (Edge fn change in link-account) — agent.invited_by_manager_id
--    now prefers application.recruiter_id over assigned_agent_id, so
--    the per-manager email from trigger-new-hire-flow lands with the
--    real recruiter (KJ) instead of the admin fallback that
--    auto_assign_unassigned_application set.

CREATE OR REPLACE FUNCTION public.trg_fn_notify_hire_announcement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.license_progress IS DISTINCT FROM NEW.license_progress
      AND NEW.license_progress = 'licensed')
     OR (OLD.license_status IS DISTINCT FROM NEW.license_status
         AND NEW.license_status = 'licensed')
  THEN
    PERFORM public.run_automation_job(
      'notify-hire-announcement',
      'notify-hire-announcement',
      jsonb_build_object(
        'applicationId', NEW.id,
        'firstName',     NEW.first_name,
        'lastName',      NEW.last_name,
        'email',         NEW.email,
        'recruiterId',   NEW.recruiter_id
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the user UPDATE on a notification dispatch failure
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_hire_announcement ON public.applications;
CREATE TRIGGER trg_notify_hire_announcement
  AFTER UPDATE OF license_progress, license_status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notify_hire_announcement();
