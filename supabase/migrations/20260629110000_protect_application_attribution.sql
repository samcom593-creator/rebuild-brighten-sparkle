-- 2026-06-29 SECURITY FIX — recruit-theft vector closed.
--
-- Sam directive (verbatim): "agents on the apex site are taking my recruits
-- like they resubmit the form".
--
-- Root cause: submit-application/index.ts:1012-1017 (quick-qualify update
-- path) was UNCONDITIONALLY overwriting recruiter_id, assigned_agent_id,
-- referral_manager_id, and referral_recruiter_id with whatever recruiter
-- the new submission carried. Steal vector:
--   1. Bad-actor agent grabs target recruit's email
--   2. Opens /apply, types email, submits with their own recruiter_id in
--      the URL or selected from the recruiter dropdown
--   3. Edge fn finds existing app, UPDATE'd attribution to bad-actor
--   4. Original recruiter loses credit silently — no audit log
--
-- App-level fix (commit pairs this migration): edge fn now reads existing
-- attribution + only fills NULL columns. First-write-wins.
--
-- DB-level fix (this migration): BEFORE UPDATE trigger on applications
-- restores OLD value to NEW row for any of the 6 attribution columns,
-- whenever OLD value is NOT NULL. Defense-in-depth — even if a future
-- code path bypasses the edge fn (PostgREST direct, RPC, manual SQL),
-- attribution cannot be overwritten.
--
-- Tested live: pick a real app with recruiter_id, attempt to UPDATE with
-- different uuid, verify recruiter_id stayed at original.
--
-- Columns protected:
--   - assigned_agent_id
--   - recruiter_id
--   - referral_manager_id
--   - referral_recruiter_id
--   - referrer_agent_id
--   - hiring_manager_user_id
--
-- rollback: DROP TRIGGER trg_protect_application_attribution + DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.fn_protect_application_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.assigned_agent_id IS NOT NULL AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      NEW.assigned_agent_id := OLD.assigned_agent_id;
    END IF;
    IF OLD.recruiter_id IS NOT NULL AND NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id THEN
      NEW.recruiter_id := OLD.recruiter_id;
    END IF;
    IF OLD.referral_manager_id IS NOT NULL AND NEW.referral_manager_id IS DISTINCT FROM OLD.referral_manager_id THEN
      NEW.referral_manager_id := OLD.referral_manager_id;
    END IF;
    IF OLD.referral_recruiter_id IS NOT NULL AND NEW.referral_recruiter_id IS DISTINCT FROM OLD.referral_recruiter_id THEN
      NEW.referral_recruiter_id := OLD.referral_recruiter_id;
    END IF;
    IF OLD.referrer_agent_id IS NOT NULL AND NEW.referrer_agent_id IS DISTINCT FROM OLD.referrer_agent_id THEN
      NEW.referrer_agent_id := OLD.referrer_agent_id;
    END IF;
    IF OLD.hiring_manager_user_id IS NOT NULL AND NEW.hiring_manager_user_id IS DISTINCT FROM OLD.hiring_manager_user_id THEN
      NEW.hiring_manager_user_id := OLD.hiring_manager_user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_protect_application_attribution ON public.applications;

CREATE TRIGGER trg_protect_application_attribution
BEFORE UPDATE ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_application_attribution();

COMMENT ON TRIGGER trg_protect_application_attribution ON public.applications IS
  '2026-06-29 first-write-wins on attribution columns. Closes recruit-theft via form re-submit. See submit-application/index.ts edge fn for the app-level guard.';
