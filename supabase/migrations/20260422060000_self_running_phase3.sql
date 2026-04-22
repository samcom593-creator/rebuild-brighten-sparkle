-- ════════════════════════════════════════════════════════════════════════
-- PHASE 3 — evening/weekly recaps + first-deal welcome + reward broadcasts
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.post_evening_recap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook text; v_req bigint;
  v_today_deals int; v_today_alp numeric; v_top_3 text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_today_deals, v_today_alp
  FROM public.deals WHERE effective_date = CURRENT_DATE;

  SELECT string_agg(
    (rank::text || '. ' || name || ' — $' || to_char(alp,'FM999,990') ||
     ' (' || deals || ')'), E'\n' ORDER BY rank)
  INTO v_top_3
  FROM (SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rank,
      p.full_name AS name, SUM(d.annual_premium) AS alp, COUNT(*) AS deals
    FROM public.deals d JOIN public.agents a ON a.id=d.agent_id
    JOIN public.profiles p ON p.id=a.profile_id
    WHERE d.effective_date = CURRENT_DATE
    GROUP BY p.full_name ORDER BY SUM(d.annual_premium) DESC LIMIT 3) t;

  v_body := jsonb_build_object('username','APEX Evening Recap',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('🌆 Day Complete — %s', to_char(now() AT TIME ZONE 'America/Chicago', 'Dy, Mon DD')),
      'description', format('**%s deals · $%s ALP today**%s',
        v_today_deals, to_char(v_today_alp,'FM999,999,990.00'),
        CASE WHEN v_top_3 IS NOT NULL THEN E'\n\n**Top 3:**\n' || v_top_3 ELSE '' END),
      'color', 7506394, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));

  v_req := net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 20000);
  RETURN jsonb_build_object('posted', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.post_evening_recap() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='evening-recap-7pm-cst') THEN
    PERFORM cron.unschedule('evening-recap-7pm-cst'); END IF;
  PERFORM cron.schedule('evening-recap-7pm-cst', '0 0 * * *',
    $j$ SELECT public.post_evening_recap(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.post_weekly_recap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook text; v_deals int; v_alp numeric;
  v_top_3 text; v_new_hires int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric INTO v_deals, v_alp
  FROM public.deals WHERE effective_date >= CURRENT_DATE - interval '7 days';
  SELECT COUNT(*)::int INTO v_new_hires FROM public.agents WHERE created_at > now() - interval '7 days';
  SELECT string_agg((rank::text || '. ' || name || ' — $' || to_char(alp,'FM999,990') ||
     ' (' || deals || ' deals)'), E'\n' ORDER BY rank) INTO v_top_3
  FROM (SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rank,
      p.full_name AS name, SUM(d.annual_premium) AS alp, COUNT(*) AS deals
    FROM public.deals d JOIN public.agents a ON a.id=d.agent_id
    JOIN public.profiles p ON p.id=a.profile_id
    WHERE d.effective_date >= CURRENT_DATE - interval '7 days'
    GROUP BY p.full_name ORDER BY SUM(d.annual_premium) DESC LIMIT 3) t;
  v_body := jsonb_build_object('username','APEX Weekly Wrap',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title','📅 Week in Review',
      'description', format('**%s deals · $%s ALP** this week · **%s new agents**%s',
        v_deals, to_char(v_alp,'FM999,999,990.00'), v_new_hires,
        CASE WHEN v_top_3 IS NOT NULL THEN E'\n\n**Top performers:**\n' || v_top_3 ELSE '' END),
      'color', 15844367, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 20000);
  RETURN jsonb_build_object('posted', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.post_weekly_recap() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='weekly-recap-sunday') THEN
    PERFORM cron.unschedule('weekly-recap-sunday'); END IF;
  PERFORM cron.schedule('weekly-recap-sunday', '0 2 * * 1',
    $j$ SELECT public.post_weekly_recap(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.trg_fn_first_deal_welcome()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_prior_deals int; v_webhook text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_prior_deals FROM public.deals
  WHERE agent_id = NEW.agent_id AND id <> NEW.id;
  IF v_prior_deals > 0 THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('🎉 FIRST DEAL — %s just opened their book!', COALESCE(v_agent_name,'new agent')),
      'description', format('$%s ALP on their very first policy. Rally around them.',
        to_char(NEW.annual_premium, 'FM999,999,990.00')),
      'color', 16766720, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_first_deal_welcome ON public.deals;
CREATE TRIGGER trg_first_deal_welcome AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_first_deal_welcome();

CREATE OR REPLACE FUNCTION public.trg_fn_reward_broadcast()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_wa text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.rank > 1 THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  SELECT value INTO v_wa      FROM public.system_settings WHERE key='whatsapp_group_link';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX Rewards',
    'content', format(
      E'📣 **%s · %s** — congrats to **%s**!\n%s%s',
      NEW.title, NEW.period_key, COALESCE(v_agent_name,'Agent'),
      COALESCE(NEW.description,''),
      CASE WHEN v_wa IS NOT NULL THEN E'\n\n🔗 WhatsApp: ' || v_wa ELSE '' END));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_reward_broadcast ON public.agentlink_rewards;
CREATE TRIGGER trg_reward_broadcast AFTER INSERT ON public.agentlink_rewards
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_reward_broadcast();
