-- 2026-06-18 Sam directive (verbatim): "promote button does not work"
--
-- TWO bugs in promote_applicant_to_agent stopped every Promote tap from
-- the Applicants page + Search → Megaphone for Applicants.
--
-- Bug #1: tried to INSERT INTO profiles WITHOUT user_id, but
-- profiles.user_id is NOT NULL. Fix: skip profile creation entirely —
-- the agent record can carry profile_id=NULL until the auth account
-- creation flow (create-new-agent-account edge fn) runs. Drawers,
-- leaderboards, and CRM all COALESCE the missing profile.
--
-- Bug #2: applications.status was UPDATEd to 'hired' but
-- application_status enum has no such value. Valid values: new,
-- reviewing, interview, contracting, approved, rejected, no_pickup,
-- lead, registered, attended, attended_no_show, paid, ONBOARDING,
-- producing, lapsed, disqualified, quick_qualified. Fix: use
-- 'onboarding' — matches the agent's new onboarding_stage.
--
-- Tested live: promote_applicant_to_agent on a real applicant returned
-- a uuid · agents row created · applications status flipped to
-- onboarding. Rolled the test back.
--
-- rollback: git revert + restore prior fn definition.

CREATE OR REPLACE FUNCTION public.promote_applicant_to_agent(
  p_application_id uuid,
  p_manager_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app public.applications%ROWTYPE;
  v_existing_agent_id uuid;
  v_agent_id uuid;
  v_default_manager uuid := COALESCE(
    p_manager_id,
    '7c3c5581-3544-437f-bfe2-91391afb217d'::uuid
  );
BEGIN
  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application % not found', p_application_id;
  END IF;

  SELECT id INTO v_existing_agent_id
  FROM public.agents
  WHERE source_application_id = p_application_id LIMIT 1;
  IF v_existing_agent_id IS NOT NULL THEN
    RETURN v_existing_agent_id;
  END IF;

  INSERT INTO public.agents (
    display_name, manager_id, source_application_id,
    license_status, status, onboarding_stage
  )
  VALUES (
    NULLIF(TRIM(BOTH FROM (COALESCE(v_app.first_name, '') || ' ' || COALESCE(v_app.last_name, ''))), ''),
    v_default_manager,
    p_application_id,
    COALESCE(v_app.license_status::text, 'unlicensed')::public.license_status,
    'active'::public.agent_status,
    (CASE WHEN v_app.license_status::text = 'licensed'
          THEN 'onboarding' ELSE 'pre_licensed' END)::public.onboarding_stage
  )
  RETURNING id INTO v_agent_id;

  UPDATE public.applications
  SET status = 'onboarding'::public.application_status
  WHERE id = p_application_id;

  RETURN v_agent_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.promote_applicant_to_agent(uuid, uuid)
  TO authenticated, service_role;
