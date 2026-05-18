-- ═══════════════════════════════════════════════════════════════════════════
-- XCEL Solutions Pre-Licensing Daily Report Ingestion
-- 2026-05-17 — Sam: "every single day I get an email...you have access to my
-- email...figure out what the fuck is going on and who's stalled."
--
-- Stores the daily XCEL report so the dashboard always reflects today's
-- pre-licensing course state, and the row-level student data is matchable
-- back to applications.id for per-applicant drilldown.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Snapshot header (1 row per email received) ────────────────────────────
CREATE TABLE IF NOT EXISTS xcel_pre_licensing_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date         date NOT NULL UNIQUE,
  enrolled_last_30d   integer,
  enrolled_last_7d    integer,
  active_last_10d     integer,
  active_pipeline     integer,
  pct_completed       numeric,
  raw_html            text,
  raw_payload         jsonb,
  received_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── Per-student rows for that snapshot ────────────────────────────────────
CREATE TABLE IF NOT EXISTS xcel_pre_licensing_students (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id           uuid NOT NULL REFERENCES xcel_pre_licensing_reports(id) ON DELETE CASCADE,
  course_section      text NOT NULL,            -- 'code_and_ethics' | 'life_only' | 'life_and_health'
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  date_enrolled       date,
  last_log_in         date,
  time_spent_minutes  integer,
  pct_complete        numeric,
  date_completed      date,
  course_name         text,
  hiring_manager_name text,
  application_id      uuid REFERENCES applications(id) ON DELETE SET NULL,
  matched_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xcel_stu_report ON xcel_pre_licensing_students(report_id);
CREATE INDEX IF NOT EXISTS idx_xcel_stu_email  ON xcel_pre_licensing_students(lower(email));
CREATE INDEX IF NOT EXISTS idx_xcel_stu_appid  ON xcel_pre_licensing_students(application_id);

ALTER TABLE xcel_pre_licensing_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE xcel_pre_licensing_students ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY xcel_reports_admin_all ON xcel_pre_licensing_reports
    FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY xcel_stu_admin_all ON xcel_pre_licensing_students
    FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY xcel_stu_agent_self ON xcel_pre_licensing_students
    FOR SELECT USING (
      application_id IN (
        SELECT id FROM applications
        WHERE assigned_agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
           OR recruiter_id     IN (SELECT id FROM agents WHERE user_id = auth.uid())
           OR hiring_manager_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Matching function: link XCEL students to applications by email/name ───
CREATE OR REPLACE FUNCTION fn_match_xcel_students()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Then by name + state-less email-domain proximity (lowest priority)
  -- Skipped — too many false positives without more constraints.

  -- Propagate progress back to applications.license_progress
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
END $$;

GRANT EXECUTE ON FUNCTION fn_match_xcel_students() TO authenticated;

-- ─── Convenience view: latest snapshot + matched applications ──────────────
CREATE OR REPLACE VIEW v_xcel_latest AS
WITH latest AS (
  SELECT id FROM xcel_pre_licensing_reports ORDER BY report_date DESC LIMIT 1
)
SELECT
  s.id,
  s.course_section,
  s.course_name,
  s.first_name,
  s.last_name,
  s.email,
  s.phone,
  s.date_enrolled,
  s.last_log_in,
  s.time_spent_minutes,
  s.pct_complete,
  s.date_completed,
  s.hiring_manager_name,
  s.application_id,
  s.matched_at,
  a.status                       AS application_status,
  a.license_progress             AS application_license_progress,
  a.contacted_at                 AS application_contacted_at,
  COALESCE(ag.display_name, p.full_name) AS assigned_agent_name,
  (CURRENT_DATE - s.last_log_in) AS days_since_login,
  (CASE
     WHEN s.pct_complete >= 100 THEN 'completed'
     WHEN s.last_log_in IS NULL OR (CURRENT_DATE - s.last_log_in) > 7 THEN 'stalled'
     WHEN s.pct_complete >= 75 THEN 'almost_done'
     WHEN s.pct_complete >= 25 THEN 'in_progress'
     ELSE 'just_started'
   END) AS health_bucket
FROM xcel_pre_licensing_students s
LEFT JOIN applications a  ON a.id = s.application_id
LEFT JOIN agents       ag ON ag.id = a.assigned_agent_id
LEFT JOIN profiles     p  ON p.id = ag.profile_id
WHERE s.report_id = (SELECT id FROM latest);

GRANT SELECT ON v_xcel_latest TO authenticated;

COMMIT;
