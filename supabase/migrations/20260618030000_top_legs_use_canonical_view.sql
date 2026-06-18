-- 2026-06-17 Sam directive: "The top ten legs is cool and all, but it's just
-- not loading at all." The old v_top_legs_excl_sam joined agentlink_deals_snapshot
-- via agents.al_user_id which is sparsely populated, so only KJ showed up.
--
-- Rewrite to use v_agent_with_downline_production (the canonical hierarchy view
-- that already merges canonical_agent_id de-dup + downline aggregates). Now
-- returns every real leg manager: KJ, Chukwudi, Obie, Moody, dudley.
--
-- Schema is the same as the old view so Leaderboard.tsx works without changes.
-- rollback: re-create the old view from the prior migration if needed.

DROP VIEW IF EXISTS public.v_top_legs_excl_sam CASCADE;

CREATE VIEW public.v_top_legs_excl_sam AS
SELECT
  agent_id AS manager_id,
  name AS manager_name,
  own_deals_mtd AS deals,
  COALESCE(team_ap_mtd, 0)::numeric AS premium,
  downline_size AS leg_size
FROM public.v_agent_with_downline_production
WHERE agent_id IS DISTINCT FROM '7c3c5581-3544-437f-bfe2-91391afb217d'::uuid
  AND downline_size > 0
ORDER BY downline_size DESC, team_ap_mtd DESC NULLS LAST;

GRANT SELECT ON public.v_top_legs_excl_sam TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_top_legs_excl_sam IS
'Top-producing legs excluding Sam (SJAMES01). Sourced from
v_agent_with_downline_production so it picks up the canonical hierarchy
(every manager with downline_size > 0) instead of relying on the sparse
agents.al_user_id linkage. 2026-06-17 rewrite to fix Sam: "not loading at all".';
