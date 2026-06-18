-- 2026-06-18 Sam directive: "some peoples numbers not counting - Xaviar Watts"
--
-- Audit found 2 agents with status='active' but is_deactivated=true:
--   - Xaviar Watts (XWATTS01, al_user=709)
--   - Cooper Ubert (CUBERT01, al_user=775)
--
-- Every dashboard view that filters `is_deactivated IS NOT TRUE` (the canonical
-- pattern used by v_top_producers_mtd + v_agent_with_downline_production +
-- v_team_analytics_producers + every other canonical-agents CTE) was skipping
-- both. Sam saw their deals in the AgentLink paste but their names never
-- appeared in the leaderboard.
--
-- Fix: flip both to is_deactivated=false. The status='active' field is the
-- source of truth for liveness; is_deactivated is a soft-delete flag that
-- should only be true when status is terminated/inactive/declined.
--
-- Guardrail view v_agents_status_deac_mismatch surfaces ANY future regression
-- where status and is_deactivated drift apart (works in both directions —
-- active+deactivated OR terminated+notDeactivated).
--
-- rollback: UPDATE agents SET is_deactivated = true WHERE agent_code IN
--           ('XWATTS01', 'CUBERT01') AND status = 'active';

-- Already applied via bot-sql earlier in same session, but make this idempotent.
UPDATE public.agents
SET is_deactivated = false, updated_at = now()
WHERE status::text = 'active'
  AND is_deactivated = true;

CREATE OR REPLACE VIEW public.v_agents_status_deac_mismatch AS
SELECT
  a.id::text AS agent_id,
  a.display_name,
  a.agent_code,
  a.status::text AS status,
  a.is_deactivated,
  a.al_user_id,
  (a.canonical_agent_id IS NOT NULL) AS is_canonical_dup,
  CASE
    WHEN a.status::text = 'active' AND a.is_deactivated = true
      THEN 'active_but_deactivated'
    WHEN a.status::text IN ('terminated', 'inactive') AND a.is_deactivated = false
      THEN 'terminated_but_not_deactivated'
    ELSE 'unknown'
  END AS mismatch_kind
FROM public.agents a
WHERE
  (a.status::text = 'active' AND a.is_deactivated = true)
  OR (a.status::text IN ('terminated', 'inactive') AND a.is_deactivated = false)
ORDER BY a.display_name;

GRANT SELECT ON public.v_agents_status_deac_mismatch TO authenticated, service_role;

COMMENT ON VIEW public.v_agents_status_deac_mismatch IS
'Sam directive 2026-06-18: catches agents who silently drop off dashboards
because status (the truth) and is_deactivated (the filter most views use)
have drifted apart. Run periodic check + alert when mismatch_kind = active_but_deactivated.';
