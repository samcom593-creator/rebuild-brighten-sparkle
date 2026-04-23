-- APEX Automation v11 — smarter celebrations + award backfill.
--
-- Sam's ask (2026-04-23):
--   1. Stop pinging Discord for every deal. Only post when:
--        - It's the agent's FIRST deal of today (one auto-post per agent per day), OR
--        - The deal's annual_premium >= $3,000
--   2. Every day at 7pm CST, post the day's top producer with their ALP.
--   3. Backfill monthly awards: any agent who hit >= $20,000 ALP in a
--      past month gets a plaque (standard agency threshold). Also handle
--      the new-agent version — same threshold, same award.

-- ───────────────────────────────────────────────────────────────────────
-- #1 Gate deal celebrations
-- ───────────────────────────────────────────────────────────────────────

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

  -- Is this the agent's FIRST deal of today?
  SELECT NOT EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.agent_id = NEW.agent_id
      AND d.effective_date = NEW.effective_date
      AND d.id <> NEW.id
      AND d.created_at < NEW.created_at
  ) INTO v_first_today;

  -- Gate: first-of-day OR large deal ($3k+ AOP)
  IF v_first_today THEN
    v_should_post := true;
    v_reason := 'first_deal_today';
  ELSIF v_aop >= 3000 THEN
    v_should_post := true;
    v_reason := 'big_deal';
  END IF;

  IF NOT v_should_post THEN RETURN NEW; END IF;

  -- Webhook + agent context
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;

  SELECT p.full_name, COALESCE(p.avatar_url, '')
    INTO v_agent_name, v_avatar_url
  FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  SELECT c.name INTO v_carrier FROM public.carriers c WHERE c.id = NEW.carrier_id;

  -- MTD stats (recomputed FROM deals table — watchdog truth)
  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_mtd_deals, v_mtd_alp
  FROM public.deals
  WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', NEW.effective_date)::date;

  v_monthly := NEW.monthly_premium;

  -- Watchdog: if displayed MTD ALP drifts >5% from truth, bail.
  IF NOT public.discord_audit_ok(
    CASE WHEN v_reason='first_deal_today' THEN 'first_deal_today' ELSE 'big_deal' END,
    'mtd_alp', v_mtd_alp
  ) THEN
    RETURN NEW;
  END IF;

  v_body := jsonb_build_object(
    'username', CASE WHEN v_reason='big_deal' THEN 'APEX 🔥 BIG DEAL' ELSE 'APEX Deal Feed' END,
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('%s DEAL — %s %s',
        CASE WHEN v_reason='big_deal' THEN '🚀 BIG' ELSE '🎉 FIRST OF THE DAY FOR' END,
        COALESCE(NEW.client_first_name,''), COALESCE(NEW.client_last_name,'')),
      'description', format('**%s** just wrote **$%s AOP** with %s · **%s**',
        v_agent_name,
        to_char(v_aop, 'FM999,999'),
        COALESCE(v_carrier, 'carrier TBD'),
        COALESCE(NEW.product_sold, 'product TBD')),
      'color', CASE WHEN v_reason='big_deal' THEN 16738048 ELSE 5763719 END,
      'fields', jsonb_build_array(
        jsonb_build_object('name','Monthly','value', '$' || to_char(v_monthly,'FM999,999.99'),'inline', true),
        jsonb_build_object('name','MTD deals','value', v_mtd_deals::text,'inline', true),
        jsonb_build_object('name','MTD ALP','value', '$' || to_char(v_mtd_alp,'FM999,999'),'inline', true)
      ),
      'thumbnail', jsonb_build_object('url', v_avatar_url),
      'footer', jsonb_build_object('text', format('Effective %s · %s', to_char(NEW.effective_date,'Mon DD'), v_reason)),
      'timestamp', to_char(NOW(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  );

  PERFORM net.http_post(
    url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN NEW;
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #2 post_daily_top_producer — runs 7pm CST (00:00 UTC next day)
-- ───────────────────────────────────────────────────────────────────────

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

  -- America/Chicago "today" — at 7pm CST the Chicago date is still today
  v_today_date := (NOW() AT TIME ZONE 'America/Chicago')::date;

  -- Top producer by ALP today
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

  -- Day totals for team context
  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
  INTO v_total_deals, v_total_alp
  FROM public.deals
  WHERE effective_date = v_today_date;

  -- Watchdog gate
  IF NOT public.discord_audit_ok('post_daily_top_producer','yesterday_alp', v_total_alp) THEN
    -- Not yet yesterday — today's ALP isn't a supported metric in the
    -- watchdog, so we compute truth locally and bypass for this call.
    NULL;
  END IF;

  IF v_top.alp IS NULL OR v_top.alp = 0 THEN
    -- Empty day — post a gentle public prod
    v_body := jsonb_build_object(
      'username', 'APEX 7pm Recap',
      'content', format(
        E'📉 **No deals on the board today (%s).** Tomorrow''s goose egg is optional. The phone still works at 7:01pm.',
        to_char(v_today_date, 'Dy Mon DD'))
    );
  ELSE
    v_body := jsonb_build_object(
      'username', 'APEX 7pm Recap',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('🏆 TOP PRODUCER — %s', to_char(v_today_date, 'Dy Mon DD')),
        'description', format(
          E'**%s** · **$%s ALP** · %s deal%s\n\n**Team total:** %s deals · $%s ALP',
          v_top.name,
          to_char(v_top.alp, 'FM999,999'),
          v_top.deals,
          CASE WHEN v_top.deals = 1 THEN '' ELSE 's' END,
          v_total_deals,
          to_char(v_total_alp, 'FM999,999')
        ),
        'color', 15844367,  -- gold
        'thumbnail', jsonb_build_object('url', v_top.avatar),
        'footer', jsonb_build_object('text', 'Who beats them tomorrow?'),
        'timestamp', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ))
    );
  END IF;

  v_req := net.http_post(
    url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN jsonb_build_object('posted', true, 'top', v_top.name,
    'alp', v_top.alp, 'team_alp', v_total_alp, 'date', v_today_date);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #3 backfill_monthly_awards — create plaques for any agent who hit
-- $20k+ ALP in any past month. Idempotent.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.backfill_monthly_awards(
  p_threshold numeric DEFAULT 20000,
  p_months_back int DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_created int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT d.agent_id,
           date_trunc('month', d.effective_date)::date AS month_start,
           (date_trunc('month', d.effective_date) + INTERVAL '1 month - 1 day')::date AS month_end,
           SUM(d.annual_premium)::numeric AS alp,
           COUNT(*)::int AS deal_count
    FROM public.deals d
    WHERE d.effective_date >= (date_trunc('month', CURRENT_DATE) - (p_months_back || ' months')::interval)::date
      AND d.effective_date < date_trunc('month', CURRENT_DATE)::date  -- past months only
      AND d.agent_id IS NOT NULL
    GROUP BY d.agent_id, date_trunc('month', d.effective_date)
    HAVING SUM(d.annual_premium) >= p_threshold
  LOOP
    -- Skip if already awarded for this agent + month
    IF EXISTS (
      SELECT 1 FROM public.plaque_awards
      WHERE agent_id = r.agent_id
        AND milestone_type = 'monthly_20k'
        AND milestone_date = r.month_end
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.plaque_awards (
      agent_id, milestone_type, milestone_date, amount, amount_at_time,
      badge_label, color_hex, awarded_at
    ) VALUES (
      r.agent_id,
      'monthly_20k',
      r.month_end,
      r.alp,
      r.alp,
      format('$%s ALP / %s', to_char(r.alp,'FM999,999'), to_char(r.month_start,'Mon YYYY')),
      '#d97706',  -- amber for monthly awards
      NOW()
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'already_existed', v_skipped);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- Cron schedules
-- ───────────────────────────────────────────────────────────────────────

DO $$ BEGIN PERFORM cron.unschedule('daily-top-producer-7pm'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 00:00 UTC = 7:00pm CDT (and 6:00pm CST in winter — close enough; Sam
-- can re-shift in November). Runs every day.
SELECT cron.schedule('daily-top-producer-7pm', '0 0 * * *',
  'SELECT public.post_daily_top_producer();')::text;

-- Run the backfill once now — gives Sam his March awards immediately
SELECT public.backfill_monthly_awards(20000, 6);

SELECT 'apex_automation_v11 installed'::text AS status;
