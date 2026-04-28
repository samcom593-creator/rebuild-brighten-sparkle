-- ──────────────────────────────────────────────────────────────────────
-- Truth-layer RPCs migrated off daily_production → deals (2026-04-28)
--
-- Root-cause fix for $76k weekly + Dudley $17k discrepancies. Both
-- traced to RPCs reading from daily_production.aop, which holds the old
-- AL phantom-Sam pollution AND drifts vs deals truth (+$345k on 30d
-- windows).
--
-- After this migration, every agent/manager/owner widget that calls
-- these two RPCs reads canonical deals (status submitted/active by
-- effective_date), with Sam (agent_id 7c3c5581) excluded as a defense
-- in depth (DB triggers already enforce this on inserts).
--
-- Reversible: the original definitions are kept in `*_legacy_v1`
-- functions (commented out below) so a rollback is a one-liner.
-- ──────────────────────────────────────────────────────────────────────

-- 1. get_weekly_leaderboard — was: SUM(daily_production.aop)
-- Column name `weekly_aop` is preserved (callers depend on it) but the
-- VALUE is now sourced from deals truth. Future commit will rename the
-- column once all callers (discord-leaderboards, etc) are updated.
CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(p_start date, p_end date)
RETURNS TABLE(full_name text, instagram_handle text, weekly_aop numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.full_name,
    p.instagram_handle,
    COALESCE(SUM(d.annual_premium), 0)::numeric AS weekly_aop
  FROM agents a
  JOIN profiles p ON p.id = a.profile_id
  LEFT JOIN deals d
    ON d.agent_id = a.id
   AND d.status IN ('submitted', 'active')
   AND d.effective_date BETWEEN p_start AND p_end
  WHERE COALESCE(a.is_deactivated, false) = false
    AND COALESCE(a.is_inactive, false)    = false
    AND a.id <> '7c3c5581-3544-437f-bfe2-91391afb217d'  -- Sam zero-deals rule
  GROUP BY p.full_name, p.instagram_handle
  HAVING COALESCE(SUM(d.annual_premium), 0) > 0
  ORDER BY weekly_aop DESC
  LIMIT 10;
$function$;

COMMENT ON FUNCTION public.get_weekly_leaderboard(date, date) IS
'Truth-layer (deals submitted/active by effective_date) since 2026-04-28. Column weekly_aop holds ALP value (legacy column name, will be renamed later).';

-- 2. get_agent_production_stats — was: SUM(daily_production.aop / deals_closed / presentations)
-- Now: deals truth for ALP/deal counts; daily_production retained ONLY for presentations
-- (its only authoritative field; agents self-report presentations there).
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
      MAX(d.effective_date) AS last_deal_date
    FROM deals d
    WHERE d.status IN ('submitted', 'active')
      AND d.effective_date BETWEEN start_date AND end_date
      AND d.agent_id IS NOT NULL
      AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
    GROUP BY d.agent_id
  ),
  pres_agg AS (
    SELECT
      dp.agent_id,
      COALESCE(SUM(dp.presentations), 0)::int AS pres_count,
      MAX(dp.production_date) AS last_pres_date
    FROM daily_production dp
    WHERE dp.production_date BETWEEN start_date AND end_date
      AND dp.agent_id IS NOT NULL
    GROUP BY dp.agent_id
  ),
  all_agents AS (
    SELECT agent_id FROM deals_agg
    UNION
    SELECT agent_id FROM pres_agg
  )
  SELECT
    a.agent_id,
    COALESCE(d.deals_alp, 0)::numeric AS total_alp,
    COALESCE(d.deals_count, 0) AS total_deals,
    COALESCE(p.pres_count, 0) AS total_presentations,
    GREATEST(d.last_deal_date, p.last_pres_date) AS last_activity_date
  FROM all_agents a
  LEFT JOIN deals_agg d ON d.agent_id = a.agent_id
  LEFT JOIN pres_agg  p ON p.agent_id = a.agent_id;
$function$;

COMMENT ON FUNCTION public.get_agent_production_stats(date, date) IS
'Truth-layer (deals for ALP/count, daily_production for presentations only) since 2026-04-28.';

-- ──────────────────────────────────────────────────────────────────────
-- ROLLBACK INSTRUCTIONS (do not execute unless reverting):
--
-- CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(p_start date, p_end date)
-- RETURNS TABLE(full_name text, instagram_handle text, weekly_aop numeric)
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $$
--   SELECT p.full_name, p.instagram_handle, COALESCE(SUM(dp.aop), 0)::numeric AS weekly_aop
--   FROM agents a JOIN profiles p ON p.id = a.profile_id
--   LEFT JOIN daily_production dp ON dp.agent_id = a.id AND dp.production_date BETWEEN p_start AND p_end
--   WHERE COALESCE(a.is_deactivated, false) = false AND COALESCE(a.is_inactive, false) = false
--   GROUP BY p.full_name, p.instagram_handle
--   HAVING COALESCE(SUM(dp.aop), 0) > 0
--   ORDER BY weekly_aop DESC LIMIT 10;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.get_agent_production_stats(start_date date, end_date date)
-- RETURNS TABLE(agent_id uuid, total_alp numeric, total_deals integer, total_presentations integer, last_activity_date date)
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $$
--   SELECT dp.agent_id, COALESCE(SUM(dp.aop), 0), COALESCE(SUM(dp.deals_closed), 0)::int,
--          COALESCE(SUM(dp.presentations), 0)::int, MAX(dp.production_date)
--   FROM daily_production dp
--   WHERE dp.production_date BETWEEN start_date AND end_date
--   GROUP BY dp.agent_id;
-- $$;
-- ──────────────────────────────────────────────────────────────────────
