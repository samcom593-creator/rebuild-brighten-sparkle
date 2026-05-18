-- ═══════════════════════════════════════════════════════════════════════════
-- Repair fn_match_xcel_students — bad type cast in body
-- 2026-05-18 — the live function body still references the non-existent
-- type `license_progress_t`. The actual enum is `license_progress`. The
-- file-level fix in 20260517020000 was masked by the migration already
-- being marked applied in supabase_migrations.schema_migrations, so the
-- function body was never refreshed. Without this repair, the seed migration
-- 20260517020100_seed_xcel_2026_05_17.sql blocks indefinitely on the
-- SELECT fn_match_xcel_students() call.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_match_xcel_students()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_matched integer := 0;
BEGIN
  -- Match by email first (highest signal)
  UPDATE xcel_pre_licensing_students s
  SET application_id = a.id, matched_at = now()
  FROM applications a
  WHERE s.application_id IS NULL
    AND s.email IS NOT NULL
    AND lower(a.email) = lower(s.email)
    AND a.terminated_at IS NULL;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- Then by phone fallback (last 10 digits)
  WITH digits AS (
    SELECT s.id AS sid, regexp_replace(s.phone, '\D', '', 'g') AS sp
    FROM xcel_pre_licensing_students s
    WHERE s.application_id IS NULL AND s.phone IS NOT NULL
  ),
  matched AS (
    SELECT d.sid, a.id AS aid
    FROM digits d
    JOIN applications a ON regexp_replace(a.phone, '\D', '', 'g') = d.sp
                       AND a.terminated_at IS NULL
                       AND length(d.sp) >= 10
  )
  UPDATE xcel_pre_licensing_students s
  SET application_id = m.aid, matched_at = now()
  FROM matched m
  WHERE s.id = m.sid;

  -- Propagate progress back to applications.license_progress (real type).
  UPDATE applications a
  SET
    license_progress = (
      CASE
        WHEN s.pct_complete >= 100 AND a.license_progress NOT IN ('test_scheduled','waiting_on_license','fingerprints_done','licensed')
          THEN 'finished_course'::license_progress
        WHEN s.pct_complete > 0 AND a.license_progress = 'unlicensed'
          THEN 'course_purchased'::license_progress
        ELSE a.license_progress
      END
    ),
    course_started_at = COALESCE(a.course_started_at, s.date_enrolled::timestamptz),
    course_purchased_at = COALESCE(a.course_purchased_at, s.date_enrolled::timestamptz)
  FROM xcel_pre_licensing_students s
  WHERE s.application_id = a.id
    AND s.report_id = (SELECT id FROM xcel_pre_licensing_reports ORDER BY report_date DESC LIMIT 1)
    AND a.terminated_at IS NULL;

  RETURN v_matched;
END
$function$;

COMMIT;
