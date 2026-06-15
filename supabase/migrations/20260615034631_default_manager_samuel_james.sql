-- wave-101: DEFAULT MISSING MANAGER → SAMUEL JAMES
--
-- Sam directive (voice 2026-06-15): "If no manager make it auto Samuel James."
--
-- Pre-shipment baseline (from bot-sql audit):
--   applications:
--     recruiter_id IS NULL           → 108 rows
--     assigned_agent_id IS NULL      → 0   rows (existing trg_auto_assign_application handles)
--     referral_manager_id IS NULL    → 1   row  (existing trg_applications_auto_route handles)
--     referral_recruiter_id IS NULL  → 7   rows
--   agents:
--     manager_id IS NULL (excl Sam)  → 132 rows
--
-- Existing BEFORE INSERT triggers on applications already handle:
--   - trg_auto_assign_application  → assigned_agent_id default (Sam agent_id)
--   - trg_applications_auto_route  → hiring_manager_user_id default (Sam user_id)
-- Neither handles recruiter_id, referral_manager_id, or referral_recruiter_id.
-- Existing triggers on agents do NOT default manager_id.
--
-- This migration adds two BEFORE INSERT triggers to fill THOSE remaining gaps
-- so the cleanest reading of Sam's voice ("if no manager make it auto Samuel
-- James") is enforced at the DB layer across every code path (edge fn, RLS
-- inserts from the dashboard, manual SQL, future imports, agent_signup, etc).
--
-- Sam's canonical agent UUID and user_id are pinned via a CTE to keep the
-- trigger function compile-time stable. If Sam's canonical agent_id ever
-- migrates we update this single constant (one place).
--
-- Hold the Standard. Average is the disease.

-- 1) Applications BEFORE INSERT trigger ----------------------------------

CREATE OR REPLACE FUNCTION public.fn_default_application_manager_to_sam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  SAM_AGENT_ID CONSTANT uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
BEGIN
  -- recruiter_id: 108 NULL rows pre-trigger. App-side submit-application
  -- already defaults this for the new-applicant code path; this trigger
  -- catches every OTHER code path (admin UI direct inserts, manual SQL,
  -- imports, RLS inserts, future intake variants).
  IF NEW.recruiter_id IS NULL THEN
    NEW.recruiter_id := SAM_AGENT_ID;
  END IF;

  -- referral_manager_id: the "manager who gets credit" column. App-side
  -- defaults this too, but trigger ensures cross-path coverage. The
  -- existing trg_applications_auto_route maps hiring_manager_user_id
  -- (auth.users.id) — different column, different semantic.
  IF NEW.referral_manager_id IS NULL THEN
    NEW.referral_manager_id := SAM_AGENT_ID;
  END IF;

  -- referral_recruiter_id: canonical CREDIT column per P3 2026-06-08 note
  -- in submit-application/index.ts. App-side defaults to NULL when no
  -- explicit recruiter — backfill to Sam here so credit attribution is
  -- never lost.
  IF NEW.referral_recruiter_id IS NULL THEN
    NEW.referral_recruiter_id := SAM_AGENT_ID;
  END IF;

  -- assigned_agent_id is already handled by trg_auto_assign_application
  -- (smart Sam-routing with email-keyed lookup). Don't stomp on it.

  RETURN NEW;
END;
$function$;

-- Run AFTER the existing auto-assign + auto-route triggers so we only fill
-- the gaps they explicitly leave open. PostgreSQL fires BEFORE triggers in
-- alphabetical order by trigger_name — prefix with z_ to land last in the
-- chain. trg_auto_assign_application + trg_applications_auto_route +
-- trg_applications_flag_duplicates + trg_normalize_license_progress +
-- trg_track_license_milestones all sort earlier.
DROP TRIGGER IF EXISTS z_default_application_manager_to_sam ON public.applications;
CREATE TRIGGER z_default_application_manager_to_sam
  BEFORE INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_default_application_manager_to_sam();

COMMENT ON FUNCTION public.fn_default_application_manager_to_sam IS
  'wave-101: defaults recruiter_id + referral_manager_id + referral_recruiter_id to Samuel James (7c3c5581...) when NULL on insert. Sam directive 2026-06-15: "if no manager make it auto Samuel James".';

-- 2) Agents BEFORE INSERT trigger ----------------------------------------

CREATE OR REPLACE FUNCTION public.fn_default_agent_manager_to_sam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  SAM_AGENT_ID CONSTANT uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
BEGIN
  -- manager_id: 132 NULL rows pre-trigger (excluding Sam himself).
  -- Critical guard: NEVER make Sam his own manager. If the row being
  -- inserted IS Sam, leave manager_id NULL.
  IF NEW.manager_id IS NULL AND NEW.id IS DISTINCT FROM SAM_AGENT_ID THEN
    NEW.manager_id := SAM_AGENT_ID;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS z_default_agent_manager_to_sam ON public.agents;
CREATE TRIGGER z_default_agent_manager_to_sam
  BEFORE INSERT ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_default_agent_manager_to_sam();

COMMENT ON FUNCTION public.fn_default_agent_manager_to_sam IS
  'wave-101: defaults agents.manager_id to Samuel James (7c3c5581...) when NULL on insert. Skips when inserting Sam himself (Sam is not his own manager). Sam directive 2026-06-15.';

-- 3) Backfill (commented for safety — uncomment + run via bot-sql) -------
--
-- Pre-backfill counts (verified via bot-sql 2026-06-15):
--   applications NULL recruiter_id          = 108
--   applications NULL referral_manager_id   = 1
--   applications NULL referral_recruiter_id = 7
--   agents NULL manager_id (excl Sam)        = 132
--
-- To execute the backfill, uncomment the block below and run via bot-sql.
-- The trigger ABOVE only catches NEW inserts; this fills the historical
-- gap.
--
-- BEGIN;
--   UPDATE public.applications
--     SET recruiter_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
--   WHERE recruiter_id IS NULL;
--   UPDATE public.applications
--     SET referral_manager_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
--   WHERE referral_manager_id IS NULL;
--   UPDATE public.applications
--     SET referral_recruiter_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
--   WHERE referral_recruiter_id IS NULL;
--   UPDATE public.agents
--     SET manager_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
--   WHERE manager_id IS NULL
--     AND id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- COMMIT;

-- 4) Verification --------------------------------------------------------

DO $$
DECLARE
  v_app_trig int;
  v_agent_trig int;
BEGIN
  SELECT COUNT(*) INTO v_app_trig
  FROM pg_trigger
  WHERE tgname = 'z_default_application_manager_to_sam';
  SELECT COUNT(*) INTO v_agent_trig
  FROM pg_trigger
  WHERE tgname = 'z_default_agent_manager_to_sam';
  IF v_app_trig <> 1 OR v_agent_trig <> 1 THEN
    RAISE EXCEPTION 'wave-101: default-manager triggers did not install (app=%, agent=%)',
      v_app_trig, v_agent_trig;
  END IF;
  RAISE NOTICE 'wave-101: default-manager triggers installed (app=%, agent=%)',
    v_app_trig, v_agent_trig;
END $$;
