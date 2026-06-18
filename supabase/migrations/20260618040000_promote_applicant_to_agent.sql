-- 2026-06-17 Sam directive: "I didn't type in anybody in CRM. I took the
-- applicant and pushed them through whatever process I need to, etcetera,
-- in the full range of optimization." Plus: "platform is missing the full
-- connectivity and ability to to to change applications, change the manager's
-- things."
--
-- Wire the Apply → Hired path:
--   1. agents.source_application_id (FK to applications.id) so every promoted
--      agent traces back to the application that created them.
--   2. promote_applicant_to_agent(p_application_id, p_manager_id default Sam)
--      RPC — call it from any UI surface to convert an applicant to an agent
--      in one round-trip. Idempotent — returns existing agent_id if already
--      promoted.
--
-- Side effects of promotion:
--   - profiles row created with name/email/phone from applications
--   - agents row created with default manager_id = SJAMES01 unless overridden
--   - onboarding_stage = onboarding (licensed) or pre_licensed (unlicensed)
--   - applications.status flipped to 'hired'
--
-- The existing fn_enqueue_agent_onboarding_emails INSERT trigger on agents
-- handles the course + Discord emails automatically when license_status=licensed.
--
-- rollback: ALTER TABLE agents DROP COLUMN source_application_id;
--           DROP FUNCTION promote_applicant_to_agent(uuid, uuid);

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS source_application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_source_application_id
  ON public.agents(source_application_id)
  WHERE source_application_id IS NOT NULL;

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
  v_profile_id uuid;
  v_agent_id uuid;
  v_default_manager uuid := COALESCE(
    p_manager_id,
    '7c3c5581-3544-437f-bfe2-91391afb217d'::uuid  -- SJAMES01 canonical agent
  );
BEGIN
  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application % not found', p_application_id;
  END IF;

  -- Idempotent: if already promoted, return existing agent_id.
  SELECT id INTO v_existing_agent_id
  FROM public.agents
  WHERE source_application_id = p_application_id
  LIMIT 1;
  IF v_existing_agent_id IS NOT NULL THEN
    RETURN v_existing_agent_id;
  END IF;

  INSERT INTO public.profiles (full_name, email, phone)
  VALUES (
    TRIM(BOTH FROM (COALESCE(v_app.first_name, '') || ' ' || COALESCE(v_app.last_name, ''))),
    v_app.email,
    v_app.phone
  )
  RETURNING id INTO v_profile_id;

  INSERT INTO public.agents (
    display_name,
    profile_id,
    manager_id,
    source_application_id,
    license_status,
    status,
    onboarding_stage
  )
  VALUES (
    TRIM(BOTH FROM (COALESCE(v_app.first_name, '') || ' ' || COALESCE(v_app.last_name, ''))),
    v_profile_id,
    v_default_manager,
    p_application_id,
    COALESCE(v_app.license_status::text, 'unlicensed')::public.license_status,
    'active'::public.agent_status,
    (CASE WHEN v_app.license_status::text = 'licensed'
          THEN 'onboarding'
          ELSE 'pre_licensed'
     END)::public.onboarding_stage
  )
  RETURNING id INTO v_agent_id;

  -- Mark applications row as hired so it no longer shows as 'new'.
  UPDATE public.applications
  SET status = 'hired'::public.application_status
  WHERE id = p_application_id;

  RETURN v_agent_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.promote_applicant_to_agent(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_applicant_to_agent(uuid, uuid) IS
'Sam directive 2026-06-17: convert applications row to agents row in one
round-trip. Idempotent. Default manager = SJAMES01. Fires the existing
fn_enqueue_agent_onboarding_emails INSERT trigger which queues course +
Discord emails for licensed agents.';
