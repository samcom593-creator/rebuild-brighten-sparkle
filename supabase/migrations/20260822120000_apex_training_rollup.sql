-- NOTE 2026-08-23: the original draft guarded on 'super_admin'::app_role and
-- failed at RUNTIME with 22P02 on every call. There are TWO app_role enums in
-- this database — public.app_role (admin,manager,agent,va_manager,va) and
-- recruit.app_role (agent,manager,admin,super_admin). public.has_role takes the
-- PUBLIC one, which has no super_admin. Guard now uses va_manager.
-- APEX Training — leader rollup + "needs a nudge" list
--
-- WHY: the Training Hub has to answer "who actually finished?" for a leader.
-- Deriving that in the browser is wrong twice over:
--   1. PostgREST caps reads at 1000 rows, so a client-side count over
--      onboarding_progress silently under-reports the day the table outgrows it.
--   2. RLS scoping already differs per role (admin sees all, manager sees only
--      agents they invited), so an array length means something different
--      depending on who is looking at it.
-- Both functions therefore aggregate server-side and carry their own explicit
-- role gate: a plain agent gets ZERO ROWS back, not a roster and not a zero.
--
-- DENOMINATOR IS STATED, NOT IMPLIED. "enrolled" = agents holding at least one
-- onboarding_progress row against an ACTIVE module. 11 of the 15 rows in
-- onboarding_modules are is_active=false and point at a YouTube CHANNEL url
-- (https://www.youtube.com/@SamuelJamesHQ) rather than a video — they are unbuilt
-- scaffolding, RLS already hides them from agents, and grading against all 15
-- would invent a 73%-incomplete backlog that nobody can clear. Measured
-- 2026-08-22: 4 active modules, 85 enrolled, 47 complete, 27 in progress,
-- 11 with a row but 0 passes.
--
-- No GHOST_% filter here on purpose: those 10 sync-artifact agents carry 0
-- onboarding_progress rows (verified), so they cannot reach these aggregates.

CREATE OR REPLACE FUNCTION public.apex_training_rollup()
RETURNS TABLE (
  active_modules integer,
  enrolled integer,
  complete integer,
  in_progress integer,
  not_started integer,
  scope text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_is_admin   boolean;
  v_is_manager boolean;
  v_mgr        uuid;
  v_active     integer;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  v_is_admin   := has_role(v_uid, 'admin'::app_role)
               OR has_role(v_uid, 'va_manager'::app_role);
  v_is_manager := has_role(v_uid, 'manager'::app_role);

  -- Fail closed: no role, no rows. The caller renders nothing rather than a 0.
  IF NOT (v_is_admin OR v_is_manager) THEN RETURN; END IF;

  SELECT count(*) INTO v_active FROM onboarding_modules WHERE is_active;
  IF v_active = 0 THEN RETURN; END IF;

  v_mgr := current_agent_id();

  RETURN QUERY
  WITH act AS (
    SELECT id FROM onboarding_modules WHERE is_active
  ),
  scoped AS (
    SELECT a.id
    FROM agents a
    WHERE v_is_admin
       OR (v_is_manager AND a.invited_by_manager_id = v_mgr)
  ),
  per AS (
    SELECT p.agent_id,
           count(*) FILTER (WHERE p.passed)::int AS passed
    FROM onboarding_progress p
    JOIN act    ON act.id = p.module_id
    JOIN scoped s ON s.id = p.agent_id
    GROUP BY p.agent_id
  )
  SELECT v_active,
         count(*)::int,
         count(*) FILTER (WHERE per.passed >= v_active)::int,
         count(*) FILTER (WHERE per.passed > 0 AND per.passed < v_active)::int,
         count(*) FILTER (WHERE per.passed = 0)::int,
         CASE WHEN v_is_admin THEN 'agency' ELSE 'team' END
  FROM per;
END;
$$;

-- The actionable half: who to push, oldest-stalled first.
CREATE OR REPLACE FUNCTION public.apex_training_needs_nudge(_limit integer DEFAULT 5)
RETURNS TABLE (
  agent_id       uuid,
  display_name   text,
  modules_passed integer,
  active_modules integer,
  last_activity  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_is_admin   boolean;
  v_is_manager boolean;
  v_mgr        uuid;
  v_active     integer;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  v_is_admin   := has_role(v_uid, 'admin'::app_role)
               OR has_role(v_uid, 'va_manager'::app_role);
  v_is_manager := has_role(v_uid, 'manager'::app_role);

  IF NOT (v_is_admin OR v_is_manager) THEN RETURN; END IF;

  SELECT count(*) INTO v_active FROM onboarding_modules WHERE is_active;
  IF v_active = 0 THEN RETURN; END IF;

  v_mgr := current_agent_id();

  RETURN QUERY
  WITH act AS (
    SELECT id FROM onboarding_modules WHERE is_active
  ),
  scoped AS (
    SELECT a.id, a.display_name
    FROM agents a
    WHERE v_is_admin
       OR (v_is_manager AND a.invited_by_manager_id = v_mgr)
  ),
  per AS (
    SELECT p.agent_id,
           count(*) FILTER (WHERE p.passed)::int      AS passed,
           max(coalesce(p.completed_at, p.started_at)) AS last_at
    FROM onboarding_progress p
    JOIN act    ON act.id = p.module_id
    JOIN scoped s ON s.id = p.agent_id
    GROUP BY p.agent_id
  )
  SELECT per.agent_id,
         s.display_name,
         per.passed,
         v_active,
         per.last_at
  FROM per
  JOIN scoped s ON s.id = per.agent_id
  WHERE per.passed < v_active
  ORDER BY per.last_at ASC NULLS FIRST, per.passed ASC
  LIMIT greatest(1, least(coalesce(_limit, 5), 25));
END;
$$;

REVOKE ALL ON FUNCTION public.apex_training_rollup()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apex_training_needs_nudge(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_training_rollup()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.apex_training_needs_nudge(integer) TO authenticated;
