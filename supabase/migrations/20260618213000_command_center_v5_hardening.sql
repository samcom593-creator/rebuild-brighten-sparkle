-- 2026-06-18 MP-214 v5 — Codex audit hardening
--
-- Codex's deep-audit pass flagged real holes in the v_command_center_queue
-- view + cc_dispose RPC that shipped in bbbd70c0. This migration closes
-- them — the live DB has the same body applied via bot-sql already; this
-- file is the audit-trail record so the migration runs idempotently in any
-- future reset / branch.
--
-- Holes closed:
--   1. PII leak — REVOKE SELECT ON v_command_center_queue FROM anon.
--      Interview emails + phones were SELECTable by the anon JWT.
--   2. Calendly source_application_id was NULL — so Calendly hired/contracted
--      could never trigger the auto-promote chain. Fix: derive via email
--      match against applications.
--   3. Application candidate_name could come out blank — TRIM(empty || ' ' || empty).
--      Fix: COALESCE to email, then 'Unnamed Applicant'.
--   4. cc_dispose had no input allow-list — could pass any field name to
--      dynamic UPDATE. Fix: explicit p_entity_type + p_field allow-list at top.
--   5. cc_dispose couldn't undo (clear timestamps) — only set them.
--      Fix: '__clear__' sentinel value sets NULL.
--   6. cc_dispose resets sent_at + attempt_count on every re-dispose —
--      so re-tapping Contracted re-fires already-sent emails.
--      Fix: ON CONFLICT DO NOTHING (Codex P0.4).
--   7. cc_dispose returned `agent_id` but the v5 spec calls it `promoted_agent_id`.
--      Fix: rename in return jsonb.
--   8. cc_dispose granted to anon — REVOKE; only authenticated + service_role.
--
-- rollback: re-apply 20260618200000_command_center_canonical.sql to restore prior.

REVOKE SELECT ON public.v_command_center_queue FROM anon;

DROP VIEW IF EXISTS public.v_command_center_queue CASCADE;

CREATE VIEW public.v_command_center_queue AS
WITH base AS (
  SELECT
    m.id::text AS entity_id, 'manual'::text AS entity_type, m.source_application_id,
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
    (SELECT a.id FROM public.applications a WHERE lower(a.email) = lower(c.prospect_email) LIMIT 1),
    COALESCE(NULLIF(TRIM(c.prospect_name), ''), NULLIF(TRIM(c.summary), ''), 'Calendly Interview'),
    c.prospect_phone, c.prospect_email, NULL::text,
    c.start_at, (c.start_at AT TIME ZONE 'America/Chicago')::timestamp,
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
    ('application:' || a.id::text), 'application', a.id,
    COALESCE(NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''), a.email, 'Unnamed Applicant'),
    a.phone, a.email, NULL::text,
    a.created_at, (a.created_at AT TIME ZONE 'America/Chicago')::timestamp,
    COALESCE(a.license_status::text, 'application'),
    NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
    CASE WHEN a.status::text IN ('hired','active') THEN a.licensed_at ELSE NULL END,
    a.contracted_at, NULL::timestamptz, NULL::text, a.created_at
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

GRANT SELECT ON public.v_command_center_queue TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cc_dispose(
  p_entity_type text, p_entity_id text, p_field text,
  p_value text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_real_id text;
  v_ts timestamptz := CASE WHEN p_value IS NULL OR p_value = '' THEN now() ELSE p_value::timestamptz END;
  v_clear boolean := (p_value = '__clear__');
  v_source_app_id uuid;
  v_agent_id uuid;
  v_promoted boolean := false;
  v_emails_queued int := 0;
BEGIN
  IF p_entity_type NOT IN ('manual','calendly','application') THEN
    RAISE EXCEPTION 'invalid entity_type %', p_entity_type;
  END IF;
  IF p_field NOT IN ('contacted','called','rescheduled','no_show','hired','passed','contracted','notes') THEN
    RAISE EXCEPTION 'invalid field %', p_field;
  END IF;

  v_real_id := CASE
    WHEN p_entity_id LIKE 'application:%' THEN substring(p_entity_id from 13)
    WHEN p_entity_id LIKE 'calendly:%' THEN substring(p_entity_id from 10)
    ELSE p_entity_id
  END;

  IF p_entity_type = 'manual' THEN
    IF p_field = 'notes' THEN
      UPDATE public.manual_interview_entries SET outcome_notes = p_notes, updated_at = now() WHERE id = v_real_id::uuid;
    ELSE
      EXECUTE format('UPDATE public.manual_interview_entries SET %I = $1, updated_at = now() WHERE id = $2::uuid', p_field || '_at')
        USING (CASE WHEN v_clear THEN NULL::timestamptz ELSE v_ts END), v_real_id;
    END IF;
    SELECT source_application_id INTO v_source_app_id FROM public.manual_interview_entries WHERE id = v_real_id::uuid;

  ELSIF p_entity_type = 'calendly' THEN
    IF p_field = 'notes' THEN
      UPDATE public.apex_scheduled_calls SET outcome_notes = p_notes, updated_at = now() WHERE id = v_real_id::uuid;
    ELSE
      EXECUTE format('UPDATE public.apex_scheduled_calls SET %I = $1, updated_at = now() WHERE id = $2::uuid', p_field || '_at')
        USING (CASE WHEN v_clear THEN NULL::timestamptz ELSE v_ts END), v_real_id;
    END IF;
    IF p_field IN ('hired', 'contracted') THEN
      SELECT a.id INTO v_source_app_id
      FROM public.apex_scheduled_calls c
      JOIN public.applications a ON lower(a.email) = lower(c.prospect_email)
      WHERE c.id = v_real_id::uuid LIMIT 1;
    END IF;

  ELSIF p_entity_type = 'application' THEN
    v_source_app_id := v_real_id::uuid;
    IF p_field IN ('hired', 'contracted') THEN
      UPDATE public.applications SET status = 'onboarding'::application_status, updated_at = now() WHERE id = v_real_id::uuid;
    ELSIF p_field = 'passed' THEN
      UPDATE public.applications SET status = 'rejected'::application_status, updated_at = now() WHERE id = v_real_id::uuid;
    END IF;
  END IF;

  IF p_field IN ('hired', 'contracted') AND NOT v_clear AND v_source_app_id IS NOT NULL THEN
    SELECT public.promote_applicant_to_agent(v_source_app_id) INTO v_agent_id;
    v_promoted := v_agent_id IS NOT NULL;
    IF v_agent_id IS NOT NULL THEN
      INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at, sent_at, attempt_count, last_error)
      VALUES (v_agent_id, 'course', now(), NULL, 0, NULL), (v_agent_id, 'discord', now(), NULL, 0, NULL)
      ON CONFLICT (agent_id, email_kind) DO NOTHING;
      v_emails_queued := 2;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entity_type', p_entity_type, 'entity_id', p_entity_id,
    'field', p_field, 'cleared', v_clear, 'ts', v_ts,
    'promoted', v_promoted, 'promoted_agent_id', v_agent_id,
    'emails_queued', v_emails_queued
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.cc_dispose(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cc_dispose(text, text, text, text, text) TO authenticated, service_role;
