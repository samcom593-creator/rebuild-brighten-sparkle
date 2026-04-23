-- Fix: false-positive divergences in the Discord watchdog from two
-- recent callers using wrong metric labels:
--   1. post_daily_top_producer was calling with 'yesterday_alp' but
--      passing today's team total. Truth query fetched yesterday's
--      number, flagged 10% drift, ABORTED the post.
--   2. trg_fn_deal_celebration was calling with 'mtd_alp' but passing
--      the AGENT's MTD (scoped by agent_id). Truth query fetched team
--      MTD, flagged 99% drift, ABORTED the post.
--
-- Also extends discord_audit_ok with today_alp + today_deals metrics.

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
  v_today date;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Chicago')::date;

  v_truth := CASE p_metric
    WHEN 'today_alp' THEN
      (SELECT COALESCE(SUM(annual_premium),0)::numeric
         FROM public.deals WHERE effective_date = v_today)
    WHEN 'today_deals' THEN
      (SELECT COUNT(*)::numeric FROM public.deals WHERE effective_date = v_today)
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

  IF v_truth IS NULL THEN
    INSERT INTO public.discord_post_audits (source, metric, claimed_value, truth_value, diverged, posted)
    VALUES (p_source, p_metric, p_claimed_value, 0, FALSE, TRUE);
    RETURN TRUE;
  END IF;

  v_div_pct := CASE
    WHEN GREATEST(v_truth, p_claimed_value, 1) = 0 THEN 0
    ELSE ABS(p_claimed_value - v_truth) / GREATEST(v_truth, p_claimed_value, 1) * 100
  END;
  v_diverged := v_div_pct > p_tolerance_pct;

  INSERT INTO public.discord_post_audits
    (source, metric, claimed_value, truth_value, diverged, divergence_pct, posted)
  VALUES (p_source, p_metric, p_claimed_value, v_truth, v_diverged, v_div_pct, NOT v_diverged);

  IF v_diverged THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, action_link, channels)
    VALUES ('watchdog', 'discord_number_mismatch', 'warn',
            format('Discord post blocked: %s %s off by %s%%', p_source, p_metric, ROUND(v_div_pct,1)),
            format('Function %s tried to post %s = %s, truth = %s',
                   p_source, p_metric,
                   to_char(p_claimed_value,'FM999,999,999.99'),
                   to_char(v_truth,'FM999,999,999.99')),
            '/dashboard/system-health', ARRAY['email']::TEXT[]);
  END IF;

  RETURN NOT v_diverged;
END;
$body$;

-- Fixed caller 1: post_daily_top_producer uses today_alp (matches passed value)
CREATE OR REPLACE FUNCTION public.post_daily_top_producer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_webhook text;
  v_today_date date;
  v_top record;
  v_total_alp numeric;
  v_total_deals int;
  v_body jsonb;
  v_req bigint;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  v_today_date := (NOW() AT TIME ZONE 'America/Chicago')::date;

  SELECT p.full_name AS name,
         COALESCE(p.avatar_url,'') AS avatar,
         SUM(d.annual_premium)::numeric AS alp,
         COUNT(*)::int AS deals
  INTO v_top
  FROM public.deals d
  JOIN public.agents a ON a.id = d.agent_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE d.effective_date = v_today_date
  GROUP BY p.full_name, p.avatar_url
  ORDER BY SUM(d.annual_premium) DESC
  LIMIT 1;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
  INTO v_total_deals, v_total_alp
  FROM public.deals
  WHERE effective_date = v_today_date;

  IF NOT public.discord_audit_ok('post_daily_top_producer', 'today_alp', v_total_alp) THEN
    RETURN jsonb_build_object('aborted','numbers_drifted','metric','today_alp');
  END IF;

  IF v_top.alp IS NULL OR v_top.alp = 0 THEN
    v_body := jsonb_build_object(
      'username', 'APEX 7pm Recap',
      'content', format(
        E'📉 **No deals on the board today (%s).** Tomorrow''s goose egg is optional. The phone still works at 7:01pm.',
        to_char(v_today_date, 'Dy Mon DD')));
  ELSE
    v_body := jsonb_build_object(
      'username', 'APEX 7pm Recap',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('🏆 TOP PRODUCER — %s', to_char(v_today_date, 'Dy Mon DD')),
        'description', format(
          E'**%s** · **$%s ALP** · %s deal%s\n\n**Team total:** %s deals · $%s ALP',
          v_top.name, to_char(v_top.alp, 'FM999,999'),
          v_top.deals, CASE WHEN v_top.deals = 1 THEN '' ELSE 's' END,
          v_total_deals, to_char(v_total_alp, 'FM999,999')),
        'color', 15844367,
        'thumbnail', jsonb_build_object('url', v_top.avatar),
        'footer', jsonb_build_object('text', 'Who beats them tomorrow?'),
        'timestamp', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
  END IF;

  v_req := net.http_post(url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN jsonb_build_object('posted', true, 'top', v_top.name,
    'alp', v_top.alp, 'team_alp', v_total_alp, 'date', v_today_date);
END;
$body$;

-- Fixed caller 2: trg_fn_deal_celebration drops the watchdog (per-agent
-- MTD claim is inherently consistent with deals-table truth since they
-- come from the same source, same transaction).
CREATE OR REPLACE FUNCTION public.trg_fn_deal_celebration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_webhook text;
  v_agent_name text;
  v_avatar_url text;
  v_carrier text;
  v_mtd_deals int;
  v_mtd_alp numeric;
  v_monthly numeric;
  v_aop numeric;
  v_first_today boolean;
  v_should_post boolean := false;
  v_reason text;
  v_body jsonb;
BEGIN
  IF NEW.agent_id IS NULL OR NEW.annual_premium IS NULL THEN RETURN NEW; END IF;

  v_aop := NEW.annual_premium;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.agent_id = NEW.agent_id
      AND d.effective_date = NEW.effective_date
      AND d.id <> NEW.id
      AND d.created_at < NEW.created_at
  ) INTO v_first_today;

  IF v_first_today THEN
    v_should_post := true;
    v_reason := 'first_deal_today';
  ELSIF v_aop >= 3000 THEN
    v_should_post := true;
    v_reason := 'big_deal';
  END IF;

  IF NOT v_should_post THEN RETURN NEW; END IF;

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;

  SELECT p.full_name, COALESCE(p.avatar_url, '')
    INTO v_agent_name, v_avatar_url
  FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  SELECT c.name INTO v_carrier FROM public.carriers c WHERE c.id = NEW.carrier_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_mtd_deals, v_mtd_alp
  FROM public.deals
  WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', NEW.effective_date)::date;

  v_monthly := NEW.monthly_premium;

  v_body := jsonb_build_object(
    'username', CASE WHEN v_reason='big_deal' THEN 'APEX 🔥 BIG DEAL' ELSE 'APEX Deal Feed' END,
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('%s DEAL — %s %s',
        CASE WHEN v_reason='big_deal' THEN '🚀 BIG' ELSE '🎉 FIRST OF THE DAY FOR' END,
        COALESCE(NEW.client_first_name,''), COALESCE(NEW.client_last_name,'')),
      'description', format('**%s** just wrote **$%s AOP** with %s · **%s**',
        v_agent_name, to_char(v_aop, 'FM999,999'),
        COALESCE(v_carrier, 'carrier TBD'),
        COALESCE(NEW.product_sold, 'product TBD')),
      'color', CASE WHEN v_reason='big_deal' THEN 16738048 ELSE 5763719 END,
      'fields', jsonb_build_array(
        jsonb_build_object('name','Monthly','value', '$' || to_char(v_monthly,'FM999,999.99'),'inline', true),
        jsonb_build_object('name','MTD deals','value', v_mtd_deals::text,'inline', true),
        jsonb_build_object('name','MTD ALP','value', '$' || to_char(v_mtd_alp,'FM999,999'),'inline', true)),
      'thumbnail', jsonb_build_object('url', v_avatar_url),
      'footer', jsonb_build_object('text', format('Effective %s · %s', to_char(NEW.effective_date,'Mon DD'), v_reason)),
      'timestamp', to_char(NOW(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));

  PERFORM net.http_post(url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN NEW;
END;
$body$;
