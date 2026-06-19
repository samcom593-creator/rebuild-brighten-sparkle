-- 2026-06-18 MP-214 — canonical Command Center layer
--
-- ONE view + ONE RPC backs every Command Center surface.
--
-- v_command_center_queue: union of manual_interview_entries +
-- apex_scheduled_calls (referrer-filtered) + applications (not yet
-- dedup'd into a manual entry). Each row carries the computed flags
-- the UI needs to filter without re-computing on the client:
--
--   computed_status (pending/contacted/called/rescheduled/no_show/passed/hired/contracted)
--   computed_is_active (still in flight — visible by default)
--   computed_is_done (terminal — hidden by default)
--   agent_id_if_promoted (uuid of the agents row this maps to, if promoted)
--
-- cc_dispose(entity_type, entity_id, field, value, notes): single
-- round-trip dispose RPC that:
--   - Updates the right table by entity_type
--   - Maps disposition to applications.status when source = application
--   - Auto-fires promote_applicant_to_agent on hired/contracted
--   - Upserts course + Discord into agent_onboarding_queue
--   - Returns jsonb with promoted/agent_id/emails_queued for the client toast
--
-- See MP-214: ~/business-ops/master-prompts/214-cc-perfect-rebuild-2026-06-18.md
--
-- rollback: DROP VIEW v_command_center_queue CASCADE; DROP FUNCTION cc_dispose.

DROP VIEW IF EXISTS public.v_command_center_queue CASCADE;

CREATE VIEW public.v_command_center_queue AS
WITH base AS (
  SELECT
    m.id::text AS entity_id,
    'manual'::text AS entity_type,
    m.source_application_id,
    m.candidate_name, m.phone, m.email, m.instagram_handle,
    m.scheduled_at AS scheduled_at_utc,
    (m.scheduled_at AT TIME ZONE 'America/Chicago')::timestamp AS scheduled_at_chicago,
    m.interview_type,
    m.contacted_at, m.called_at, m.rescheduled_at,
    m.no_show_at, m.hired_at, m.contracted_at, m.passed_at,
    m.outcome_notes, m.created_at
  FROM public.manual_interview_entries m
  WHERE m.scheduled_at >= '2026-06-01 00:00:00+00'::timestamptz

  UNION ALL

  SELECT
    ('calendly:' || c.id::text),
    'calendly',
    NULL::uuid,
    COALESCE(NULLIF(TRIM(c.prospect_name), ''), NULLIF(TRIM(c.summary), ''), 'Calendly Interview'),
    c.prospect_phone, c.prospect_email,
    NULL::text,
    c.start_at,
    (c.start_at AT TIME ZONE 'America/Chicago')::timestamp,
    COALESCE(NULLIF(c.call_type, ''), 'scheduled_call'),
    c.contacted_at, c.called_at, c.rescheduled_at,
    c.no_show_at, c.hired_at, c.contracted_at, c.passed_at,
    c.outcome_notes, c.created_at
  FROM public.apex_scheduled_calls c
  WHERE c.start_at >= '2026-06-01 00:00:00+00'::timestamptz
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE lower(a.email) = lower(c.prospect_email)
        AND (a.referral_manager_id IS NOT NULL OR a.referral_recruiter_id IS NOT NULL OR a.recruiter_id IS NOT NULL)
    )

  UNION ALL

  SELECT
    ('application:' || a.id::text),
    'application',
    a.id,
    TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')),
    a.phone, a.email,
    NULL::text,
    a.created_at,
    (a.created_at AT TIME ZONE 'America/Chicago')::timestamp,
    COALESCE(a.license_status::text, 'application'),
    NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
    CASE WHEN a.status::text IN ('hired','active') THEN a.licensed_at ELSE NULL END,
    a.contracted_at,
    NULL::timestamptz,
    NULL::text,
    a.created_at
  FROM public.applications a
  WHERE a.created_at >= '2026-06-01 00:00:00+00'::timestamptz
    AND a.status IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.manual_interview_entries m WHERE m.source_application_id = a.id)
)
SELECT
  b.*,
  CASE
    WHEN b.no_show_at IS NOT NULL THEN 'no_show'
    WHEN b.passed_at IS NOT NULL THEN 'passed'
    WHEN b.contracted_at IS NOT NULL THEN 'contracted'
    WHEN b.hired_at IS NOT NULL THEN 'hired'
    WHEN b.rescheduled_at IS NOT NULL AND b.called_at IS NULL THEN 'rescheduled'
    WHEN b.called_at IS NOT NULL THEN 'called'
    WHEN b.contacted_at IS NOT NULL THEN 'contacted'
    ELSE 'pending'
  END AS computed_status,
  (b.no_show_at IS NULL AND b.passed_at IS NULL AND b.contracted_at IS NULL AND b.hired_at IS NULL) AS computed_is_active,
  (b.no_show_at IS NOT NULL OR b.passed_at IS NOT NULL OR b.contracted_at IS NOT NULL OR b.hired_at IS NOT NULL) AS computed_is_done,
  (SELECT ag.id FROM public.agents ag WHERE ag.source_application_id = b.source_application_id LIMIT 1) AS agent_id_if_promoted
FROM base b;

GRANT SELECT ON public.v_command_center_queue TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_command_center_queue IS
'MP-214 canonical view. Single source of truth for /dashboard/interviews.
computed_is_active filters default view, computed_is_done shows ✅ Done pill,
agent_id_if_promoted lets the UI deep-link to AgentProfileDrawer without re-resolving.';

CREATE OR REPLACE FUNCTION public.cc_dispose(
  p_entity_type text,
  p_entity_id text,
  p_field text,
  p_value text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_real_id text;
  v_ts timestamptz := COALESCE(p_value::timestamptz, now());
  v_source_app_id uuid;
  v_agent_id uuid;
  v_promoted boolean := false;
  v_emails_queued int := 0;
BEGIN
  v_real_id := CASE
    WHEN p_entity_id LIKE 'application:%' THEN substring(p_entity_id from 13)
    WHEN p_entity_id LIKE 'calendly:%' THEN substring(p_entity_id from 10)
    ELSE p_entity_id
  END;

  IF p_entity_type = 'manual' THEN
    IF p_field = 'notes' THEN
      UPDATE public.manual_interview_entries SET outcome_notes = p_notes, updated_at = now() WHERE id = v_real_id::uuid;
    ELSE
      EXECUTE format('UPDATE public.manual_interview_entries SET %I = $1, updated_at = now() WHERE id = $2::uuid', p_field || '_at') USING v_ts, v_real_id;
    END IF;
    SELECT source_application_id INTO v_source_app_id FROM public.manual_interview_entries WHERE id = v_real_id::uuid;

  ELSIF p_entity_type = 'calendly' THEN
    IF p_field = 'notes' THEN
      UPDATE public.apex_scheduled_calls SET outcome_notes = p_notes, updated_at = now() WHERE id = v_real_id::uuid;
    ELSE
      EXECUTE format('UPDATE public.apex_scheduled_calls SET %I = $1, updated_at = now() WHERE id = $2::uuid', p_field || '_at') USING v_ts, v_real_id;
    END IF;

  ELSIF p_entity_type = 'application' THEN
    v_source_app_id := v_real_id::uuid;
    IF p_field IN ('hired', 'contracted') THEN
      UPDATE public.applications SET status = 'onboarding'::application_status, updated_at = now() WHERE id = v_real_id::uuid;
    ELSIF p_field = 'passed' THEN
      UPDATE public.applications SET status = 'rejected'::application_status, updated_at = now() WHERE id = v_real_id::uuid;
    END IF;
  END IF;

  IF p_field IN ('hired', 'contracted') AND v_source_app_id IS NOT NULL THEN
    SELECT public.promote_applicant_to_agent(v_source_app_id) INTO v_agent_id;
    v_promoted := v_agent_id IS NOT NULL;
    IF v_agent_id IS NOT NULL THEN
      INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at, sent_at, attempt_count, last_error)
      VALUES (v_agent_id, 'course', now(), NULL, 0, NULL), (v_agent_id, 'discord', now(), NULL, 0, NULL)
      ON CONFLICT (agent_id, email_kind) DO UPDATE SET target_send_at = EXCLUDED.target_send_at, sent_at = NULL, attempt_count = 0, last_error = NULL;
      v_emails_queued := 2;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'entity_type', p_entity_type, 'entity_id', p_entity_id, 'field', p_field, 'ts', v_ts, 'promoted', v_promoted, 'agent_id', v_agent_id, 'emails_queued', v_emails_queued);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.cc_dispose(text, text, text, text, text) TO authenticated, service_role;
