-- MP-393: native deals never reached eight of the deal triggers.
--
-- submit_apex_deal_ledger_impl INSERTs a deal as status='draft' with
-- posted_at='2000-01-01' and only then UPDATEs it to submitted/apex_native.
-- Eight AFTER INSERT triggers gate on status <> 'draft' or on
-- is_fresh_deal_close(posted_at), so on the ledger path they were dead code:
-- big-deal phone push (bot_alerts), first-deal welcome, hot streak, referral
-- ask, culture loop, deal broadcast (deal e-mails), next-step first-deal
-- check, and the daily_production rollup. Measured 2026-09-03: 0 deal
-- bot_alerts in 7d against 6 native deals posted; Discord and Slack reached
-- the channel only because trg_deal_celebration already had an UPDATE OF
-- source twin. This migration gives the other eight the same twin, gated on
-- the draft -> posted flip so the AgentLink import path (non-draft at insert)
-- fires exactly once as before, and native deals fire exactly once on post.
--
-- Four trigger functions short-circuit on TG_OP <> 'INSERT'; they now accept
-- the draft -> posted UPDATE and nothing else. No backfill of historical
-- native deals into daily_production here: that is a measured, separate task.

CREATE OR REPLACE FUNCTION public.trg_fn_hot_streak()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE v_webhook text; v_agent_name text; v_count_24h int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') THEN RETURN NEW; END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_first_deal_welcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE v_prior int; v_webhook text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') THEN RETURN NEW; END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_referral_ask()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE v_webhook text; v_agent_name text; v_count int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') THEN RETURN NEW; END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.deals_rollup_to_daily_production()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft')) THEN
    -- production_date = the day the work happened; a policy can be EFFECTIVE in the
    -- future (next-month/quarter start), so clamp to today to satisfy the future-date
    -- guard. Without this, ONE future-effective deal rolls back the entire AgentLink sync.
    INSERT INTO public.daily_production (agent_id, production_date, aop, deals_closed, presentations, hours_called, closing_rate)
    VALUES (NEW.agent_id, LEAST(NEW.effective_date, CURRENT_DATE), NEW.annual_premium, 1, 0, 0, 0)
    ON CONFLICT (agent_id, production_date) DO UPDATE
      SET aop = daily_production.aop + EXCLUDED.aop,
          deals_closed = daily_production.deals_closed + 1;
  END IF;
  RETURN NEW;
END;
$function$
;

DROP TRIGGER IF EXISTS trg_bot_alert_big_deal_native_post ON public.deals;
CREATE TRIGGER trg_bot_alert_big_deal_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') AND is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at)) EXECUTE FUNCTION bot_alert_big_deal();

DROP TRIGGER IF EXISTS trg_culture_loop_on_deal_native_post ON public.deals;
CREATE TRIGGER trg_culture_loop_on_deal_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft')) EXECUTE FUNCTION fn_culture_loop_on_deal();

DROP TRIGGER IF EXISTS trg_deal_broadcast_native_post ON public.deals;
CREATE TRIGGER trg_deal_broadcast_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft')) EXECUTE FUNCTION trg_fn_deal_broadcast();

DROP TRIGGER IF EXISTS trg_deals_rollup_native_post ON public.deals;
CREATE TRIGGER trg_deals_rollup_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft')) EXECUTE FUNCTION deals_rollup_to_daily_production();

DROP TRIGGER IF EXISTS trg_first_deal_welcome_native_post ON public.deals;
CREATE TRIGGER trg_first_deal_welcome_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') AND is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at)) EXECUTE FUNCTION trg_fn_first_deal_welcome();

DROP TRIGGER IF EXISTS trg_hot_streak_native_post ON public.deals;
CREATE TRIGGER trg_hot_streak_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') AND is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at)) EXECUTE FUNCTION trg_fn_hot_streak();

DROP TRIGGER IF EXISTS trg_next_step_deal_first_check_native_post ON public.deals;
CREATE TRIGGER trg_next_step_deal_first_check_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft')) EXECUTE FUNCTION fn_next_step_deal_first_check();

DROP TRIGGER IF EXISTS trg_referral_ask_native_post ON public.deals;
CREATE TRIGGER trg_referral_ask_native_post AFTER UPDATE OF status ON public.deals FOR EACH ROW WHEN ((OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') AND is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at)) EXECUTE FUNCTION trg_fn_referral_ask();
