-- PL-MP240 (2026-07-05): v_hot_licensing_prospects — exclude already-hired applicants.
-- Sam directive: Recovery Queue was showing applicants who have since become
-- active agents. Add NOT EXISTS filter against agents (status='active' and
-- NOT is_deactivated), matching by:
--   (1) source_application_id direct link (canonical), OR
--   (2) profile email (case-insensitive), OR
--   (3) profile phone (digits-only equality).
-- UI rename: "Recovery Queue" -> "Bring Them Back". Route path unchanged.

CREATE OR REPLACE VIEW public.v_hot_licensing_prospects AS
SELECT
  applications.id AS application_id,
  (applications.first_name || ' '::text) || applications.last_name AS name,
  applications.phone,
  applications.email,
  applications.state,
  applications.license_status,
  applications.license_progress,
  applications.course_purchased_at::date AS course_purchased,
  applications.exam_scheduled_at::date   AS exam_scheduled,
  applications.exam_passed_at::date      AS exam_passed,
  applications.licensed_at::date         AS licensed_date,
  applications.assigned_agent_id,
  applications.last_contacted_at,
  CASE
    WHEN applications.license_progress = 'waiting_on_license'::license_progress THEN 'A_WAITING_ON_LICENSE'::text
    WHEN applications.license_progress = 'passed_test'::license_progress        THEN 'B_PASSED_TEST_NO_LIC_YET'::text
    WHEN applications.license_progress = 'test_scheduled'::license_progress     THEN 'C_TEST_SCHEDULED'::text
    WHEN applications.license_progress = 'finished_course'::license_progress    THEN 'D_FINISHED_COURSE_NO_EXAM'::text
    WHEN applications.license_progress = 'course_purchased'::license_progress
         AND applications.started_training IS NOT TRUE                          THEN 'E_BOUGHT_NEVER_STARTED'::text
    WHEN applications.license_progress = 'course_purchased'::license_progress   THEN 'F_COURSE_IN_PROGRESS'::text
    ELSE 'G_UNLICENSED_STARTER'::text
  END AS cohort,
  EXTRACT(days FROM now() - COALESCE(applications.last_contacted_at, applications.updated_at))::integer AS days_since_touch
FROM public.applications
WHERE applications.terminated_at IS NULL
  AND applications.license_status = ANY (ARRAY['unlicensed'::license_status, 'pending'::license_status])
  AND applications.phone IS NOT NULL
  AND length(applications.phone) >= 10
  -- PL-MP240: exclude applicants who have already been hired as active agents.
  AND NOT EXISTS (
    SELECT 1
    FROM public.agents ag
    LEFT JOIN public.profiles p ON p.id = ag.profile_id
    WHERE ag.status = 'active'
      AND ag.is_deactivated IS NOT TRUE
      AND (
        ag.source_application_id = applications.id
        OR (p.email IS NOT NULL AND applications.email IS NOT NULL
            AND LOWER(p.email) = LOWER(applications.email))
        OR (p.phone IS NOT NULL AND applications.phone IS NOT NULL
            AND REGEXP_REPLACE(p.phone, '\D', '', 'g') =
                REGEXP_REPLACE(applications.phone, '\D', '', 'g')
            AND length(REGEXP_REPLACE(applications.phone, '\D', '', 'g')) >= 10)
      )
  )
ORDER BY
  CASE
    WHEN applications.license_progress = 'waiting_on_license'::license_progress THEN 1
    WHEN applications.license_progress = 'passed_test'::license_progress        THEN 2
    WHEN applications.license_progress = 'test_scheduled'::license_progress     THEN 3
    WHEN applications.license_progress = 'finished_course'::license_progress    THEN 4
    WHEN applications.license_progress = 'course_purchased'::license_progress
         AND applications.started_training IS NOT TRUE                          THEN 5
    WHEN applications.license_progress = 'course_purchased'::license_progress   THEN 6
    ELSE 7
  END,
  COALESCE(applications.last_contacted_at, applications.updated_at) NULLS FIRST;
