-- ════════════════════════════════════════════════════════════════════════
-- LEAD-FLOW AUTOMATIONS — keep the funnel moving while focus is recruiting
--
-- Triggers:
--   trg_new_app_notify        — Discord + auto-SMS on every new application
--   trg_referral_ask          — nudges team to ask for referrals on 3rd/5th/10th deal
--
-- Crons:
--   speed-to-lead-monitor     every 15 min (11-23 UTC = 6am-6pm CST) — pings apps >30m uncalled
--   reactivate-day3-sms       daily 11 AM CST — day-3 no_pickup SMS nudge
--   reactivate-day7-sms       daily 12:30 PM CST — day-7 final follow-up SMS
--   revive-dead-leads-monthly 15th of month — one-shot revival SMS to 90d+ rejected
--   client-birthday-wisher    daily 9 AM CST — auto-text clients on their birthday
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_new_app_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_wa text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  SELECT value INTO v_wa      FROM public.system_settings WHERE key='whatsapp_group_link';

  IF v_webhook IS NOT NULL THEN
    v_body := jsonb_build_object('username','APEX Recruit',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('🆕 NEW APPLICATION — %s %s', NEW.first_name, NEW.last_name),
        'description', format(
          E'**%s**, %s · %s\n📞 %s\n📧 %s\n💼 Experience: %s\n🎯 Desired income: %s\n\n**Call within 5 minutes to 2× conversion.**',
          NEW.first_name || ' ' || NEW.last_name,
          COALESCE(NEW.city,'') || CASE WHEN NEW.state IS NOT NULL THEN ', ' || NEW.state ELSE '' END,
          COALESCE(NEW.license_status,'license status unknown'),
          COALESCE(NEW.phone,'—'), COALESCE(NEW.email,'—'),
          COALESCE(NEW.years_experience::text || ' yrs','none'),
          COALESCE(NEW.desired_income,'—')),
        'color', 3447003, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'),
        'footer', jsonb_build_object('text', CASE WHEN v_wa IS NOT NULL THEN 'Share in WhatsApp: ' || v_wa ELSE 'https://apex-financial.org/dashboard/recruit' END))));
    PERFORM net.http_post(url := v_webhook,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := v_body, timeout_milliseconds := 10000);
  END IF;

  IF NEW.phone IS NOT NULL AND length(regexp_replace(NEW.phone,'\D','','g')) >= 10 THEN
    PERFORM public.queue_sms(NEW.phone,
      format('Hey %s — Sam at APEX here. Got your app, I''ll call within the hour. Reply STOP to opt out.',
        split_part(COALESCE(NEW.first_name,''),' ',1)));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_new_app_notify ON public.applications;
CREATE TRIGGER trg_new_app_notify AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_new_app_notify();

CREATE OR REPLACE FUNCTION public.check_speed_to_lead()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_body jsonb; v_list text; v_count int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('no_webhook',true); END IF;
  SELECT string_agg('• ' || first_name || ' ' || last_name || ' — ' ||
      (EXTRACT(EPOCH FROM (now() - created_at))/60)::int::text || 'm', E'\n' ORDER BY created_at),
      COUNT(*)::int INTO v_list, v_count
  FROM public.applications
  WHERE status = 'new' AND created_at < now() - interval '30 minutes'
    AND created_at > now() - interval '4 hours';
  IF v_count IS NULL OR v_count = 0 THEN RETURN jsonb_build_object('clean',true); END IF;
  v_body := jsonb_build_object('username','APEX Speed-to-Lead',
    'content', format(E'⏱️ **%s app%s uncalled for >30 min** — speed-to-lead drops 2× after an hour\n\n%s',
      v_count, CASE WHEN v_count = 1 THEN '' ELSE 's' END, v_list));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN jsonb_build_object('pinged', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.check_speed_to_lead() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='speed-to-lead-monitor') THEN
    PERFORM cron.unschedule('speed-to-lead-monitor'); END IF;
  PERFORM cron.schedule('speed-to-lead-monitor', '*/15 11-23 * * *',
    $j$ SELECT public.check_speed_to_lead(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.reactivate_nopickup_day3()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_count int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH targets AS (SELECT id, first_name, phone FROM public.applications
    WHERE status = 'no_pickup' AND updated_at BETWEEN now() - interval '4 days' AND now() - interval '3 days'
      AND phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10
      AND (notes IS NULL OR notes NOT LIKE '%day3_sms_sent%')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('Hey %s — APEX here. Tried reaching you about your application. Got 2 min tomorrow? Reply YES and we''ll call. Reply STOP to opt out.',
      split_part(COALESCE(first_name,''),' ',1)) FROM targets RETURNING id),
  tagged AS (UPDATE public.applications SET notes = COALESCE(notes,'') || E'\n[day3_sms_sent]', updated_at = now()
    WHERE id IN (SELECT id FROM targets) RETURNING id)
  SELECT COUNT(*)::int INTO v_count FROM tagged;
  RETURN jsonb_build_object('day3_sms_queued', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.reactivate_nopickup_day3() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='reactivate-day3-sms') THEN
    PERFORM cron.unschedule('reactivate-day3-sms'); END IF;
  PERFORM cron.schedule('reactivate-day3-sms', '0 16 * * *',
    $j$ SELECT public.reactivate_nopickup_day3(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.reactivate_nopickup_day7()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_count int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH targets AS (SELECT id, first_name, phone FROM public.applications
    WHERE status = 'no_pickup' AND updated_at BETWEEN now() - interval '8 days' AND now() - interval '7 days'
      AND phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10
      AND (notes IS NULL OR notes NOT LIKE '%day7_sms_sent%')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('%s, this is Sam at APEX. Last try — still interested in a financial career? Reply YES or STOP.',
      split_part(COALESCE(first_name,''),' ',1)) FROM targets RETURNING id),
  tagged AS (UPDATE public.applications SET notes = COALESCE(notes,'') || E'\n[day7_sms_sent]', updated_at = now()
    WHERE id IN (SELECT id FROM targets) RETURNING id)
  SELECT COUNT(*)::int INTO v_count FROM tagged;
  RETURN jsonb_build_object('day7_sms_queued', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.reactivate_nopickup_day7() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='reactivate-day7-sms') THEN
    PERFORM cron.unschedule('reactivate-day7-sms'); END IF;
  PERFORM cron.schedule('reactivate-day7-sms', '30 17 * * *',
    $j$ SELECT public.reactivate_nopickup_day7(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.revive_dead_leads()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_count int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH targets AS (SELECT id, first_name, phone FROM public.applications
    WHERE status = 'rejected' AND updated_at < now() - interval '90 days'
      AND phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10
      AND (notes IS NULL OR notes NOT LIKE '%revival_sent%')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('%s — APEX is growing fast. If licensing is now an option, reply YES and we''ll reopen. Reply STOP to opt out forever.',
      split_part(COALESCE(first_name,''),' ',1)) FROM targets RETURNING id),
  tagged AS (UPDATE public.applications SET notes = COALESCE(notes,'') || E'\n[revival_sent ' || now()::date::text || ']'
    WHERE id IN (SELECT id FROM targets) RETURNING id)
  SELECT COUNT(*)::int INTO v_count FROM tagged;
  RETURN jsonb_build_object('revived', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.revive_dead_leads() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='revive-dead-leads-monthly') THEN
    PERFORM cron.unschedule('revive-dead-leads-monthly'); END IF;
  PERFORM cron.schedule('revive-dead-leads-monthly', '0 18 15 * *',
    $j$ SELECT public.revive_dead_leads(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.client_birthday_wisher()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_count int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH targets AS (SELECT DISTINCT d.client_phone AS phone, d.client_first_name AS first_name
    FROM public.deals d
    WHERE d.client_dob IS NOT NULL AND d.client_phone IS NOT NULL AND d.client_phone <> 'UNKNOWN'
      AND length(regexp_replace(d.client_phone,'\D','','g')) >= 10
      AND EXTRACT(MONTH FROM d.client_dob) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(DAY FROM d.client_dob) = EXTRACT(DAY FROM CURRENT_DATE)),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('Happy Birthday %s! 🎂 The APEX team is thinking of you today. Enjoy your day!',
      split_part(COALESCE(first_name,''),' ',1)) FROM targets RETURNING id)
  SELECT COUNT(*)::int INTO v_count FROM queued;
  RETURN jsonb_build_object('birthday_messages', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.client_birthday_wisher() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='client-birthday-wisher') THEN
    PERFORM cron.unschedule('client-birthday-wisher'); END IF;
  PERFORM cron.schedule('client-birthday-wisher', '0 14 * * *',
    $j$ SELECT public.client_birthday_wisher(); $j$);
END $outer$;

CREATE OR REPLACE FUNCTION public.trg_fn_referral_ask()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_agent_name text; v_count int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_count FROM public.deals WHERE agent_id = NEW.agent_id;
  IF v_count NOT IN (3, 5, 10) THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX',
    'content', format(E'🌱 **%s just wrote their %sth deal!** Perfect moment to ask them:\n\n*"Who do you know that should be doing this with us?"*\n\nReferrals from producers are 3× our best hire source.',
      COALESCE(v_agent_name,'An agent'), v_count));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_referral_ask ON public.deals;
CREATE TRIGGER trg_referral_ask AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_referral_ask();
