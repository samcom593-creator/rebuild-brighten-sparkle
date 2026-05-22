-- P1-6 Licensing Tracker MVP — JustInsurance 8-stage pattern
-- Full spec at /Users/samjames/business-ops/apex-os-week/specs/PRELICENSING-NEXT-WEEK.md
-- This migration ships the schema + canonical view + readiness rollup function.
-- The student-facing course player (study-tick + practice exams + state laws)
-- is the Monday 2026-05-26 build per the spec.

-- 8-stage licensing pipeline (per REFERENCE-JUSTINSURANCE-PATTERNS.md §1)
DO $$ BEGIN
  CREATE TYPE public.licensing_stage AS ENUM (
    'enrolled', 'not_responding', 'waiting_to_schedule',
    'calendar_sent', 'booked', 'exam_passed', 'exam_failed', 'quit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.licensing_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL CHECK (length(state) = 2),
  line text NOT NULL CHECK (line IN ('life','health','life_health','property_casualty')),
  required_hours numeric NOT NULL,
  video_minutes_required int DEFAULT 0,
  practice_exams_required int DEFAULT 3,
  content_url text,
  provider text DEFAULT 'tbd',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(state, line, provider)
);

CREATE TABLE IF NOT EXISTS public.licensing_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.licensing_courses(id),
  state text,
  line text,
  current_stage public.licensing_stage NOT NULL DEFAULT 'enrolled',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz,
  target_exam_date date,
  exam_scheduled_at timestamptz,
  exam_passed_at timestamptz,
  exam_failed_at timestamptz,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(application_id)
);

CREATE INDEX IF NOT EXISTS licensing_students_stage_idx ON public.licensing_students(current_stage);
CREATE INDEX IF NOT EXISTS licensing_students_state_idx ON public.licensing_students(state);

-- updated_at + stage_changed_at touch trigger
CREATE OR REPLACE FUNCTION public.tg_licensing_students_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
    NEW.stage_changed_at = now();
  END IF;
  IF NEW.current_stage = 'exam_passed' AND OLD.current_stage <> 'exam_passed' THEN
    NEW.exam_passed_at = now();
  ELSIF NEW.current_stage = 'exam_failed' AND OLD.current_stage <> 'exam_failed' THEN
    NEW.exam_failed_at = now();
  ELSIF NEW.current_stage = 'booked' AND OLD.current_stage <> 'booked' THEN
    NEW.exam_scheduled_at = now();
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_licensing_students_touch ON public.licensing_students;
CREATE TRIGGER trg_licensing_students_touch BEFORE UPDATE ON public.licensing_students
  FOR EACH ROW EXECUTE FUNCTION public.tg_licensing_students_touch();

-- Auto-enroll trigger: when an application flips to paid, INSERT a licensing_student row
CREATE OR REPLACE FUNCTION public.tg_application_paid_auto_enroll_license() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status <> 'paid') THEN
    INSERT INTO public.licensing_students (application_id, state, line)
    VALUES (NEW.id, NEW.state, COALESCE(NEW.carrier, 'life_health'))
    ON CONFLICT (application_id) DO NOTHING;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_application_paid_auto_enroll_license ON public.applications;
CREATE TRIGGER trg_application_paid_auto_enroll_license
  AFTER UPDATE ON public.applications
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM NEW.status))
  EXECUTE FUNCTION public.tg_application_paid_auto_enroll_license();

-- Kanban view: ALL students + their current stage + days-in-stage + applicant name
CREATE OR REPLACE VIEW public.v_licensing_kanban AS
  SELECT
    ls.id,
    ls.application_id,
    ls.current_stage,
    ls.state,
    ls.line,
    ls.enrolled_at,
    ls.stage_changed_at,
    ls.target_exam_date,
    ls.exam_scheduled_at,
    EXTRACT(EPOCH FROM (now() - ls.stage_changed_at))/86400 AS days_in_stage,
    EXTRACT(EPOCH FROM (now() - ls.enrolled_at))/86400 AS days_since_enroll,
    a.first_name,
    a.last_name,
    a.email,
    a.phone
  FROM public.licensing_students ls
  LEFT JOIN public.applications a ON a.id = ls.application_id;

-- Stage-summary view for the kanban headers
CREATE OR REPLACE VIEW public.v_licensing_stage_counts AS
  SELECT current_stage::text AS stage, count(*) AS count
  FROM public.licensing_students
  GROUP BY current_stage;

-- Backfill: any application currently in stage='paid' AND not yet enrolled → enroll
INSERT INTO public.licensing_students (application_id, state, line)
SELECT a.id, a.state, 'life_health'
FROM public.applications a
LEFT JOIN public.licensing_students ls ON ls.application_id = a.id
WHERE a.status = 'paid' AND ls.id IS NULL
ON CONFLICT (application_id) DO NOTHING;

-- Readiness rollup function — MVP version
-- Returns YELLOW always for now since we don't have practice_exam_attempts /
-- course_study_minutes / state_laws_completions populated yet. The full
-- readiness lights up when the student-facing course player ships per
-- PRELICENSING-NEXT-WEEK.md. Returning a useful shape now so the frontend
-- doesn't have to refactor when those tables land.
CREATE OR REPLACE FUNCTION public.fn_licensing_readiness(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_student public.licensing_students%ROWTYPE;
  v_days_since_enroll numeric;
BEGIN
  SELECT * INTO v_student FROM public.licensing_students WHERE id = p_student_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  v_days_since_enroll := EXTRACT(EPOCH FROM (now() - v_student.enrolled_at))/86400;

  RETURN jsonb_build_object(
    'stage', v_student.current_stage,
    'days_since_enroll', round(v_days_since_enroll::numeric, 1),
    'practice', jsonb_build_object('consecutive_passes', 0, 'required', 3, 'status', 'no_data'),
    'time', jsonb_build_object('spent_min', 0, 'required_min', 1800, 'status', 'no_data'),
    'state_laws', jsonb_build_object('completions', 0, 'required', 1, 'status', 'no_data'),
    'videos', jsonb_build_object('life_min', 0, 'health_min', 0, 'status', 'no_data'),
    'overall', CASE
      WHEN v_student.current_stage = 'exam_passed' THEN 'PASSED'
      WHEN v_student.current_stage = 'exam_failed' THEN 'FAILED'
      WHEN v_student.current_stage = 'quit' THEN 'QUIT'
      WHEN v_student.current_stage = 'booked' THEN 'YELLOW'
      WHEN v_days_since_enroll > 14 AND v_student.current_stage IN ('enrolled','not_responding') THEN 'RED'
      ELSE 'YELLOW'
    END,
    'note', 'Readiness MVP: only stage + days-since-enroll heuristic. Full readiness lights up when course player (study-tick + practice exams) ships Monday per PRELICENSING-NEXT-WEEK.md.'
  );
END$$;

-- Stalled-flag function: returns students past SLA per stage
-- Per Sam's spec: 48h Stage 2, 7d Stage 3, 14d Stage 4
CREATE OR REPLACE VIEW public.v_licensing_stalled AS
  SELECT
    id, application_id, current_stage, state,
    days_in_stage,
    first_name, last_name, email, phone,
    CASE
      WHEN current_stage = 'not_responding'      AND days_in_stage > 2  THEN '48h SLA breached'
      WHEN current_stage = 'waiting_to_schedule' AND days_in_stage > 7  THEN '7d SLA breached'
      WHEN current_stage = 'calendar_sent'       AND days_in_stage > 14 THEN '14d SLA breached'
      WHEN current_stage = 'enrolled'            AND days_in_stage > 7  THEN '7d enrolled-no-movement'
      ELSE NULL
    END AS stall_reason
  FROM public.v_licensing_kanban
  WHERE (current_stage = 'not_responding' AND days_in_stage > 2)
     OR (current_stage = 'waiting_to_schedule' AND days_in_stage > 7)
     OR (current_stage = 'calendar_sent' AND days_in_stage > 14)
     OR (current_stage = 'enrolled' AND days_in_stage > 7);
