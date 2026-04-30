-- ════════════════════════════════════════════════════════════════════════
-- Discord trigger backfill-safety guards
-- Every INSERT-on-deals trigger that posts to Discord now bails when
-- effective_date is older than 2 days. Inbox notifications still log,
-- just with priority='low' so historical imports don't spam the channel.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_deal_celebration()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook text; v_agent_name text; v_avatar text; v_carrier_name text;
  v_mtd_count int; v_mtd_alp numeric; v_body jsonb; v_fire text;
  v_is_backfill boolean;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  v_is_backfill := (
    NEW.effective_date IS NULL
    OR NEW.effective_date < (CURRENT_DATE - interval '2 days')
  );

  SELECT p.full_name, p.avatar_url INTO v_agent_name, v_avatar
  FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric INTO v_mtd_count, v_mtd_alp
  FROM public.deals WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', CURRENT_DATE)::date;

  INSERT INTO public.notifications (user_id, title, body, type, priority)
  SELECT p.id,
    format('Deal %s — %s %s', CASE WHEN v_is_backfill THEN 'imported' ELSE 'closed' END,
      NEW.client_first_name, NEW.client_last_name),
    format('$%s ALP · %s',
      to_char(NEW.annual_premium,'FM999,999,990.00'),
      COALESCE(NEW.product_sold,'policy')),
    'deal_closed',
    CASE WHEN v_is_backfill THEN 'low' ELSE 'high' END
  FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

  IF v_is_backfill THEN RETURN NEW; END IF;

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_carrier_name FROM public.carriers WHERE id = NEW.carrier_id;
  v_fire := CASE
    WHEN NEW.annual_premium >= 3000 THEN '🔥🔥🔥'
    WHEN NEW.annual_premium >= 1500 THEN '🔥🔥' ELSE '🔥' END;

  v_body := jsonb_build_object('username','APEX Deal Alert',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('%s DEAL CLOSED — %s %s', v_fire, NEW.client_first_name, NEW.client_last_name),
      'description', format('**%s** just wrote **$%s ALP** with %s · **%s**',
        COALESCE(v_agent_name,'Agent'), to_char(NEW.annual_premium, 'FM999,999,990.00'),
        COALESCE(v_carrier_name,'carrier'), COALESCE(NEW.product_sold,'policy')),
      'color', 5763719,
      'fields', jsonb_build_array(
        jsonb_build_object('name','Monthly','value','$'||to_char(NEW.monthly_premium,'FM999,990.00'),'inline',true),
        jsonb_build_object('name','MTD deals','value',v_mtd_count::text,'inline',true),
        jsonb_build_object('name','MTD ALP','value','$'||to_char(v_mtd_alp,'FM999,999,990.00'),'inline',true)),
      'thumbnail', CASE WHEN v_avatar IS NOT NULL THEN jsonb_build_object('url', v_avatar) ELSE NULL END,
      'footer', jsonb_build_object('text', format('Effective %s CST',
        to_char(NEW.effective_date AT TIME ZONE 'America/Chicago', 'Mon DD'))),
      'timestamp', to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD"T"HH24:MI:SSOF'))));

  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.trg_fn_first_deal_welcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_prior int; v_webhook text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.effective_date IS NULL OR NEW.effective_date < CURRENT_DATE - interval '2 days' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_prior FROM public.deals WHERE agent_id = NEW.agent_id AND id <> NEW.id;
  IF v_prior > 0 THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('🎉 FIRST DEAL — %s just opened their book!', COALESCE(v_agent_name,'new agent')),
      'description', format('$%s ALP on their very first policy. Rally around them.',
        to_char(NEW.annual_premium, 'FM999,999,990.00')),
      'color', 16766720,
      'timestamp', to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD"T"HH24:MI:SSOF'))));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.trg_fn_hot_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_agent_name text; v_count_24h int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.effective_date IS NULL OR NEW.effective_date < CURRENT_DATE - interval '2 days' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_count_24h FROM public.deals
  WHERE agent_id = NEW.agent_id AND effective_date >= CURRENT_DATE - interval '1 days';
  IF v_count_24h < 3 THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.agents a WHERE a.id = NEW.agent_id
    AND (a.metadata->>'hot_streak_at')::timestamptz > now() - interval '20 hours') THEN RETURN NEW; END IF;
  UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) ||
    jsonb_build_object('hot_streak_at', now()) WHERE id = NEW.agent_id;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX',
    'content', format(E'🔥🔥🔥 **HOT STREAK — %s wrote %s deals in 24h**\n\nRide the wave. Get on the phone.',
      COALESCE(v_agent_name,'Someone'), v_count_24h));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.trg_fn_referral_ask()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_agent_name text; v_count int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.effective_date IS NULL OR NEW.effective_date < CURRENT_DATE - interval '2 days' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_count FROM public.deals WHERE agent_id = NEW.agent_id;
  IF v_count NOT IN (3, 5, 10) THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX',
    'content', format(E'🌱 **%s just wrote their %sth deal!** Perfect moment to ask them:\n\n*"Who do you know that should be doing this with us?"*',
      COALESCE(v_agent_name,'An agent'), v_count));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;
