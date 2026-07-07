-- MP-251: XCEL license progress auto-upgrade + contact logging revamp
-- Idempotent; safe to re-run.

-- ============================================================
-- 1. Extend application_contact_log
-- ============================================================
ALTER TABLE application_contact_log
  ALTER COLUMN logged_by SET DEFAULT auth.uid();

-- ============================================================
-- 2. RPC log_contact_attempt
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_contact_attempt(
  p_application_id uuid,
  p_channel text,
  p_outcome text,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO application_contact_log (application_id, channel, outcome, notes, logged_by)
  VALUES (p_application_id, p_channel, p_outcome, p_notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_contact_attempt(uuid, text, text, text) TO authenticated;

-- ============================================================
-- 3. Extend unified_mark_contacted
-- ============================================================
DROP FUNCTION IF EXISTS public.unified_mark_contacted(uuid, text);
DROP FUNCTION IF EXISTS public.unified_mark_contacted(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.unified_mark_contacted(
  p_id uuid,
  p_source text,
  p_by_user_id uuid DEFAULT auth.uid()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_source = 'aged_lead' OR p_source = 'aged_leads' THEN
    UPDATE aged_leads
      SET last_contacted_at = now(),
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = p_id;
  ELSE
    UPDATE applications
      SET last_contacted_at = now(),
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = p_id;

    IF p_source = 'applied' OR p_source = 'application' OR p_source = 'applications' OR p_source IS NULL THEN
      INSERT INTO application_contact_log (application_id, channel, outcome, notes, logged_by)
      VALUES (p_id, 'contact', 'marked_contacted', NULL, p_by_user_id);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unified_mark_contacted(uuid, text, uuid) TO authenticated;

-- ============================================================
-- 5. fn_xcel_stage_rank
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_xcel_stage_rank(p_stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'unlicensed' THEN 0
    WHEN 'course_purchased' THEN 1
    WHEN 'in_field_training' THEN 1
    WHEN 'finished_course' THEN 2
    WHEN 'test_scheduled' THEN 3
    WHEN 'exam_passed' THEN 4
    WHEN 'passed_test' THEN 4
    WHEN 'waiting_fingerprints' THEN 5
    WHEN 'fingerprints_done' THEN 6
    WHEN 'waiting_on_license' THEN 7
    WHEN 'licensed' THEN 8
    WHEN 'failed_test' THEN -1
    ELSE 0
  END;
$$;

-- ============================================================
-- 4. View v_xcel_stage_gaps
-- ============================================================
CREATE OR REPLACE VIEW public.v_xcel_stage_gaps AS
WITH derived AS (
  SELECT
    a.id AS application_id,
    a.email,
    a.first_name,
    a.last_name,
    a.license_progress AS current_progress,
    a.license_status AS current_status,
    p.overall_pct_max,
    p.final_exam_score_max,
    p.national_producer_number,
    CASE
      WHEN COALESCE(p.final_exam_score_max, 0) >= 70 AND COALESCE(p.overall_pct_max, 0) >= 100 THEN 'passed_test'
      WHEN COALESCE(p.overall_pct_max, 0) >= 100 THEN 'finished_course'
      WHEN COALESCE(p.overall_pct_max, 0) > 0 THEN 'course_purchased'
      ELSE 'unlicensed'
    END AS derived_progress_raw,
    CASE
      WHEN p.national_producer_number IS NOT NULL AND length(trim(p.national_producer_number)) >= 4 THEN 'licensed'
      ELSE a.license_status::text
    END AS derived_status
  FROM applications a
  JOIN v_xcel_person_progress p
    ON lower(p.email) = lower(a.email)
)
SELECT
  application_id,
  email,
  first_name,
  last_name,
  current_progress,
  current_status,
  CASE
    WHEN derived_status = 'licensed' THEN 'licensed'
    ELSE derived_progress_raw
  END AS derived_progress,
  derived_status,
  CASE
    WHEN derived_status = 'licensed' AND current_status::text <> 'licensed' THEN 'npn_present'
    WHEN derived_progress_raw = 'passed_test' AND fn_xcel_stage_rank(current_progress::text) < 4 THEN 'exam_passed_and_100pct'
    WHEN derived_progress_raw = 'finished_course' AND fn_xcel_stage_rank(current_progress::text) < 2 THEN 'course_100pct'
    WHEN derived_progress_raw = 'course_purchased' AND fn_xcel_stage_rank(current_progress::text) < 1 THEN 'course_progress_started'
    ELSE 'stricter_derived'
  END AS delta_reason,
  overall_pct_max,
  final_exam_score_max,
  national_producer_number
FROM derived
WHERE
  fn_xcel_stage_rank(
    CASE WHEN derived_status = 'licensed' THEN 'licensed' ELSE derived_progress_raw END
  ) > fn_xcel_stage_rank(current_progress::text)
  OR (derived_status = 'licensed' AND current_status::text <> 'licensed');

GRANT SELECT ON public.v_xcel_stage_gaps TO authenticated;

-- ============================================================
-- 6. fn_xcel_auto_upgrade_all
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_xcel_auto_upgrade_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT application_id, current_progress, derived_progress, derived_status
    FROM v_xcel_stage_gaps
  LOOP
    IF fn_xcel_stage_rank(r.derived_progress) > fn_xcel_stage_rank(r.current_progress::text) THEN
      UPDATE applications
        SET license_progress = r.derived_progress::license_progress,
            license_status = CASE
              WHEN r.derived_status = 'licensed' THEN 'licensed'::license_status
              ELSE license_status
            END,
            exam_passed_at = COALESCE(
              exam_passed_at,
              CASE
                WHEN r.derived_progress IN ('passed_test', 'waiting_on_license', 'licensed') THEN now()
                ELSE NULL
              END
            ),
            updated_at = now()
        WHERE id = r.application_id;
      v_count := v_count + 1;
    ELSIF r.derived_status = 'licensed' THEN
      UPDATE applications
        SET license_status = 'licensed'::license_status,
            updated_at = now()
        WHERE id = r.application_id
          AND license_status::text <> 'licensed';
      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_xcel_auto_upgrade_all() TO authenticated;

-- ============================================================
-- 7. Trigger trg_xcel_events_auto_upgrade
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_xcel_events_auto_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aid uuid;
  v_current_rank integer;
  v_full_name text;
BEGIN
  SELECT id INTO v_aid
  FROM applications
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF v_aid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Passed test upgrade
  IF COALESCE(NEW.overall_pct, 0) >= 100 AND COALESCE(NEW.final_exam_score, 0) >= 70 THEN
    SELECT fn_xcel_stage_rank(license_progress::text) INTO v_current_rank
    FROM applications WHERE id = v_aid;

    IF v_current_rank < 4 THEN
      UPDATE applications
        SET license_progress = 'passed_test'::license_progress,
            exam_passed_at = COALESCE(exam_passed_at, now()),
            updated_at = now()
        WHERE id = v_aid;

      v_full_name := COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '');
      PERFORM pg_notify(
        'apex_xcel_passed_test',
        json_build_object(
          'application_id', v_aid,
          'email', NEW.email,
          'score', NEW.final_exam_score,
          'name', trim(v_full_name)
        )::text
      );
    ELSIF (SELECT exam_passed_at FROM applications WHERE id = v_aid) IS NULL THEN
      UPDATE applications
        SET exam_passed_at = now(),
            updated_at = now()
        WHERE id = v_aid;
    END IF;
  END IF;

  -- NPN present -> licensed
  IF NEW.national_producer_number IS NOT NULL AND length(trim(NEW.national_producer_number)) >= 4 THEN
    UPDATE applications
      SET license_status = 'licensed'::license_status,
          updated_at = now()
      WHERE id = v_aid
        AND license_status::text <> 'licensed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_xcel_events_auto_upgrade ON xcel_events;
CREATE TRIGGER trg_xcel_events_auto_upgrade
  AFTER INSERT ON xcel_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_xcel_events_auto_upgrade();

-- ============================================================
-- 8. pg_cron: xcel_auto_upgrade_stages every 15 min
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'xcel_auto_upgrade_stages'
  ) THEN
    PERFORM cron.schedule(
      'xcel_auto_upgrade_stages',
      '*/15 * * * *',
      $cron$SELECT fn_xcel_auto_upgrade_all()$cron$
    );
  END IF;
END;
$$;

-- ============================================================
-- 9. Inline backfill (triggers disabled to avoid pg_net/Discord fan-out spam
-- and OOM in Edge Function context; the auto-upgrade cron will re-check
-- every 15 minutes so a skipped backfill is self-healing.)
-- ============================================================
DO $backfill$
DECLARE
  v_upgraded integer := 0;
BEGIN
  BEGIN
    SET LOCAL session_replication_role = 'replica';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    v_upgraded := fn_xcel_auto_upgrade_all();
    RAISE NOTICE 'mp251 backfill upgraded: %', v_upgraded;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'mp251 backfill skipped: %', SQLERRM;
  END;
END;
$backfill$;
