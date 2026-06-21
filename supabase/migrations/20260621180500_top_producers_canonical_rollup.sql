-- 2026-06-21 wave-94 doctor probe — restore canonical rollup on v_top_producers_mtd
--
-- 2026-06-18 migration 20260618070000_top_producers_from_book_truth.sql repointed
-- this view at agentlink_deals_snapshot (book of business — Sam's directive after
-- KJ showed as #1 with $8,476 MTD when Moody Imran was actually #1 with $45,011).
-- That migration filtered dups inline via canonical_agent_id IS NULL but stopped
-- referencing v_agent_canonical_map and stopped rolling dup deals up to canonical.
--
-- Side effects of the wave-94 break that I caught via apex-doctor 2026-06-21:
--   - 5 SJAMES02 deals + $5,420.64 ALP silently dropped from the leaderboard
--     this month (Sam's own dup absorbed deals never surface on canonical SJAMES01)
--   - apex-doctor "wave-94 production views" canonical-reference probe trips
--
-- Same fix preserves the book-of-business source AND rolls dup user_ids up to the
-- canonical agent via v_agent_canonical_map. Inactive/deactivated agents still
-- excluded. View definition once again references v_agent_canonical_map so the
-- doctor probe is silenced for the right reason (real canonical chain) not a
-- comment trick.

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
-- Resolve each book row to the agent that owns the AgentLink user_id (could be a dup)
-- then roll that agent up to its canonical identity via v_agent_canonical_map. Deals
-- attributed to SJAMES02 now correctly surface under SJAMES01.
agent_match AS (
  SELECT b.user_id, b.deals_mtd, b.alp_mtd, a.id AS raw_agent_id
  FROM book b
  JOIN public.agents a ON a.al_user_id = b.user_id
),
canon AS (
  SELECT
    m.canonical_agent_id AS agent_id,
    SUM(am.deals_mtd)::int AS deals_mtd,
    SUM(am.alp_mtd)::numeric AS alp_mtd
  FROM agent_match am
  JOIN public.v_agent_canonical_map m ON m.agent_id = am.raw_agent_id
  GROUP BY m.canonical_agent_id
)
SELECT
  c.agent_id,
  a.display_name,
  c.deals_mtd,
  c.alp_mtd,
  COALESCE(mgr.display_name, '(direct to Sam)') AS manager_name
FROM canon c
JOIN public.agents a ON a.id = c.agent_id
LEFT JOIN public.agents mgr ON mgr.id = a.invited_by_manager_id
WHERE COALESCE(a.is_inactive, false) = false
  AND COALESCE(a.is_deactivated, false) = false
  AND c.deals_mtd > 0
ORDER BY c.alp_mtd DESC
LIMIT 20;

GRANT SELECT ON public.v_top_producers_mtd TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_top_producers_mtd IS
'2026-06-21 wave-94 restore — sourced from agentlink_deals_snapshot (book of
business per 2026-06-18 Sam directive) AND rolls dup al_user_id deals up to
canonical agent via v_agent_canonical_map so SJAMES02 deals surface under
SJAMES01. Inactive/deactivated agents excluded. Agents without al_user_id are
surfaced via v_agents_missing_al_link.';
