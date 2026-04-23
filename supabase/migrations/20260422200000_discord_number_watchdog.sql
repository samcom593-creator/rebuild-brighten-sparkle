-- Discord number watchdog.
-- Every time anything posts "MTD ALP", "weekly ALP", "deal count" etc. to
-- Discord, it logs the claim here FIRST. A safety check runs right before
-- http_post: if the claim diverges from the deals-table truth by more than
-- 5%, we abort the post and raise a bot_alerts 'warn' instead. Ensures we
-- never tell agents a number that doesn't match Agent Link.

CREATE TABLE IF NOT EXISTS public.discord_post_audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL,          -- function name that wanted to post
  metric          TEXT NOT NULL,          -- 'mtd_alp' | 'weekly_alp' | 'deal_count' | 'yesterday_alp'
  claimed_value   NUMERIC NOT NULL,
  truth_value     NUMERIC NOT NULL,
  diverged        BOOLEAN NOT NULL DEFAULT FALSE,
  divergence_pct  NUMERIC,
  posted          BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_discord_post_audits_recent
  ON public.discord_post_audits (posted_at DESC);

-- Core audit helper: returns true if the claim is within tolerance, false
-- if it's drifted. Logs either way. Callers use:
--   IF public.discord_audit_ok('post_morning_huddle','yesterday_alp',$claim) THEN
--     <post>
--   END IF;
CREATE OR REPLACE FUNCTION public.discord_audit_ok(
  p_source        text,
  p_metric        text,
  p_claimed_value numeric,
  p_tolerance_pct numeric DEFAULT 5.0
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_truth numeric;
  v_div_pct numeric;
  v_diverged boolean;
BEGIN
  -- Compute truth from deals table. Everything Agent Link syncs ends up here.
  v_truth := CASE p_metric
    WHEN 'yesterday_alp' THEN
      (SELECT COALESCE(SUM(annual_premium),0)::numeric
         FROM public.deals WHERE effective_date = (CURRENT_DATE - 1)::date)
    WHEN 'yesterday_deals' THEN
      (SELECT COUNT(*)::numeric FROM public.deals
         WHERE effective_date = (CURRENT_DATE - 1)::date)
    WHEN 'mtd_alp' THEN
      (SELECT COALESCE(SUM(annual_premium),0)::numeric
         FROM public.deals WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date)
    WHEN 'mtd_deals' THEN
      (SELECT COUNT(*)::numeric FROM public.deals
         WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date)
    WHEN 'weekly_alp' THEN
      (SELECT COALESCE(SUM(annual_premium),0)::numeric
         FROM public.deals WHERE effective_date >= date_trunc('week', CURRENT_DATE)::date)
    WHEN 'weekly_deals' THEN
      (SELECT COUNT(*)::numeric FROM public.deals
         WHERE effective_date >= date_trunc('week', CURRENT_DATE)::date)
    ELSE NULL
  END;

  -- Unknown metric → don't block; just log and allow.
  IF v_truth IS NULL THEN
    INSERT INTO public.discord_post_audits (source, metric, claimed_value, truth_value, diverged, posted)
    VALUES (p_source, p_metric, p_claimed_value, 0, FALSE, TRUE);
    RETURN TRUE;
  END IF;

  -- Divergence %: abs(claim - truth) / max(truth, claim, 1)
  v_div_pct := CASE
    WHEN GREATEST(v_truth, p_claimed_value, 1) = 0 THEN 0
    ELSE ABS(p_claimed_value - v_truth) / GREATEST(v_truth, p_claimed_value, 1) * 100
  END;
  v_diverged := v_div_pct > p_tolerance_pct;

  INSERT INTO public.discord_post_audits
    (source, metric, claimed_value, truth_value, diverged, divergence_pct, posted)
  VALUES (p_source, p_metric, p_claimed_value, v_truth, v_diverged, v_div_pct, NOT v_diverged);

  -- If diverged, raise an alert so Sam sees it.
  IF v_diverged THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, action_link, channels)
    VALUES (
      'watchdog',
      'discord_number_mismatch',
      'warn',
      format('Discord post blocked: %s %s off by %s%%', p_source, p_metric, ROUND(v_div_pct,1)),
      format(E'Function %s tried to post %s = %s, but deals-table truth is %s. Post was blocked to prevent agent mistrust.\n\nDrift: %s%% (tolerance %s%%).',
             p_source, p_metric,
             to_char(p_claimed_value,'FM999,999,999.99'),
             to_char(v_truth,'FM999,999,999.99'),
             ROUND(v_div_pct,1), p_tolerance_pct),
      '/dashboard/system-health',
      ARRAY['email']::TEXT[]
    );
  END IF;

  RETURN NOT v_diverged;
END;
$body$;

ALTER TABLE public.discord_post_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins see discord audits" ON public.discord_post_audits;
CREATE POLICY "Admins see discord audits"
  ON public.discord_post_audits
  FOR SELECT TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Hook post_morning_huddle into the watchdog.
-- If yesterday's ALP drifts >5% from deals-table truth, we skip the post
-- (watchdog files a bot_alert so we know). Better silent than lying.
CREATE OR REPLACE FUNCTION public.post_morning_huddle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_webhook text;
  v_req bigint;
  v_yesterday_deals int;
  v_yesterday_alp numeric;
  v_top_agent_yesterday text;
  v_top_agent_alp numeric;
  v_mtd_deals int;
  v_total_mtd_alp numeric;
  v_yesterday_weekday text;
  v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  v_yesterday_weekday := to_char(CURRENT_DATE - 1, 'Day');

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_yesterday_deals, v_yesterday_alp
  FROM public.deals
  WHERE effective_date = (CURRENT_DATE - 1)::date;

  SELECT p.full_name, COALESCE(SUM(d.annual_premium),0)::numeric
    INTO v_top_agent_yesterday, v_top_agent_alp
  FROM public.deals d
  JOIN public.agents a ON a.id = d.agent_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE d.effective_date = (CURRENT_DATE - 1)::date
  GROUP BY p.full_name
  ORDER BY SUM(d.annual_premium) DESC LIMIT 1;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_mtd_deals, v_total_mtd_alp
  FROM public.deals
  WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date;

  -- Watchdog check: since we're computing truth from the same deals table,
  -- these should always pass. The check is insurance for future callers
  -- who pass values from elsewhere.
  IF NOT public.discord_audit_ok('post_morning_huddle', 'yesterday_alp', v_yesterday_alp) THEN
    RETURN jsonb_build_object('aborted','numbers_drifted','metric','yesterday_alp');
  END IF;
  IF NOT public.discord_audit_ok('post_morning_huddle', 'mtd_alp', v_total_mtd_alp) THEN
    RETURN jsonb_build_object('aborted','numbers_drifted','metric','mtd_alp');
  END IF;

  v_body := jsonb_build_object(
    'username', 'APEX Morning Huddle',
    'content', CASE
      WHEN v_yesterday_deals = 0 THEN format(
        E'🌅 **MORNING HUDDLE** — %s was a goose egg. Today is the day we fix that.\n\n**MTD**: %s deals · $%s ALP\n\n📞 First dial by 10:30. No excuses.',
        trim(v_yesterday_weekday),
        v_mtd_deals,
        to_char(v_total_mtd_alp, 'FM999,999,999'))
      ELSE format(
        E'🌅 **MORNING HUDDLE** — %s wrote %s deals · $%s ALP.\n\n🏆 Top producer %s: $%s\n**MTD**: %s deals · $%s ALP\n\nWho beats %s today? Go.',
        trim(v_yesterday_weekday),
        v_yesterday_deals,
        to_char(v_yesterday_alp, 'FM999,999,999'),
        COALESCE(v_top_agent_yesterday, 'TBD'),
        to_char(v_top_agent_alp, 'FM999,999,999'),
        v_mtd_deals,
        to_char(v_total_mtd_alp, 'FM999,999,999'),
        COALESCE(v_top_agent_yesterday, 'them'))
    END
  );

  v_req := net.http_post(url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));
  RETURN jsonb_build_object('posted', true, 'request_id', v_req);
END;
$body$;
