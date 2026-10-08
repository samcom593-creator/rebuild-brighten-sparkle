-- PL-WIB-PROD-STATS-SCOPE (2026-10-08)
--
-- Signup is open and handle_new_user makes every new account role 'agent', so
-- "signed in" is not "works here". Measured before this migration, in a rolled-back
-- transaction as a self-signed-up account with no agents row:
--   get_agent_production_stats('2026-01-01','2026-12-31') -> 67 producers, $2,095,184 YTD ALP
--   apex_dashboard_summary()->'this_month'                 -> 27 deals / $50,382.20
--   leaderboard_board(same year)                           -> 0 rows
-- The leaderboard scopes every row through crm_can_read_agent_scope(); these two
-- SECURITY DEFINER functions returned the whole IMO to anyone. YearPerformanceCard
-- filtered to "own row" in the browser, which is not a boundary.
--
-- 1. get_agent_production_stats keeps its signature and output, and returns only rows
--    the caller may read: the same crm_can_read_agent_scope() the leaderboard uses
--    (admin / va / va_manager see all; anyone else sees self + recursive downline,
--    a superset of YearPerformanceCard's manager team filter, so no on-screen number
--    changes). A caller with no user id that is not the anon/authenticated key
--    (service_role edge functions, pg_cron, bot-sql: generate-award-graphics,
--    autoposter_leak_watchdog) still sees every row.
--
-- 2. apex_dashboard_summary is read only by AgencyCommandView, which renders only for
--    admins (AgentCommandDashboard.tsx). It now refuses non-admins with 42501 instead
--    of answering. fn_require_caller_role(array['admin']) == apex_is_admin() because
--    app_role has no super_admin/owner label. bot-sql callers (meeting-numbers-refresh.sh)
--    have no user id and pass.
--
-- Grants are unchanged (CREATE OR REPLACE keeps them). apex-doctor Check #96 holds both:
-- apex_dashboard_summary under staff_gated, get_agent_production_stats under scope_gated.

CREATE OR REPLACE FUNCTION public.get_agent_production_stats(start_date date, end_date date)
 RETURNS TABLE(agent_id uuid, total_alp numeric, total_deals integer, total_presentations integer, last_activity_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH deals_agg AS (
    SELECT
      d.agent_id,
      COALESCE(SUM(d.annual_premium), 0) AS deals_alp,
      COUNT(*)::int AS deals_count,
      MAX((d.posted_at AT TIME ZONE 'America/Chicago')::date) AS last_deal_date
    FROM public.deals d
    WHERE d.status IN ('submitted', 'active')
      AND d.posted_at IS NOT NULL
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN start_date AND end_date
      AND d.agent_id IS NOT NULL
      AND d.agent_id NOT IN (SELECT * FROM public.sam_agent_ids_to_exclude())
    GROUP BY d.agent_id
  ),
  pres_agg AS (
    SELECT
      dp.agent_id,
      COALESCE(SUM(dp.presentations), 0)::int AS pres_count,
      MAX(dp.production_date) AS last_pres_date
    FROM public.daily_production dp
    WHERE dp.production_date BETWEEN start_date AND end_date
      AND dp.agent_id IS NOT NULL
    GROUP BY dp.agent_id
  ),
  all_agents AS (
    SELECT agent_id FROM deals_agg
    UNION
    SELECT agent_id FROM pres_agg
  ),
  -- Evaluated once, not per row: service_role / pg_cron / bot-sql have no user id.
  -- The anon and authenticated keys have no user id either when unsigned, so they
  -- are refused by name (same rule as fn_require_caller_role).
  caller AS (
    SELECT (auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')) AS is_service
  )
  SELECT
    a.agent_id,
    COALESCE(d.deals_alp, 0)::numeric AS total_alp,
    COALESCE(d.deals_count, 0) AS total_deals,
    COALESCE(p.pres_count, 0) AS total_presentations,
    GREATEST(d.last_deal_date, p.last_pres_date) AS last_activity_date
  FROM all_agents a
  CROSS JOIN caller c
  LEFT JOIN deals_agg d ON d.agent_id = a.agent_id
  LEFT JOIN pres_agg p ON p.agent_id = a.agent_id
  WHERE c.is_service OR public.crm_can_read_agent_scope(a.agent_id);
$function$;

CREATE OR REPLACE FUNCTION public.apex_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_require_caller_role(array['admin']::public.app_role[]);
  RETURN (
    SELECT jsonb_build_object(
      'today',       (SELECT jsonb_build_object('deals', deals_today,      'premium', premium_today)      FROM v_agentlink_book_truth),
      'this_week',   (SELECT jsonb_build_object('deals', deals_this_week,  'premium', premium_this_week)  FROM v_agentlink_book_truth),
      'this_month',  (SELECT jsonb_build_object('deals', deals_this_month, 'premium', premium_this_month) FROM v_agentlink_book_truth),
      'total',       (SELECT jsonb_build_object('deals', total_deals,      'premium', total_annual_premium) FROM v_agentlink_book_truth),
      'last_sync_at',(SELECT last_synced_at FROM v_agentlink_book_truth),
      'new_apps_today',  (SELECT COUNT(*) FROM public.v_applications_real applications WHERE created_at >= CURRENT_DATE),
      'new_agents_today',(SELECT COUNT(*) FROM agents WHERE created_at >= CURRENT_DATE),
      'just_hired_7d',   (SELECT COUNT(*) FROM agents WHERE created_at >= NOW() - INTERVAL '7 days'),
      'stale_apps_14d',  (SELECT COUNT(*) FROM v_old_licensed_applicants),
      'inbound_open',    (SELECT COUNT(*) FROM inbound_leads WHERE stage NOT IN ('won','lost'))
    )
  );
END;
$function$;
