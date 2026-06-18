-- Interview disposition workspace
-- Sam directive 2026-06-17: one tap to mark called, hired, pass, or notes
-- across VA/manual rows, Calendly rows, and June application rows.

ALTER TABLE public.manual_interview_entries
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS called_outcome text,
  ADD COLUMN IF NOT EXISTS hired_at timestamptz,
  ADD COLUMN IF NOT EXISTS passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS contracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_notes text,
  ADD COLUMN IF NOT EXISTS source_application_id uuid NULL REFERENCES public.applications(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'manual_interview_entries_called_outcome_chk'
      AND conrelid = 'public.manual_interview_entries'::regclass
  ) THEN
    ALTER TABLE public.manual_interview_entries
      ADD CONSTRAINT manual_interview_entries_called_outcome_chk
      CHECK (
        called_outcome IN ('connected', 'voicemail', 'no_answer', 'wrong_number', 'rescheduled')
        OR called_outcome IS NULL
      );
  END IF;
END $$;

ALTER TABLE public.manual_interview_entries
  DROP CONSTRAINT IF EXISTS manual_interview_entries_type_chk;

ALTER TABLE public.manual_interview_entries
  ADD CONSTRAINT manual_interview_entries_type_chk
  CHECK (
    interview_type IN (
      'licensed_prospect',
      'licensed_call',
      'leader_call',
      'unlicensed_lead',
      'final_expense_review',
      'callback',
      'general',
      'new',
      'reviewing',
      'interview',
      'contracting',
      'approved',
      'rejected',
      'no_pickup',
      'lead',
      'registered',
      'attended',
      'attended_no_show',
      'paid',
      'onboarding',
      'producing',
      'lapsed',
      'disqualified',
      'quick_qualified'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS manual_interview_entries_source_application_uidx
  ON public.manual_interview_entries (source_application_id)
  WHERE source_application_id IS NOT NULL;

UPDATE public.manual_interview_entries
SET outcome_notes = COALESCE(outcome_notes, notes)
WHERE outcome_notes IS NULL
  AND notes IS NOT NULL;

ALTER TABLE public.apex_scheduled_calls
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS hired_at timestamptz,
  ADD COLUMN IF NOT EXISTS passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS contracted_at timestamptz;

CREATE OR REPLACE FUNCTION public.uuid_from_text(p_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (
    substr(md5(p_value), 1, 8) || '-' ||
    substr(md5(p_value), 9, 4) || '-' ||
    substr(md5(p_value), 13, 4) || '-' ||
    substr(md5(p_value), 17, 4) || '-' ||
    substr(md5(p_value), 21, 12)
  )::uuid;
$$;

CREATE OR REPLACE VIEW public.v_interviews_unified AS
SELECT
  m.id,
  'manual'::text AS source,
  m.candidate_name,
  m.phone,
  m.email,
  m.instagram_handle,
  m.scheduled_at,
  m.interview_type,
  CASE
    WHEN m.passed_at IS NOT NULL THEN 'passed'
    WHEN m.hired_at IS NOT NULL THEN 'hired'
    WHEN m.contracted_at IS NOT NULL THEN 'contracted'
    WHEN m.called_at IS NOT NULL THEN 'called'
    ELSE 'pending'
  END::text AS status,
  m.called_at,
  m.hired_at,
  m.passed_at,
  m.contracted_at,
  m.outcome_notes,
  NULL::uuid AS agent_id_if_known,
  m.created_at
FROM public.manual_interview_entries m
WHERE m.scheduled_at >= '2026-06-01'::timestamptz
  AND m.source_application_id IS NULL

UNION ALL

SELECT
  public.uuid_from_text('calendly:' || c.id::text) AS id,
  'calendly'::text AS source,
  COALESCE(NULLIF(trim(c.prospect_name), ''), NULLIF(trim(c.summary), ''), 'Calendly Interview') AS candidate_name,
  c.prospect_phone AS phone,
  c.prospect_email AS email,
  NULL::text AS instagram_handle,
  c.start_at AS scheduled_at,
  COALESCE(NULLIF(c.call_type, ''), 'scheduled_call') AS interview_type,
  CASE
    WHEN c.passed_at IS NOT NULL THEN 'passed'
    WHEN c.hired_at IS NOT NULL THEN 'hired'
    WHEN c.contracted_at IS NOT NULL THEN 'contracted'
    WHEN c.called_at IS NOT NULL THEN 'called'
    ELSE COALESCE(NULLIF(c.status, ''), 'scheduled')
  END::text AS status,
  c.called_at,
  c.hired_at,
  c.passed_at,
  c.contracted_at,
  c.outcome_notes,
  NULL::uuid AS agent_id_if_known,
  c.created_at
FROM public.apex_scheduled_calls c
WHERE c.start_at >= '2026-06-01'::timestamptz

UNION ALL

SELECT
  a.id,
  'application'::text AS source,
  COALESCE(
    NULLIF(trim(concat_ws(' ', NULLIF(trim(a.first_name), ''), NULLIF(trim(a.last_name), ''))), ''),
    NULLIF(trim(a.email), ''),
    'Application ' || left(a.id::text, 8)
  ) AS candidate_name,
  a.phone,
  a.email,
  a.instagram_handle,
  a.created_at AS scheduled_at,
  a.license_status::text AS interview_type,
  a.status::text AS status,
  COALESCE(a.last_contacted_at, a.contacted_at, a.first_contact_attempt_at) AS called_at,
  CASE
    WHEN a.status::text IN ('approved', 'onboarding', 'producing') THEN COALESCE(a.closed_at, a.updated_at)
    ELSE NULL::timestamptz
  END AS hired_at,
  CASE
    WHEN a.status::text IN ('rejected', 'disqualified') THEN COALESCE(a.closed_at, a.updated_at)
    ELSE NULL::timestamptz
  END AS passed_at,
  a.contracted_at,
  a.notes AS outcome_notes,
  a.assigned_agent_id AS agent_id_if_known,
  a.created_at
FROM public.applications a
WHERE a.created_at >= '2026-06-01'::timestamptz
  AND a.status IS NOT NULL;

GRANT SELECT ON public.v_interviews_unified TO authenticated;

CREATE OR REPLACE FUNCTION public.disposition_interview(
  p_source text,
  p_id uuid,
  p_field text,
  p_value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_source text := lower(COALESCE(p_source, ''));
  v_field text := lower(COALESCE(p_field, ''));
  v_at timestamptz;
  v_note text;
  v_calendly_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_source NOT IN ('manual', 'calendly', 'application') THEN
    RAISE EXCEPTION 'Invalid interview source: %', p_source;
  END IF;

  IF v_field NOT IN ('called', 'hired', 'passed', 'contracted', 'notes') THEN
    RAISE EXCEPTION 'Invalid disposition field: %', p_field;
  END IF;

  IF v_field = 'notes' THEN
    v_note := NULLIF(trim(COALESCE(p_value, '')), '');
  ELSE
    v_at := COALESCE(NULLIF(p_value, '')::timestamptz, now());
  END IF;

  IF v_source = 'manual' THEN
    IF v_field = 'called' THEN
      UPDATE public.manual_interview_entries
      SET called_at = v_at,
          called_outcome = COALESCE(called_outcome, 'connected'),
          updated_at = now()
      WHERE id = p_id;
    ELSIF v_field = 'hired' THEN
      UPDATE public.manual_interview_entries
      SET hired_at = v_at,
          passed_at = NULL,
          updated_at = now()
      WHERE id = p_id;
    ELSIF v_field = 'passed' THEN
      UPDATE public.manual_interview_entries
      SET passed_at = v_at,
          hired_at = NULL,
          contracted_at = NULL,
          updated_at = now()
      WHERE id = p_id;
    ELSIF v_field = 'contracted' THEN
      UPDATE public.manual_interview_entries
      SET contracted_at = v_at,
          updated_at = now()
      WHERE id = p_id;
    ELSE
      UPDATE public.manual_interview_entries
      SET outcome_notes = v_note,
          updated_at = now()
      WHERE id = p_id;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Interview not found';
    END IF;
    RETURN;
  END IF;

  IF v_source = 'calendly' THEN
    SELECT c.id
    INTO v_calendly_id
    FROM public.apex_scheduled_calls c
    WHERE public.uuid_from_text('calendly:' || c.id::text) = p_id;

    IF v_calendly_id IS NULL THEN
      RAISE EXCEPTION 'Interview not found';
    END IF;

    IF v_field = 'called' THEN
      UPDATE public.apex_scheduled_calls
      SET called_at = v_at,
          status = CASE WHEN status IS NULL OR status = 'scheduled' THEN 'completed' ELSE status END,
          updated_at = now()
      WHERE id = v_calendly_id;
    ELSIF v_field = 'hired' THEN
      UPDATE public.apex_scheduled_calls
      SET hired_at = v_at,
          passed_at = NULL,
          outcome = 'hired',
          status = 'completed',
          updated_at = now()
      WHERE id = v_calendly_id;
    ELSIF v_field = 'passed' THEN
      UPDATE public.apex_scheduled_calls
      SET passed_at = v_at,
          hired_at = NULL,
          contracted_at = NULL,
          outcome = 'passed',
          status = 'completed',
          updated_at = now()
      WHERE id = v_calendly_id;
    ELSIF v_field = 'contracted' THEN
      UPDATE public.apex_scheduled_calls
      SET contracted_at = v_at,
          outcome = 'contracted',
          status = 'completed',
          updated_at = now()
      WHERE id = v_calendly_id;
    ELSE
      UPDATE public.apex_scheduled_calls
      SET outcome_notes = v_note,
          updated_at = now()
      WHERE id = v_calendly_id;
    END IF;
    RETURN;
  END IF;

  IF v_field = 'called' THEN
    UPDATE public.applications
    SET contacted_at = COALESCE(contacted_at, v_at),
        first_contact_attempt_at = COALESCE(first_contact_attempt_at, v_at),
        last_contacted_at = v_at,
        status = CASE WHEN status::text IN ('new', 'lead') THEN 'interview'::public.application_status ELSE status END,
        updated_at = now()
    WHERE id = p_id;
  ELSIF v_field = 'hired' THEN
    UPDATE public.applications
    SET status = 'approved'::public.application_status,
        closed_at = COALESCE(closed_at, v_at),
        last_contacted_at = COALESCE(last_contacted_at, v_at),
        updated_at = now()
    WHERE id = p_id;
  ELSIF v_field = 'passed' THEN
    UPDATE public.applications
    SET status = 'rejected'::public.application_status,
        closed_at = COALESCE(closed_at, v_at),
        last_contacted_at = COALESCE(last_contacted_at, v_at),
        updated_at = now()
    WHERE id = p_id;
  ELSIF v_field = 'contracted' THEN
    UPDATE public.applications
    SET status = 'contracting'::public.application_status,
        contracted_at = COALESCE(contracted_at, v_at),
        last_contacted_at = COALESCE(last_contacted_at, v_at),
        updated_at = now()
    WHERE id = p_id;
  ELSE
    UPDATE public.applications
    SET notes = v_note,
        updated_at = now()
    WHERE id = p_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.disposition_interview(text, uuid, text, text) TO authenticated;

INSERT INTO public.manual_interview_entries (
  candidate_name,
  phone,
  email,
  instagram_handle,
  scheduled_at,
  interview_type,
  notes,
  source_application_id,
  created_at,
  updated_at
)
SELECT
  COALESCE(
    NULLIF(trim(concat_ws(' ', NULLIF(trim(a.first_name), ''), NULLIF(trim(a.last_name), ''))), ''),
    NULLIF(trim(a.email), ''),
    'Application ' || left(a.id::text, 8)
  ) AS candidate_name,
  a.phone,
  a.email,
  a.instagram_handle,
  a.created_at AS scheduled_at,
  COALESCE(NULLIF(a.status::text, ''), 'new') AS interview_type,
  a.notes,
  a.id AS source_application_id,
  a.created_at,
  now() AS updated_at
FROM public.applications a
WHERE a.created_at >= '2026-06-01'::timestamptz
  AND a.status IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.manual_interview_entries m
    WHERE m.source_application_id = a.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.manual_interview_entries m
    WHERE lower(COALESCE(m.email, '')) = lower(COALESCE(a.email, ''))
      AND m.scheduled_at = a.created_at
  )
ON CONFLICT DO NOTHING;
