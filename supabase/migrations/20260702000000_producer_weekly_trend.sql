-- 2026-07-01 producer weekly trend surface
--
-- Sam's use case: Daniel didn't know his production dropped 3 weeks.
-- We need a canonical weekly ALP series per producer + a drop alert view
-- that flags producers whose ALP dropped 3+ consecutive weeks.
--
-- Truth source is agentlink_deals_snapshot (same source as top-producers +
-- book-of-business, see 20260618070000). We roll up 12 weeks by effective_date
-- and expose per-producer trend + a 3-week drop flag.

-- ─── v_agent_weekly_production ───────────────────────────────────────────
-- 12 rolling weeks of ALP + deal count per canonical active agent.
CREATE OR REPLACE VIEW public.v_agent_weekly_production AS
SELECT
  a.id                                          AS agent_id,
  a.display_name,
  date_trunc('week', d.effective_date)::date    AS week_start,
  COUNT(*)::int                                 AS deals,
  COALESCE(SUM(d.annual_premium), 0)::int       AS alp
FROM public.agentlink_deals_snapshot d
JOIN public.agents a ON a.al_user_id = d.user_id
WHERE d.effective_date >= (now() - interval '12 weeks')
  AND a.status = 'active'
  AND COALESCE(a.is_deactivated, false) = false
  AND a.canonical_agent_id IS NULL
GROUP BY a.id, a.display_name, date_trunc('week', d.effective_date);

COMMENT ON VIEW public.v_agent_weekly_production IS
'2026-07-01 Sam trend surface: 12 rolling weeks of ALP + deal count per canonical
active agent (source: agentlink_deals_snapshot). Feeds v_producer_trend_alert +
/admin/producer-trends dashboard + AgentProfileDrawer trend chip.';

GRANT SELECT ON public.v_agent_weekly_production TO authenticated;

-- ─── v_producer_trend_alert ──────────────────────────────────────────────
-- Uses LAG() over the weekly series to compare current-week ALP against the
-- 3-prior-weeks ALP. currently_dropping = ALP dropped 3 consecutive weeks
-- (w0 < w-1 < w-2 < w-3 in ALP). direction = "down" | "up" | "flat".
CREATE OR REPLACE VIEW public.v_producer_trend_alert AS
WITH weekly AS (
  SELECT
    agent_id,
    display_name,
    week_start,
    alp,
    deals,
    LAG(alp, 1) OVER (PARTITION BY agent_id ORDER BY week_start) AS alp_1w_ago,
    LAG(alp, 2) OVER (PARTITION BY agent_id ORDER BY week_start) AS alp_2w_ago,
    LAG(alp, 3) OVER (PARTITION BY agent_id ORDER BY week_start) AS alp_3w_ago,
    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY week_start DESC) AS rn
  FROM public.v_agent_weekly_production
),
current_wk AS (
  -- Only look at the most recent week per producer for the alert flag.
  SELECT * FROM weekly WHERE rn = 1
)
SELECT
  c.agent_id                                       AS producer_id,
  c.display_name,
  c.week_start                                     AS current_week_start,
  c.alp                                            AS current_week_alp,
  c.deals                                          AS current_week_deals,
  c.alp_1w_ago,
  c.alp_2w_ago,
  c.alp_3w_ago                                     AS alp_3_weeks_ago,
  -- Percent delta current vs 3 weeks ago (protect divide-by-zero).
  CASE
    WHEN COALESCE(c.alp_3w_ago, 0) = 0 AND c.alp = 0 THEN 0
    WHEN COALESCE(c.alp_3w_ago, 0) = 0 THEN 100
    ELSE ROUND(((c.alp::numeric - c.alp_3w_ago::numeric) / c.alp_3w_ago::numeric) * 100, 1)
  END::numeric                                     AS delta_pct,
  CASE
    WHEN c.alp > COALESCE(c.alp_1w_ago, 0) THEN 'up'
    WHEN c.alp < COALESCE(c.alp_1w_ago, 0) THEN 'down'
    ELSE 'flat'
  END                                              AS direction,
  -- currently_dropping: 3 strict consecutive week-over-week drops.
  -- Requires all 3 lag values present so we don't false-alarm new hires.
  (
    c.alp_1w_ago IS NOT NULL AND c.alp_2w_ago IS NOT NULL AND c.alp_3w_ago IS NOT NULL
    AND c.alp        < c.alp_1w_ago
    AND c.alp_1w_ago < c.alp_2w_ago
    AND c.alp_2w_ago < c.alp_3w_ago
  )                                                AS currently_dropping
FROM current_wk c;

COMMENT ON VIEW public.v_producer_trend_alert IS
'2026-07-01 Sam trend surface: per-producer current-week ALP vs 3-weeks-ago
with currently_dropping flag (3 consecutive strict weekly drops). Feeds
/admin/producer-trends + AgentProfileDrawer trend chip. Solves the "Daniel
didn''t know his production dropped 3 weeks" problem.';

GRANT SELECT ON public.v_producer_trend_alert TO authenticated;
