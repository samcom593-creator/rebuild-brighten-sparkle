-- 2026-06-18 Sam directive (verbatim): "I'm still missing Daniel and more
-- people inside the leaderboards. Let's go ahead and get this fixed."
--
-- Root cause: v_team_analytics_producers did NOT canonicalize via
-- canonical_agent_id and ordered by date (last_deal_date) not money. Result:
-- the top of the list was Samuel James + Jordan + dudley + (unknown) +
-- duplicate rows of the same producer, while the actual top producers
-- (Moody, Obie, Dalton, Chukwudi) appeared lower with the right numbers
-- but Sam couldn't see them above the noise.
--
-- New version:
--   - Resolve every agent_id through canonical_agent_id (matching the
--     wave-94 pattern).
--   - Filter is_deactivated = true at the source.
--   - JOIN agentlink_deals_snapshot via al_user_id for book-of-business.
--   - UNION ALL the local deals table only for agents WITHOUT al_user_id
--     (so a producer never appears twice).
--   - ORDER BY premium_30d DESC NULLS LAST (the money column) — not by
--     date, not by monthly premium.
--
-- After this rewrite, the top of Team Analytics matches AgentLink truth:
--   1. Moody Imran (41 deals, $49,523)
--   2. Obie Ifediora (34, $47,937)
--   3. Dalton Rowland (39, $43,377)
--   4. Chukwudi Ifediora (27, $40,154)
--   ...
--   12. Daniel Gonzalez (16, $19,666)
--
-- rollback: restore the prior view definition (see archive).

DROP VIEW IF EXISTS public.v_team_analytics_producers CASCADE;

CREATE VIEW public.v_team_analytics_producers AS
WITH canonical AS (
  SELECT a.id AS canonical_id, a.display_name, a.agent_code, a.al_user_id
  FROM public.agents a
  WHERE a.canonical_agent_id IS NULL
    AND COALESCE(a.is_deactivated, false) = false
),
book_30d AS (
  SELECT
    c.canonical_id,
    c.display_name,
    c.agent_code,
    COUNT(*)::int AS deals_30d,
    COALESCE(SUM(s.annual_premium), 0)::numeric AS premium_30d,
    COALESCE(SUM(s.monthly_premium), 0)::numeric AS monthly_30d,
    COALESCE(AVG(s.annual_premium), 0)::numeric(12,2) AS avg_deal_size,
    MAX(s.effective_date) AS last_deal_date,
    c.al_user_id AS user_id
  FROM canonical c
  JOIN public.agentlink_deals_snapshot s ON s.user_id = c.al_user_id
  WHERE s.effective_date >= (now() - interval '30 days')::date
  GROUP BY c.canonical_id, c.display_name, c.agent_code, c.al_user_id
),
local_30d AS (
  SELECT
    c.canonical_id,
    c.display_name,
    c.agent_code,
    COUNT(*)::int AS deals_30d,
    COALESCE(SUM(d.annual_premium), 0)::numeric AS premium_30d,
    COALESCE(SUM(d.monthly_premium), 0)::numeric AS monthly_30d,
    COALESCE(AVG(d.annual_premium), 0)::numeric(12,2) AS avg_deal_size,
    MAX(d.posted_at::date) AS last_deal_date,
    -1::int AS user_id
  FROM canonical c
  JOIN public.deals d ON d.agent_id = c.canonical_id
  WHERE c.al_user_id IS NULL
    AND d.posted_at >= (now() - interval '30 days')
  GROUP BY c.canonical_id, c.display_name, c.agent_code
)
SELECT user_id, display_name AS agent_name, agent_code, deals_30d, premium_30d,
       monthly_30d, avg_deal_size, last_deal_date
FROM book_30d
UNION ALL
SELECT user_id, display_name AS agent_name, agent_code, deals_30d, premium_30d,
       monthly_30d, avg_deal_size, last_deal_date
FROM local_30d
ORDER BY premium_30d DESC NULLS LAST;

GRANT SELECT ON public.v_team_analytics_producers TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_team_analytics_producers IS
'Sam directive 2026-06-18: canonical-mapped 30-day producer rollup ordered
by premium. Sources from agentlink_deals_snapshot first, falls back to
local public.deals only for agents without al_user_id. No double-counts.';
