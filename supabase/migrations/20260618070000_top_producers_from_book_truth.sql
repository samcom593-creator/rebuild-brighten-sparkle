-- 2026-06-18 Sam directive (verbatim): "Gareto's numbers aren't showing.
-- Shootie's number is inaccurate. Make sure you're going through book of
-- business for that leaderboards, and you're making sure that those top
-- producers are the people with leaders or whoever it is. They mentioned
-- they all changed their life."
--
-- Root cause: v_top_producers_mtd sourced from the LOCAL public.deals table
-- which only contains rows synced into Apex. Many real producers
-- (Moody Imran, Obie Ifediora, Wendell Funderburg, Dalton Rowland, Xaviar
-- Watts, Cyril Onyia, Marcos Castellanos, Aisha Kebbeh, Daniel Gonzalez)
-- are at the top of AgentLink but were absent or under-counted on the
-- website leaderboard. The result: KJ Vaughn showed as #1 with $8,476 MTD
-- when Moody Imran is actually #1 with $45,011 MTD per book of business.
--
-- Truth lives in public.agentlink_deals_snapshot — the AgentLink mirror.
-- Switch the source so the leaderboard matches what Sam sees in AgentLink
-- for the month.
--
-- Filter: effective_date >= start-of-month in America/Chicago (matches
-- Sam's recruiting timezone + the apex_dashboard_summary truth source).
--
-- Note: 37 licensed active agents currently have al_user_id NULL — they
-- will NOT appear in this leaderboard until their AgentLink link is
-- backfilled. Sam will see them surfaced via v_agents_missing_al_link
-- (created in this migration) so he knows which records still need
-- the al_user_id wired up. Backfill is a separate ship.
--
-- rollback: restore the prior view from a backup (the previous definition
-- used canonical_agents CTE against public.deals filtered by posted_at).

DROP VIEW IF EXISTS public.v_top_producers_mtd CASCADE;

CREATE VIEW public.v_top_producers_mtd AS
WITH book AS (
  SELECT
    s.user_id,
    COUNT(*)::int AS deals_mtd,
    COALESCE(SUM(s.annual_premium), 0)::numeric AS alp_mtd
  FROM public.agentlink_deals_snapshot s
  WHERE s.effective_date >= date_trunc('month', (now() AT TIME ZONE 'America/Chicago'))
  GROUP BY s.user_id
),
agent_map AS (
  SELECT a.id, a.display_name, a.al_user_id, a.invited_by_manager_id
  FROM public.agents a
  WHERE a.canonical_agent_id IS NULL
    AND COALESCE(a.is_inactive, false) = false
    AND COALESCE(a.is_deactivated, false) = false
)
SELECT
  am.id AS agent_id,
  am.display_name,
  b.deals_mtd,
  b.alp_mtd,
  COALESCE(mgr.display_name, '(direct to Sam)') AS manager_name
FROM book b
JOIN agent_map am ON am.al_user_id = b.user_id
LEFT JOIN public.agents mgr ON mgr.id = am.invited_by_manager_id
WHERE b.deals_mtd > 0
ORDER BY b.alp_mtd DESC
LIMIT 20;

GRANT SELECT ON public.v_top_producers_mtd TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_top_producers_mtd IS
'2026-06-18 Sam: sourced from agentlink_deals_snapshot (book of business)
not the local deals table, so the website leaderboard matches AgentLink.
Agents without al_user_id are surfaced via v_agents_missing_al_link.';

-- Surface unlinked agents so Sam can backfill al_user_id.
CREATE OR REPLACE VIEW public.v_agents_missing_al_link AS
SELECT
  a.id::text AS agent_id,
  a.display_name,
  a.agent_code,
  a.license_status::text AS license_status,
  a.status::text AS status,
  a.created_at,
  -- Heuristic: does any agentlink user appear to have this name as their
  -- writing producer? (left as future work — for now just flag).
  NULL::int AS suggested_al_user_id
FROM public.agents a
WHERE a.canonical_agent_id IS NULL
  AND COALESCE(a.is_inactive, false) = false
  AND COALESCE(a.is_deactivated, false) = false
  AND a.license_status::text = 'licensed'
  AND a.al_user_id IS NULL
ORDER BY a.display_name;

GRANT SELECT ON public.v_agents_missing_al_link TO authenticated, service_role;

COMMENT ON VIEW public.v_agents_missing_al_link IS
'2026-06-18 Sam: 37 licensed active agents missing al_user_id linkage — they
will not appear in v_top_producers_mtd or any book-of-business view until
the al_user_id is backfilled.';
