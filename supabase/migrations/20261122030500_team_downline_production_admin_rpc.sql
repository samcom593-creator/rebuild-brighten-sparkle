-- MP-WIB-TEAM-HIERARCHY-RPC (2026-11-22)
-- The command-center "Team Hierarchy + Downline Production" card (TeamHierarchyWidget)
-- read v_agent_with_downline_production directly and 403'd for EVERY caller: the view
-- is security_invoker over `agents` + `v_team_hierarchy`, which the `authenticated`
-- role cannot SELECT. The card went dark ("0 recruiters / $0 team MTD").
--
-- The view has NO caller-uid filter and NO admin filter, so flipping it to a definer
-- view (to match its command-center siblings) would leak every manager's downline
-- production to every logged-in agent. The safe read is this admin-gated RPC:
-- SECURITY DEFINER so the owner can read the base objects, hard-gated by
-- apex_is_admin() so non-admins get a 42501 deny (not a fake empty / fake $0).
-- Proven in prod: service-role deny, non-admin deny, Sam-admin -> 106 rows.
-- Idempotent (CREATE OR REPLACE); live-applied via bot-sql and tracked here.

CREATE OR REPLACE FUNCTION public.get_team_downline_production()
RETURNS SETOF public.v_agent_with_downline_production
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.apex_is_admin() THEN
    RAISE EXCEPTION 'not authorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.v_agent_with_downline_production
  ORDER BY team_ap_mtd DESC NULLS LAST;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_team_downline_production() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_downline_production() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_downline_production() TO authenticated;

NOTIFY pgrst, 'reload schema';
