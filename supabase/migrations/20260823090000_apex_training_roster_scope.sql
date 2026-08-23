-- APEX Training — scope the leader rollup + nudge list to the CANONICAL roster
--
-- THE DEFECT (measured 2026-08-23, live, as Sam through PostgREST):
-- apex_training_needs_nudge sorts "coldest first" — last activity ascending.
-- People who have LEFT the agency are by definition the coldest, so they
-- floated to the top of the one list a leader opens to decide who to chase.
-- Of the 10 names in the panel's DEFAULT view, 7 were terminated or inactive;
-- 16 of the 25 at the widest setting. Three more rows were XAGENT test
-- accounts. The panel rendered confidently and pointed Sam at former agents.
--
-- The original file's header reasoned about GHOST_% sync artifacts and
-- concluded no filter was needed because they hold zero onboarding_progress
-- rows. True for GHOST_%. It was never extended to terminated/inactive agents
-- or XAGENT seeds, which DO hold progress rows and therefore DO reach these
-- aggregates.
--
-- THE OPERAND, not a new definition: public.v_apex_roster is the canonical
-- roster this platform already agrees on (it enforces roster_exclusions via
-- the canonical-map, drops GHOST_%/XAGENT%/MP%_HIRED and blank-named rows,
-- and keeps status='active' OR produced-in-120d). Inventing a second rule
-- here — "status <> 'terminated'" or a hand-rolled exclusion join — is how
-- two surfaces end up disagreeing about who counts. Membership is tested with
-- EXISTS against that view so the manager branch's invited_by_manager_id
-- scoping and the role gate are preserved byte-for-byte.
--
-- WHAT THIS CHANGES, measured before applying:
--   stalled population   37 -> 14   (dropped 23: 19 terminated/inactive,
--                                    3 XAGENT test rows, 1 row whose
--                                    display_name and agent_code are both
--                                    NULL — unchaseable, and excluded from
--                                    every other APEX surface for that reason)
--   ZERO named, active, rostered agents are lost.
--   rollup  enrolled 84 -> 27, complete 47 -> 13, in_progress 26 -> 9,
--           not_started 11 -> 5, active_modules 4 (unchanged)
-- The tiles and the list are now computed over the SAME population. Before
-- this, a leader could read "84 started" above a list drawn from a different
-- set — the source-parity failure that has bitten this repo before.
--
-- NOT CHANGED: the role gate (admin OR va_manager OR manager), the fail-closed
-- RETURN on no role, the agency/team scope label, and the 1..25 limit clamp.
-- Alyjah Rowland stays absent — he holds zero onboarding_progress rows, so he
-- was never in the population; from now on the roster gate enforces it rather
-- than leaving it to an accident of missing data.

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
    WHERE EXISTS (SELECT 1 FROM v_apex_roster r WHERE r.id = a.id)
      AND (v_is_admin
        OR (v_is_manager AND a.invited_by_manager_id = v_mgr))
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
    WHERE EXISTS (SELECT 1 FROM v_apex_roster r WHERE r.id = a.id)
      AND (v_is_admin
        OR (v_is_manager AND a.invited_by_manager_id = v_mgr))
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
