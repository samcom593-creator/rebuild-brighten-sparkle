-- ════════════════════════════════════════════════════════════════════════
-- Agent Link top producers + auto-rewards
-- Nightly cron snapshots daily/weekly/monthly leaderboards from the deals
-- table (source='agent_link') and auto-issues ranked rewards with
-- notifications for the top performers.
-- ════════════════════════════════════════════════════════════════════════

-- Historical leaderboard snapshots
CREATE TABLE IF NOT EXISTS public.leaderboard_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  period        text NOT NULL,     -- daily | weekly | monthly
  rank          int NOT NULL,
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  deals         int NOT NULL,
  alp           numeric NOT NULL,
  mp            numeric NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (snapshot_date, period, rank)
);
CREATE INDEX IF NOT EXISTS idx_lbs_date_period ON public.leaderboard_snapshots(snapshot_date DESC, period);
CREATE INDEX IF NOT EXISTS idx_lbs_agent      ON public.leaderboard_snapshots(agent_id);
ALTER TABLE public.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lbs_read ON public.leaderboard_snapshots;
DROP POLICY IF EXISTS lbs_svc  ON public.leaderboard_snapshots;
CREATE POLICY lbs_read ON public.leaderboard_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY lbs_svc  ON public.leaderboard_snapshots FOR ALL    TO service_role  USING (true);

-- Rewards (idempotent — UNIQUE prevents duplicate awards per rank/period)
CREATE TABLE IF NOT EXISTS public.agentlink_rewards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  period        text NOT NULL,
  period_key    text NOT NULL,    -- YYYY-MM-DD / IYYY-W## / YYYY-MM
  rank          int NOT NULL,
  title         text NOT NULL,
  description   text,
  alp           numeric,
  deals         int,
  awarded_at    timestamptz DEFAULT now(),
  UNIQUE (agent_id, period, period_key, rank)
);
CREATE INDEX IF NOT EXISTS idx_arw_agent ON public.agentlink_rewards(agent_id, awarded_at DESC);
ALTER TABLE public.agentlink_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arw_own  ON public.agentlink_rewards;
DROP POLICY IF EXISTS arw_read ON public.agentlink_rewards;
DROP POLICY IF EXISTS arw_svc  ON public.agentlink_rewards;
CREATE POLICY arw_own  ON public.agentlink_rewards FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE profile_id = auth.uid()));
CREATE POLICY arw_read ON public.agentlink_rewards FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY arw_svc  ON public.agentlink_rewards FOR ALL    TO service_role  USING (true);

-- The tracker/rewarder function (runs nightly at 03:05 UTC)
CREATE OR REPLACE FUNCTION public.agentlink_award_top_producers()
RETURNS TABLE(period_out text, awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_today date := CURRENT_DATE;
  v_week_start date := date_trunc('week', CURRENT_DATE)::date;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_daily int := 0; v_weekly int := 0; v_monthly int := 0;
BEGIN
  -- daily snapshot + top 3 awards
  WITH daily AS (
    SELECT a.id AS agent_id, COUNT(*)::int AS dc, ROUND(SUM(d.annual_premium)::numeric,2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric,2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d JOIN public.agents a ON a.id = d.agent_id
    WHERE d.source='agent_link' AND d.effective_date::date = v_today
    GROUP BY a.id HAVING COUNT(*) > 0)
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'daily', rnk::int, agent_id, dc, ap, mp_ FROM daily WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id=EXCLUDED.agent_id, deals=EXCLUDED.deals, alp=EXCLUDED.alp, mp=EXCLUDED.mp;

  WITH top3 AS (SELECT s.agent_id, s.rank, s.deals, s.alp FROM public.leaderboard_snapshots s
    WHERE s.snapshot_date = v_today AND s.period = 'daily' AND s.rank <= 3)
  INSERT INTO public.agentlink_rewards (agent_id, period, period_key, rank, title, description, alp, deals)
  SELECT agent_id, 'daily', to_char(v_today,'YYYY-MM-DD'), rank,
    CASE rank WHEN 1 THEN 'Daily #1' WHEN 2 THEN 'Daily #2' ELSE 'Daily #3' END,
    format('%s deals · $%s ALP on %s', deals, alp::text, to_char(v_today,'Mon DD')), alp, deals FROM top3
  ON CONFLICT (agent_id, period, period_key, rank) DO NOTHING;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  -- weekly snapshot + top 5 awards
  WITH weekly AS (SELECT a.id AS agent_id, COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric,2) AS ap, ROUND(SUM(d.monthly_premium)::numeric,2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d JOIN public.agents a ON a.id = d.agent_id
    WHERE d.source='agent_link' AND d.effective_date::date >= v_week_start
    GROUP BY a.id HAVING COUNT(*) > 0)
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'weekly', rnk::int, agent_id, dc, ap, mp_ FROM weekly WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id=EXCLUDED.agent_id, deals=EXCLUDED.deals, alp=EXCLUDED.alp, mp=EXCLUDED.mp;

  WITH top5 AS (SELECT s.agent_id, s.rank, s.deals, s.alp FROM public.leaderboard_snapshots s
    WHERE s.snapshot_date = v_today AND s.period = 'weekly' AND s.rank <= 5)
  INSERT INTO public.agentlink_rewards (agent_id, period, period_key, rank, title, description, alp, deals)
  SELECT agent_id, 'weekly', to_char(v_week_start, 'IYYY-"W"IW'), rank,
    CASE rank WHEN 1 THEN 'Weekly #1' WHEN 2 THEN 'Weekly #2' WHEN 3 THEN 'Weekly #3' ELSE 'Weekly Top 5' END,
    format('%s deals · $%s ALP week of %s', deals, alp::text, to_char(v_week_start,'Mon DD')),
    alp, deals FROM top5
  ON CONFLICT (agent_id, period, period_key, rank) DO NOTHING;
  GET DIAGNOSTICS v_weekly = ROW_COUNT;

  -- monthly snapshot + top 10 awards
  WITH monthly AS (SELECT a.id AS agent_id, COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric,2) AS ap, ROUND(SUM(d.monthly_premium)::numeric,2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d JOIN public.agents a ON a.id = d.agent_id
    WHERE d.source='agent_link' AND d.effective_date::date >= v_month_start
    GROUP BY a.id HAVING COUNT(*) > 0)
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'monthly', rnk::int, agent_id, dc, ap, mp_ FROM monthly WHERE rnk <= 20
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id=EXCLUDED.agent_id, deals=EXCLUDED.deals, alp=EXCLUDED.alp, mp=EXCLUDED.mp;

  WITH top10 AS (SELECT s.agent_id, s.rank, s.deals, s.alp FROM public.leaderboard_snapshots s
    WHERE s.snapshot_date = v_today AND s.period = 'monthly' AND s.rank <= 10)
  INSERT INTO public.agentlink_rewards (agent_id, period, period_key, rank, title, description, alp, deals)
  SELECT agent_id, 'monthly', to_char(v_month_start,'YYYY-MM'), rank,
    CASE rank WHEN 1 THEN 'Monthly MVP' WHEN 2 THEN 'Monthly #2' WHEN 3 THEN 'Monthly #3' ELSE 'Monthly Top 10' END,
    format('%s deals · $%s ALP in %s', deals, alp::text, to_char(v_month_start,'Mon YYYY')),
    alp, deals FROM top10
  ON CONFLICT (agent_id, period, period_key, rank) DO NOTHING;
  GET DIAGNOSTICS v_monthly = ROW_COUNT;

  -- Notify winners (skip orphan profiles not in auth.users)
  INSERT INTO public.notifications (user_id, title, body, type, priority)
  SELECT p.id, r.title, r.description, 'achievement', 'high'
  FROM public.agentlink_rewards r
  JOIN public.agents a ON a.id = r.agent_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE r.awarded_at > now() - interval '5 minutes'
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

  RETURN QUERY VALUES ('daily'::text, v_daily), ('weekly'::text, v_weekly), ('monthly'::text, v_monthly);
END $fn$;
ALTER FUNCTION public.agentlink_award_top_producers() SET statement_timeout='60s';
GRANT EXECUTE ON FUNCTION public.agentlink_award_top_producers() TO service_role, authenticated;

-- Schedule nightly at 03:05 UTC (~10pm CST)
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agentlink-top-producers') THEN
    PERFORM cron.unschedule('agentlink-top-producers');
  END IF;
  PERFORM cron.schedule('agentlink-top-producers', '5 3 * * *',
    $j$ SELECT public.agentlink_award_top_producers(); $j$);
END $outer$;
