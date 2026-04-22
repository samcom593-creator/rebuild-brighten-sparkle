-- ════════════════════════════════════════════════════════════════════════
-- PHASE 1–2 — self-running automations for hire-at-scale operations
--
-- Installs:
--   • post_morning_huddle()      — 9:30am CST Discord summary (Mon–Fri)
--   • trg_fn_deal_celebration    — fires on every deal insert → Discord +
--                                  notification (MTD stats included)
--   • post_hiring_bottleneck_alert — daily 8am CST if apps are stuck
--   • auto_advance_stale_applications — nightly: new→no_pickup@14d,
--                                  no_pickup→rejected@30d
--   • broadcast_to_all_channels  — single entrypoint that echoes to Discord
--                                  with a link to the WhatsApp group
--   • sms_fallback_queue         — queue for email-gateway SMS fallback
--   • notification_prefs         — per-user channel opt-ins
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.post_morning_huddle()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook text; v_req bigint;
  v_yesterday_deals int; v_yesterday_alp numeric; v_top_agent text;
  v_pending_apps int; v_mtd_deals int; v_total_mtd_alp numeric;
  v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_yesterday_deals, v_yesterday_alp
  FROM public.deals WHERE effective_date = (CURRENT_DATE - 1)::date;

  SELECT p.full_name INTO v_top_agent
  FROM public.deals d JOIN public.agents a ON a.id = d.agent_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE d.effective_date = (CURRENT_DATE - 1)::date
  GROUP BY p.full_name ORDER BY SUM(d.annual_premium) DESC LIMIT 1;

  SELECT COUNT(*)::int INTO v_pending_apps
  FROM public.applications
  WHERE status IN ('new','no_pickup','reviewing') AND created_at > now() - interval '30 days';

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_mtd_deals, v_total_mtd_alp
  FROM public.deals WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date;

  v_body := jsonb_build_object(
    'username','APEX Morning Huddle',
    'content', format(
      E'**🌅 MORNING HUDDLE — %s**\n\n📊 **Yesterday:** %s deal%s · $%s ALP · Top producer: %s\n📈 **Month-to-date:** %s deals · $%s ALP\n📞 **Follow-up queue:** %s applications waiting for a call today\n\nLet''s run it up. Meeting in 15 min.',
      to_char(now() AT TIME ZONE 'America/Chicago', 'Dy, Mon DD'),
      v_yesterday_deals, CASE WHEN v_yesterday_deals = 1 THEN '' ELSE 's' END,
      to_char(v_yesterday_alp, 'FM999,999,990.00'),
      COALESCE(v_top_agent, 'nobody yet — be the first!'),
      v_mtd_deals, to_char(v_total_mtd_alp, 'FM999,999,990.00'),
      v_pending_apps));

  v_req := net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 20000);
  RETURN jsonb_build_object('posted', true, 'request_id', v_req);
END $fn$;
GRANT EXECUTE ON FUNCTION public.post_morning_huddle() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='morning-huddle-930-cst') THEN
    PERFORM cron.unschedule('morning-huddle-930-cst'); END IF;
  PERFORM cron.schedule('morning-huddle-930-cst', '30 14 * * 1-5',
    $j$ SELECT public.post_morning_huddle(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.trg_fn_deal_celebration()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook text; v_agent_name text; v_avatar text; v_carrier_name text;
  v_mtd_count int; v_mtd_alp numeric; v_body jsonb; v_fire text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  SELECT p.full_name, p.avatar_url INTO v_agent_name, v_avatar
  FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  SELECT name INTO v_carrier_name FROM public.carriers WHERE id = NEW.carrier_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric INTO v_mtd_count, v_mtd_alp
  FROM public.deals WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', CURRENT_DATE)::date;

  v_fire := CASE
    WHEN NEW.annual_premium >= 3000 THEN '🔥🔥🔥'
    WHEN NEW.annual_premium >= 1500 THEN '🔥🔥' ELSE '🔥' END;

  v_body := jsonb_build_object(
    'username','APEX Deal Alert',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('%s DEAL CLOSED — %s %s', v_fire, NEW.client_first_name, NEW.client_last_name),
      'description', format('**%s** just wrote **$%s ALP** with %s · **%s**',
        COALESCE(v_agent_name,'Agent'),
        to_char(NEW.annual_premium, 'FM999,999,990.00'),
        COALESCE(v_carrier_name,'carrier'),
        COALESCE(NEW.product_sold,'policy')),
      'color', 5763719,
      'fields', jsonb_build_array(
        jsonb_build_object('name','Monthly','value','$'||to_char(NEW.monthly_premium,'FM999,990.00'),'inline',true),
        jsonb_build_object('name','MTD deals','value',v_mtd_count::text,'inline',true),
        jsonb_build_object('name','MTD ALP','value','$'||to_char(v_mtd_alp,'FM999,999,990.00'),'inline',true)),
      'thumbnail', CASE WHEN v_avatar IS NOT NULL THEN jsonb_build_object('url', v_avatar) ELSE NULL END,
      'footer', jsonb_build_object('text','Let''s get some!'),
      'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));

  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);

  INSERT INTO public.notifications (user_id, title, body, type, priority)
  SELECT p.id,
    format('%s Deal closed: %s %s', v_fire, NEW.client_first_name, NEW.client_last_name),
    format('$%s ALP · %s · MTD: %s deals / $%s',
      to_char(NEW.annual_premium,'FM999,999,990.00'),
      COALESCE(NEW.product_sold,'policy'), v_mtd_count,
      to_char(v_mtd_alp, 'FM999,999,990.00')),
    'deal_closed', 'high'
  FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_deal_celebration ON public.deals;
CREATE TRIGGER trg_deal_celebration AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_deal_celebration();

CREATE OR REPLACE FUNCTION public.post_hiring_bottleneck_alert()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook text; v_stale_new int; v_stale_pickup int; v_reviewing int; v_contracting int;
  v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
  SELECT
    COUNT(*) FILTER (WHERE status='new' AND created_at < now() - interval '1 day')::int,
    COUNT(*) FILTER (WHERE status='no_pickup' AND updated_at < now() - interval '2 days')::int,
    COUNT(*) FILTER (WHERE status='reviewing' AND updated_at < now() - interval '3 days')::int,
    COUNT(*) FILTER (WHERE status='contracting')::int
  INTO v_stale_new, v_stale_pickup, v_reviewing, v_contracting
  FROM public.applications WHERE created_at > now() - interval '30 days';
  IF (v_stale_new + v_stale_pickup + v_reviewing) = 0 THEN
    RETURN jsonb_build_object('no_alerts', true); END IF;
  v_body := jsonb_build_object('username','APEX Hiring Alert',
    'content', format(
      E'**⚠️ HIRING FUNNEL NEEDS LOVE**\n\n🆕 **%s** new applications (not touched yet)\n📞 **%s** no-pickups stuck >2 days — retry or close\n👀 **%s** in review >3 days — decide\n📝 **%s** currently contracting — shepherd them through\n\nDashboard: https://apex-financial.org/dashboard/recruit',
      v_stale_new, v_stale_pickup, v_reviewing, v_contracting));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 20000);
  RETURN jsonb_build_object('posted', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.post_hiring_bottleneck_alert() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='hiring-bottleneck-alert') THEN
    PERFORM cron.unschedule('hiring-bottleneck-alert'); END IF;
  PERFORM cron.schedule('hiring-bottleneck-alert', '0 13 * * 1-6',
    $j$ SELECT public.post_hiring_bottleneck_alert(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.auto_advance_stale_applications()
RETURNS TABLE(action text, count int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_new_to_nopickup int := 0; v_nopickup_to_rejected int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH x AS (UPDATE public.applications SET status='no_pickup', updated_at = now()
    WHERE status='new' AND created_at < now() - interval '14 days' RETURNING id)
  SELECT COUNT(*)::int INTO v_new_to_nopickup FROM x;
  WITH x AS (UPDATE public.applications SET status='rejected', updated_at = now(),
    notes = COALESCE(notes,'') || E'\n[auto] closed after 30d no response'
    WHERE status='no_pickup' AND updated_at < now() - interval '30 days' RETURNING id)
  SELECT COUNT(*)::int INTO v_nopickup_to_rejected FROM x;
  RETURN QUERY VALUES ('new→no_pickup', v_new_to_nopickup),
    ('no_pickup→rejected', v_nopickup_to_rejected);
END $fn$;
GRANT EXECUTE ON FUNCTION public.auto_advance_stale_applications() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='auto-advance-applications') THEN
    PERFORM cron.unschedule('auto-advance-applications'); END IF;
  PERFORM cron.schedule('auto-advance-applications', '0 4 * * *',
    $j$ SELECT public.auto_advance_stale_applications(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.broadcast_to_all_channels(
  p_title text, p_body text, p_priority text DEFAULT 'normal')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_wa_link text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  SELECT value INTO v_wa_link FROM public.system_settings WHERE key='whatsapp_group_link';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
  v_body := jsonb_build_object('username','APEX Broadcast',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', p_title,
      'description', p_body || CASE WHEN v_wa_link IS NOT NULL
        THEN E'\n\n📱 Forward to WhatsApp: ' || v_wa_link ELSE '' END,
      'color', CASE p_priority WHEN 'high' THEN 16711680 WHEN 'low' THEN 10197915 ELSE 5763719 END,
      'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN jsonb_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.broadcast_to_all_channels(text,text,text) TO service_role, authenticated;

CREATE TABLE IF NOT EXISTS public.sms_fallback_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL, body text NOT NULL, carrier_hint text,
  status text NOT NULL DEFAULT 'pending', sent_at timestamptz, error text,
  created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_smsfb_pending ON public.sms_fallback_queue(created_at) WHERE status = 'pending';
ALTER TABLE public.sms_fallback_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS smsfb_svc ON public.sms_fallback_queue;
CREATE POLICY smsfb_svc ON public.sms_fallback_queue FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_celebration boolean DEFAULT true,
  morning_huddle boolean DEFAULT true,
  weekly_summary boolean DEFAULT true,
  achievement_alert boolean DEFAULT true,
  discord_enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now());
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS np_own ON public.notification_prefs;
DROP POLICY IF EXISTS np_svc ON public.notification_prefs;
CREATE POLICY np_own ON public.notification_prefs FOR ALL TO authenticated USING (user_id = auth.uid());
CREATE POLICY np_svc ON public.notification_prefs FOR ALL TO service_role USING (true);
