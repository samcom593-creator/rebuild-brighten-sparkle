-- Builder operating layer for Sam's recruiting agency OS.
-- Additive only: existing dashboard/routes keep their tables and views.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS builder_track text NOT NULL DEFAULT 'agent';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS agency_owner_qualified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_builder_track_check'
      AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_builder_track_check
      CHECK (builder_track IN ('agent', 'manager_track', 'agency_owner_track'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_builder_track_live
  ON public.agents (builder_track)
  WHERE COALESCE(is_deactivated, false) = false;

CREATE INDEX IF NOT EXISTS idx_agents_manager_id_live
  ON public.agents (manager_id)
  WHERE COALESCE(is_deactivated, false) = false;

CREATE INDEX IF NOT EXISTS idx_applications_referrer_agent_id
  ON public.applications (referrer_agent_id)
  WHERE referrer_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_referral_manager_id
  ON public.applications (referral_manager_id)
  WHERE referral_manager_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_builder_track_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  NEW.builder_track := COALESCE(NEW.builder_track, 'agent');

  -- Service-role edge functions perform their own role checks. System jobs and
  -- migrations may not have auth.uid(), so let those pass.
  IF jwt_role = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (
    TG_OP = 'INSERT'
    AND NEW.builder_track <> 'agent'
  ) OR (
    TG_OP = 'UPDATE'
    AND NEW.builder_track IS DISTINCT FROM OLD.builder_track
  ) THEN
    IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Only admins can assign builder tracks'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_builder_track_admin_only_trigger ON public.agents;

CREATE TRIGGER enforce_builder_track_admin_only_trigger
BEFORE INSERT OR UPDATE OF builder_track ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.enforce_builder_track_admin_only();

CREATE OR REPLACE VIEW public.v_builder_operating_dashboard AS
WITH RECURSIVE live_agents AS (
  SELECT *
  FROM public.agents
  WHERE COALESCE(is_deactivated, false) = false
),
hierarchy AS (
  SELECT
    a.id AS root_agent_id,
    a.id AS agent_id,
    0 AS depth,
    ARRAY[a.id] AS path
  FROM live_agents a

  UNION ALL

  SELECT
    h.root_agent_id,
    child.id AS agent_id,
    h.depth + 1 AS depth,
    h.path || child.id AS path
  FROM hierarchy h
  JOIN live_agents child
    ON child.invited_by_manager_id = h.agent_id
    OR child.manager_id = h.agent_id
  WHERE child.id <> ALL (h.path)
    AND h.depth < 8
),
agent_rollup AS (
  SELECT
    h.root_agent_id,
    COUNT(*) FILTER (WHERE h.depth = 1)::int AS direct_agent_count,
    COUNT(*) FILTER (WHERE h.depth > 0)::int AS total_downline_count,
    COUNT(*) FILTER (
      WHERE h.depth > 0
        AND child.status = 'active'::public.agent_status
        AND COALESCE(child.is_inactive, false) = false
    )::int AS active_agent_count,
    COUNT(*) FILTER (
      WHERE h.depth > 0
        AND child.license_status = 'licensed'::public.license_status
    )::int AS licensed_agent_count,
    COUNT(*) FILTER (
      WHERE h.depth > 0
        AND child.license_status <> 'licensed'::public.license_status
    )::int AS unlicensed_agent_count,
    COUNT(*) FILTER (
      WHERE h.depth > 0
        AND child.created_at >= date_trunc('month', now())
    )::int AS hires_this_month,
    MAX(child.updated_at) FILTER (WHERE h.depth > 0) AS last_agent_activity_at
  FROM hierarchy h
  LEFT JOIN live_agents child ON child.id = h.agent_id
  GROUP BY h.root_agent_id
),
application_links AS (
  SELECT DISTINCT h.root_agent_id, app.id AS application_id
  FROM hierarchy h
  JOIN public.applications app ON app.referrer_agent_id = h.agent_id
  WHERE COALESCE(app.is_duplicate, false) = false

  UNION

  SELECT DISTINCT h.root_agent_id, app.id AS application_id
  FROM hierarchy h
  JOIN public.applications app ON app.referral_manager_id = h.agent_id
  WHERE COALESCE(app.is_duplicate, false) = false

  UNION

  SELECT DISTINCT h.root_agent_id, app.id AS application_id
  FROM hierarchy h
  JOIN public.applications app ON app.recruiter_id = h.agent_id
  WHERE COALESCE(app.is_duplicate, false) = false

  UNION

  SELECT DISTINCT h.root_agent_id, app.id AS application_id
  FROM hierarchy h
  JOIN public.applications app ON app.assigned_agent_id = h.agent_id
  WHERE COALESCE(app.is_duplicate, false) = false
),
application_rollup AS (
  SELECT
    al.root_agent_id,
    COUNT(DISTINCT app.id)::int AS applicant_count,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.license_status = 'licensed'::public.license_status
        OR app.license_progress = 'licensed'::public.license_progress
        OR app.licensed_at IS NOT NULL
        OR app.license_approved_at IS NOT NULL
    )::int AS licensed_recruits,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.status::text NOT IN ('rejected', 'disqualified', 'lapsed')
        AND NOT (
          app.license_status = 'licensed'::public.license_status
          OR app.license_progress = 'licensed'::public.license_progress
          OR app.licensed_at IS NOT NULL
          OR app.license_approved_at IS NOT NULL
        )
    )::int AS unlicensed_recruits,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.license_progress IN (
        'finished_course'::public.license_progress,
        'test_scheduled'::public.license_progress,
        'passed_test'::public.license_progress,
        'exam_passed'::public.license_progress,
        'fingerprints_done'::public.license_progress,
        'waiting_fingerprints'::public.license_progress,
        'waiting_on_license'::public.license_progress,
        'licensed'::public.license_progress,
        'in_field_training'::public.license_progress
      )
    )::int AS coursework_completed_count,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.status::text IN ('paid', 'onboarding', 'producing')
        OR COALESCE(app.ica_paid, false) = true
        OR app.ica_paid_at IS NOT NULL
        OR app.contracted_at IS NOT NULL
        OR app.first_deal_at IS NOT NULL
    )::int AS activation_count,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.status::text NOT IN ('rejected', 'disqualified', 'lapsed')
        AND (
          COALESCE(app.is_ghosted, false) = true
          OR app.next_action_due_at < now()
          OR app.next_step_due_at < now()
          OR (
            app.license_status = 'unlicensed'::public.license_status
            AND app.created_at < now() - interval '7 days'
            AND app.course_purchased_at IS NULL
            AND app.course_started_at IS NULL
          )
          OR (
            app.license_progress IN (
              'unlicensed'::public.license_progress,
              'course_purchased'::public.license_progress
            )
            AND app.updated_at < now() - interval '10 days'
          )
        )
    )::int AS stuck_applicants,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.created_at >= date_trunc('month', now())
    )::int AS applicants_this_month,
    MAX(app.updated_at) AS last_application_activity_at
  FROM application_links al
  JOIN public.applications app ON app.id = al.application_id
  GROUP BY al.root_agent_id
),
personal_referral_rollup AS (
  SELECT
    a.id AS root_agent_id,
    COUNT(DISTINCT app.id)::int AS applicants_from_referral_link,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.license_status = 'licensed'::public.license_status
        OR app.license_progress = 'licensed'::public.license_progress
        OR app.licensed_at IS NOT NULL
        OR app.license_approved_at IS NOT NULL
    )::int AS licensed_from_referral_link,
    COUNT(DISTINCT app.id) FILTER (
      WHERE app.status::text IN ('paid', 'onboarding', 'producing')
        OR COALESCE(app.ica_paid, false) = true
        OR app.ica_paid_at IS NOT NULL
        OR app.contracted_at IS NOT NULL
        OR app.first_deal_at IS NOT NULL
    )::int AS activated_from_referral_link
  FROM live_agents a
  LEFT JOIN public.applications app
    ON (
      app.referrer_agent_id = a.id
      OR app.referral_manager_id = a.id
      OR app.recruiter_id = a.id
    )
    AND COALESCE(app.is_duplicate, false) = false
  GROUP BY a.id
),
production_rollup AS (
  SELECT
    h.root_agent_id,
    COUNT(dp.id) FILTER (
      WHERE dp.production_date >= date_trunc('month', now())::date
    )::int AS current_production_rows,
    COALESCE(SUM(dp.aop) FILTER (
      WHERE dp.production_date >= date_trunc('month', now())::date
    ), 0)::numeric AS current_month_aop,
    COALESCE(SUM(dp.aop) FILTER (
      WHERE dp.production_date >= (date_trunc('month', now()) - interval '1 month')::date
        AND dp.production_date < date_trunc('month', now())::date
    ), 0)::numeric AS previous_month_aop,
    MAX(dp.production_date) AS last_production_date
  FROM hierarchy h
  LEFT JOIN public.daily_production dp ON dp.agent_id = h.agent_id
  GROUP BY h.root_agent_id
),
scored AS (
  SELECT
    a.id AS agent_id,
    COALESCE(p.full_name, a.display_name, p.email, 'Unknown') AS builder_name,
    p.email,
    p.phone,
    p.state,
    a.user_id,
    a.profile_id,
    a.manager_id,
    COALESCE(a.invited_by_manager_id, a.manager_id) AS upline_id,
    a.invited_by_manager_id,
    a.builder_track,
    a.agency_owner_qualified_at,
    a.ref_slug,
    a.license_status,
    a.status,
    a.onboarding_stage,
    a.created_at,
    a.updated_at,
    COALESCE(ar.direct_agent_count, 0) AS direct_agent_count,
    COALESCE(ar.total_downline_count, 0) AS total_downline_count,
    COALESCE(ar.active_agent_count, 0) AS active_agent_count,
    COALESCE(ar.licensed_agent_count, 0) AS licensed_agent_count,
    COALESCE(ar.unlicensed_agent_count, 0) AS unlicensed_agent_count,
    COALESCE(ar.hires_this_month, 0) AS hires_this_month,
    COALESCE(ap.applicant_count, 0) AS applicant_count,
    COALESCE(ap.licensed_recruits, 0) AS licensed_recruits,
    COALESCE(ap.unlicensed_recruits, 0) AS unlicensed_recruits,
    COALESCE(ap.coursework_completed_count, 0) AS coursework_completed_count,
    COALESCE(ap.activation_count, 0) AS activation_count,
    COALESCE(ap.stuck_applicants, 0) AS stuck_applicants,
    COALESCE(ap.applicants_this_month, 0) AS applicants_this_month,
    COALESCE(pr.applicants_from_referral_link, 0) AS applicants_from_referral_link,
    COALESCE(pr.licensed_from_referral_link, 0) AS licensed_from_referral_link,
    COALESCE(pr.activated_from_referral_link, 0) AS activated_from_referral_link,
    CASE
      WHEN pr.applicants_from_referral_link > 0
        THEN ROUND((pr.activated_from_referral_link::numeric / pr.applicants_from_referral_link::numeric) * 100, 1)
      ELSE NULL
    END AS referral_conversion_rate,
    CASE
      WHEN ap.applicant_count > 0
        THEN ROUND((ap.coursework_completed_count::numeric / ap.applicant_count::numeric) * 100, 1)
      ELSE NULL
    END AS coursework_completion_rate,
    CASE
      WHEN ap.applicant_count > 0
        THEN ROUND((ap.activation_count::numeric / ap.applicant_count::numeric) * 100, 1)
      ELSE NULL
    END AS activation_rate,
    CASE
      WHEN prod.current_production_rows > 0 THEN prod.current_month_aop
      ELSE NULL
    END AS monthly_production,
    prod.current_production_rows > 0 AS monthly_production_available,
    CASE
      WHEN prod.current_production_rows > 0 AND prod.previous_month_aop > 0
        THEN ROUND(((prod.current_month_aop - prod.previous_month_aop) / prod.previous_month_aop) * 100, 1)
      ELSE NULL
    END AS growth_rate,
    prod.last_production_date,
    NULLIF(GREATEST(
      COALESCE(a.updated_at, '1970-01-01'::timestamptz),
      COALESCE(ar.last_agent_activity_at, '1970-01-01'::timestamptz),
      COALESCE(ap.last_application_activity_at, '1970-01-01'::timestamptz),
      COALESCE(prod.last_production_date::timestamptz, '1970-01-01'::timestamptz)
    ), '1970-01-01'::timestamptz) AS last_activity_at,
    COALESCE(a.ref_slug, a.id::text) AS referral_code,
    'https://apex-financial.org/apply?ref=' || COALESCE(a.ref_slug, a.id::text) AS referral_link,
    'https://apex-financial.org/apply?ref=' || COALESCE(a.ref_slug, a.id::text) || '&utm_source=builder_referral&utm_medium=link&utm_campaign=recruiting' AS application_link,
    (
      COALESCE(ar.active_agent_count, 0) >= 10
      AND COALESCE(ar.total_downline_count, 0) >= 10
    ) AS qualifies_agency_owner
  FROM live_agents a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  LEFT JOIN agent_rollup ar ON ar.root_agent_id = a.id
  LEFT JOIN application_rollup ap ON ap.root_agent_id = a.id
  LEFT JOIN personal_referral_rollup pr ON pr.root_agent_id = a.id
  LEFT JOIN production_rollup prod ON prod.root_agent_id = a.id
)
SELECT
  s.*,
  CASE
    WHEN s.qualifies_agency_owner THEN 'Agency Owner'
    WHEN s.builder_track = 'agency_owner_track' THEN 'Agency Owner Track - Not Qualified Yet'
    WHEN s.builder_track = 'manager_track'
      OR s.direct_agent_count > 0
      OR s.total_downline_count > 0
      OR s.applicant_count > 0
      THEN 'Manager'
    ELSE 'Agent'
  END AS earned_title,
  CASE
    WHEN s.builder_track <> 'agent'
      OR s.direct_agent_count > 0
      OR s.total_downline_count > 0
      OR s.applicant_count > 0
      THEN true
    ELSE false
  END AS is_builder,
  CASE
    WHEN s.monthly_production IS NULL THEN NULL
    ELSE s.monthly_production >= 100000
  END AS above_100k_monthly,
  CASE
    WHEN s.stuck_applicants > 0 THEN 'Call stuck recruits'
    WHEN s.builder_track = 'agency_owner_track' AND NOT s.qualifies_agency_owner
      THEN 'Push to ' || GREATEST(10 - s.active_agent_count, 0)::text || ' more active agents'
    WHEN s.unlicensed_recruits > s.licensed_recruits THEN 'Push licensing'
    WHEN s.last_activity_at IS NULL OR s.last_activity_at < now() - interval '14 days' THEN 'Re-engage builder'
    WHEN s.hires_this_month = 0 AND s.active_agent_count > 0 THEN 'Ask for next hire'
    ELSE 'Support growth'
  END AS action_needed
FROM scored s;
