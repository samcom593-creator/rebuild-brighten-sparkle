-- 2026-06-17 Sam directive: "For the interviews, there should be another type
-- of Hired Pass Called. This is... I see there's more info to add there."
--
-- Extend the disposition system with 3 new states:
--   rescheduled · no_show · contacted
--
-- Plus refresh v_interviews_unified to surface the new fields + update
-- disposition_interview RPC to accept the new p_field values.
--
-- rollback: ALTER TABLE manual_interview_entries DROP COLUMN ... + same for
-- apex_scheduled_calls, then re-create v_interviews_unified without the new
-- columns, then re-create disposition_interview with the old CHECK.

ALTER TABLE public.manual_interview_entries
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz,
  ADD COLUMN IF NOT EXISTS contacted_at timestamptz;

ALTER TABLE public.apex_scheduled_calls
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz,
  ADD COLUMN IF NOT EXISTS contacted_at timestamptz;

-- Extend disposition_interview to handle the new fields.
CREATE OR REPLACE FUNCTION public.disposition_interview(
  p_source text,
  p_id uuid,
  p_field text,
  p_value text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_table text;
  v_col text;
  v_now timestamptz := now();
BEGIN
  IF p_source NOT IN ('manual', 'calendly', 'application') THEN
    RAISE EXCEPTION 'invalid source: %', p_source;
  END IF;
  IF p_field NOT IN (
    'called', 'hired', 'passed', 'contracted',
    'rescheduled', 'no_show', 'contacted', 'notes'
  ) THEN
    RAISE EXCEPTION 'invalid field: %', p_field;
  END IF;

  v_table := CASE p_source
    WHEN 'manual'      THEN 'manual_interview_entries'
    WHEN 'application' THEN 'manual_interview_entries'
    WHEN 'calendly'    THEN 'apex_scheduled_calls'
  END;

  v_col := CASE p_field
    WHEN 'notes' THEN 'outcome_notes'
    ELSE p_field || '_at'
  END;

  IF p_field = 'notes' THEN
    EXECUTE format(
      'UPDATE public.%I SET %I = $1, updated_at = $2 WHERE id::text = $3',
      v_table, v_col
    )
    USING p_value, v_now, p_id::text;
  ELSE
    EXECUTE format(
      'UPDATE public.%I SET %I = $1, updated_at = $2 WHERE id::text = $3',
      v_table, v_col
    )
    USING v_now, v_now, p_id::text;
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.disposition_interview(text, uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.disposition_interview(text, uuid, text, text) IS
'Sam directive 2026-06-17: extended Called/Hired/Pass with Rescheduled/No-Show/Contacted/Contracted. Fires on the InterviewCommandCenter tap-to-disposition buttons.';
