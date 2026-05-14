-- 2026-05-14 — Move remaining leaderboards/rewards to deals.posted_at
--
-- Codex C4: get_daily_leaderboard still SUMs daily_production.aop (self-
-- reported, not AgentLink truth); get_weekly_leaderboard + agentlink_
-- award_top_producers still filter on deals.effective_date instead of
-- posted_at. Net result: dashboard numbers diverge from AgentLink and
-- rewards fire on the wrong day.
--
-- This migration redefines all three to use deals.posted_at (canonical
-- CT-day) with valid statuses only ('submitted','active').
--
-- Idempotent. Safe to re-run.

BEGIN;

-- 1. Daily leaderboard — use deals.posted_at against the requested CT date.
CREATE OR REPLACE FUNCTION public.get_daily_leaderboard(p_date date)
RETURNS TABLE(full_name text, instagram_handle text, aop numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.full_name,
    p.instagram_handle,
    COALESCE(SUM(d.annual_premium), 0)::numeric AS aop
  FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id
  LEFT JOIN public.deals d
    ON d.agent_id = a.id
   AND d.status IN ('submitted', 'active')
   AND (d.posted_at AT TIME ZONE 'America/Chicago')::date = p_date
  WHERE COALESCE(a.is_deactivated, false) = false
    AND COALESCE(a.is_inactive, false)    = false
  GROUP BY p.full_name, p.instagram_handle
  HAVING COALESCE(SUM(d.annual_premium), 0) > 0
  ORDER BY aop DESC
  LIMIT 10;
$$;

COMMENT ON FUNCTION public.get_daily_leaderboard(date) IS
'Truth-layer leaderboard via deals.posted_at CT day (was daily_production.aop). Updated 2026-05-14.';

-- 2. Weekly leaderboard — same shift, week window in CT.
CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(p_start date, p_end date)
RETURNS TABLE(full_name text, instagram_handle text, weekly_aop numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.full_name,
    p.instagram_handle,
    COALESCE(SUM(d.annual_premium), 0)::numeric AS weekly_aop
  FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id
  LEFT JOIN public.deals d
    ON d.agent_id = a.id
   AND d.status IN ('submitted', 'active')
   AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN p_start AND p_end
  WHERE COALESCE(a.is_deactivated, false) = false
    AND COALESCE(a.is_inactive, false)    = false
  GROUP BY p.full_name, p.instagram_handle
  HAVING COALESCE(SUM(d.annual_premium), 0) > 0
  ORDER BY weekly_aop DESC
  LIMIT 10;
$$;

COMMENT ON FUNCTION public.get_weekly_leaderboard(date, date) IS
'Truth-layer leaderboard via deals.posted_at CT range (was deals.effective_date). Updated 2026-05-14.';

-- 3. agentlink_award_top_producers — daily/weekly/monthly snapshots all
--    move from effective_date to posted_at CT.
CREATE OR REPLACE FUNCTION public.agentlink_award_top_producers()
RETURNS TABLE(period_out text, awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_today date := (NOW() AT TIME ZONE 'America/Chicago')::date;
  v_week_start date := date_trunc('week', NOW() AT TIME ZONE 'America/Chicago')::date;
  v_month_start date := date_trunc('month', NOW() AT TIME ZONE 'America/Chicago')::date;
  v_daily int := 0; v_weekly int := 0; v_monthly int := 0;
BEGIN
  WITH daily AS (
    SELECT a.id AS agent_id,
      COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric, 2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric, 2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    WHERE d.status IN ('submitted','active')
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date = v_today
    GROUP BY a.id
    HAVING COUNT(*) > 0
  )
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'daily', rnk::int, agent_id, dc, ap, mp_ FROM daily WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id = EXCLUDED.agent_id, deals = EXCLUDED.deals, alp = EXCLUDED.alp, mp = EXCLUDED.mp;

  WITH top3 AS (
    SELECT s.agent_id, s.rank, s.deals, s.alp FROM public.leaderboard_snapshots s
    WHERE s.snapshot_date = v_today AND s.period = 'daily' AND s.rank <= 3
  )
  INSERT INTO public.agentlink_rewards (agent_id, period, period_key, rank, title, description, alp, deals)
  SELECT agent_id, 'daily', to_char(v_today,'YYYY-MM-DD'), rank,
    CASE rank WHEN 1 THEN 'Daily #1' WHEN 2 THEN 'Daily #2' ELSE 'Daily #3' END,
    format('%s deals · $%s ALP on %s', deals, alp::text, to_char(v_today,'Mon DD')),
    alp, deals
  FROM top3
  ON CONFLICT (agent_id, period, period_key, rank) DO NOTHING;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  -- weekly
  WITH weekly AS (
    SELECT a.id AS agent_id,
      COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric, 2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric, 2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    WHERE d.status IN ('submitted','active')
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_week_start AND v_today
    GROUP BY a.id
    HAVING COUNT(*) > 0
  )
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'weekly', rnk::int, agent_id, dc, ap, mp_ FROM weekly WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id = EXCLUDED.agent_id, deals = EXCLUDED.deals, alp = EXCLUDED.alp, mp = EXCLUDED.mp;
  GET DIAGNOSTICS v_weekly = ROW_COUNT;

  -- monthly
  WITH monthly AS (
    SELECT a.id AS agent_id,
      COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric, 2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric, 2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    WHERE d.status IN ('submitted','active')
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_month_start AND v_today
    GROUP BY a.id
    HAVING COUNT(*) > 0
  )
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'monthly', rnk::int, agent_id, dc, ap, mp_ FROM monthly WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id = EXCLUDED.agent_id, deals = EXCLUDED.deals, alp = EXCLUDED.alp, mp = EXCLUDED.mp;
  GET DIAGNOSTICS v_monthly = ROW_COUNT;

  RETURN QUERY VALUES
    ('daily',   v_daily),
    ('weekly',  v_weekly),
    ('monthly', v_monthly);
END;
$fn$;

COMMENT ON FUNCTION public.agentlink_award_top_producers() IS
'Daily/weekly/monthly producer awards via deals.posted_at CT (was effective_date). Updated 2026-05-14.';

COMMIT;
