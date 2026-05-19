-- ═══════════════════════════════════════════════════════════════════════════
-- Public landing_next_step_for(application_id) — applicants check their
-- own next step on /status/<id> without logging in.
--
-- Returns ONLY the row for the supplied application_id. No PII beyond what
-- the applicant already provided. SECURITY DEFINER + REVOKE'd from PUBLIC
-- + GRANT to anon to bypass admin RLS on the underlying view.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION landing_next_step_for(p_application_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT to_jsonb(c) - 'agent_id' - 'application_id'
  FROM v_next_step_candidate c
  WHERE c.application_id = p_application_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION landing_next_step_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION landing_next_step_for(uuid) TO anon, authenticated;
