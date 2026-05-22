-- 2026-05-22: Manager hierarchy MTD + top producers MTD views.
-- Sam's complaint: "Dashboard literally empty. Leaderboard empty. Last 8 deals
-- panel still there — supposed to be replaced with manager hierarchy / pipeline stats."
-- These two views feed the new ManagerHierarchyMtdPanel + TopProducersMtdPanel
-- on /dashboard that replace the weak "Recent deals" row.

CREATE OR REPLACE VIEW public.v_manager_hierarchy_mtd AS
SELECT
  COALESCE(mgr.id, '00000000-0000-0000-0000-000000000000'::uuid) AS manager_id,
  COALESCE(mgr.display_name, '(direct to Sam)') AS manager_name,
  count(DISTINCT a.id) AS team_size,
  COALESCE(sum(d.annual_premium), 0)::numeric AS team_alp_mtd,
  count(d.id) AS team_deals_mtd,
  count(DISTINCT d.agent_id) AS producing_team_mtd
FROM public.agents a
LEFT JOIN public.agents mgr ON mgr.id = a.invited_by_manager_id
LEFT JOIN public.deals d
  ON d.agent_id = a.id
 AND d.posted_at > date_trunc('month', now())
 AND d.status::text NOT IN ('rejected','cancelled')
WHERE COALESCE(a.is_inactive, false) = false
  AND COALESCE(a.is_deactivated, false) = false
GROUP BY mgr.id, mgr.display_name
HAVING count(DISTINCT a.id) > 0
ORDER BY team_alp_mtd DESC;

CREATE OR REPLACE VIEW public.v_top_producers_mtd AS
SELECT
  a.id AS agent_id,
  a.display_name,
  count(d.id) AS deals_mtd,
  COALESCE(sum(d.annual_premium), 0)::numeric AS alp_mtd,
  COALESCE(mgr.display_name, '(direct to Sam)') AS manager_name
FROM public.agents a
LEFT JOIN public.agents mgr ON mgr.id = a.invited_by_manager_id
LEFT JOIN public.deals d
  ON d.agent_id = a.id
 AND d.posted_at > date_trunc('month', now())
 AND d.status::text NOT IN ('rejected','cancelled')
WHERE COALESCE(a.is_inactive, false) = false
  AND COALESCE(a.is_deactivated, false) = false
GROUP BY a.id, a.display_name, mgr.display_name
HAVING count(d.id) > 0
ORDER BY alp_mtd DESC
LIMIT 20;
