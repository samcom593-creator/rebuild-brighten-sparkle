-- ════════════════════════════════════════════════════════════════════════
-- AGENCY LAYER — onboarding drip · slump detection · hot streak · licensing
--                nudges · data-quality audit · chargeback alerts
--
-- 4 new cron jobs + 2 new triggers that run the operation.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_agents_metadata ON public.agents USING gin(metadata);

-- ── Onboarding drip (Day 0/1/3/7/14/30) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.onboarding_drip()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_d0 int:=0; v_d1 int:=0; v_d3 int:=0; v_d7 int:=0; v_d14 int:=0; v_d30 int:=0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH new_hires AS (
    SELECT a.id, p.full_name, p.phone FROM public.agents a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.created_at::date = CURRENT_DATE AND NOT a.is_deactivated
      AND (a.metadata IS NULL OR NOT a.metadata ? 'onboard_d0')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('Welcome to APEX, %s! 🎉 Your login email was sent. Join our Discord for deal fires + daily huddle. Any Qs text me back.',
      split_part(full_name,' ',1)) FROM new_hires
    WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10 RETURNING id),
  tagged AS (UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('onboard_d0', now())
    WHERE id IN (SELECT id FROM new_hires) RETURNING id)
  SELECT COUNT(*)::int INTO v_d0 FROM tagged;

  WITH need_d1 AS (SELECT a.id, p.phone, p.full_name FROM public.agents a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.created_at::date = (CURRENT_DATE - 1) AND NOT a.is_deactivated
      AND (a.metadata IS NULL OR NOT a.metadata ? 'onboard_d1')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('Hey %s — 24 hours in. Have you logged into apex-financial.org and Agent Link yet? Reply with any blockers.',
      split_part(full_name,' ',1)) FROM need_d1
    WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10 RETURNING id),
  tagged AS (UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('onboard_d1', now())
    WHERE id IN (SELECT id FROM need_d1) RETURNING id)
  SELECT COUNT(*)::int INTO v_d1 FROM tagged;

  WITH need_d3 AS (SELECT a.id, p.phone, p.full_name FROM public.agents a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.created_at::date = (CURRENT_DATE - 3) AND NOT a.is_deactivated
      AND (a.metadata IS NULL OR NOT a.metadata ? 'onboard_d3')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('%s — day 3. Start the onboarding course: apex-financial.org/dashboard/getting-started. Reply when you''re done with module 1.',
      split_part(full_name,' ',1)) FROM need_d3
    WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10 RETURNING id),
  tagged AS (UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('onboard_d3', now())
    WHERE id IN (SELECT id FROM need_d3) RETURNING id)
  SELECT COUNT(*)::int INTO v_d3 FROM tagged;

  WITH need_d7 AS (SELECT a.id, p.phone, p.full_name FROM public.agents a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.created_at::date = (CURRENT_DATE - 7) AND NOT a.is_deactivated
      AND (a.metadata IS NULL OR NOT a.metadata ? 'onboard_d7')),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('Week 1 check-in, %s. How many dials today? First call is always the hardest. Reply YES for a 10-min power session.',
      split_part(full_name,' ',1)) FROM need_d7
    WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10 RETURNING id),
  tagged AS (UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('onboard_d7', now())
    WHERE id IN (SELECT id FROM need_d7) RETURNING id)
  SELECT COUNT(*)::int INTO v_d7 FROM tagged;

  WITH need_d14 AS (SELECT a.id FROM public.agents a
    WHERE a.created_at::date = (CURRENT_DATE - 14) AND NOT a.is_deactivated
      AND (a.metadata IS NULL OR NOT a.metadata ? 'onboard_d14')
      AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.agent_id = a.id))
  UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('onboard_d14', now(), 'd14_no_deal', true)
  WHERE id IN (SELECT id FROM need_d14);
  GET DIAGNOSTICS v_d14 = ROW_COUNT;

  WITH need_d30 AS (SELECT a.id FROM public.agents a
    WHERE a.created_at::date = (CURRENT_DATE - 30) AND NOT a.is_deactivated
      AND (a.metadata IS NULL OR NOT a.metadata ? 'onboard_d30'))
  UPDATE public.agents SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('onboard_d30', now())
  WHERE id IN (SELECT id FROM need_d30);
  GET DIAGNOSTICS v_d30 = ROW_COUNT;
  RETURN jsonb_build_object('d0',v_d0,'d1',v_d1,'d3',v_d3,'d7',v_d7,'d14',v_d14,'d30',v_d30);
END $fn$;
GRANT EXECUTE ON FUNCTION public.onboarding_drip() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='onboarding-drip') THEN
    PERFORM cron.unschedule('onboarding-drip'); END IF;
  PERFORM cron.schedule('onboarding-drip', '30 15 * * *',
    $j$ SELECT public.onboarding_drip(); $j$);
END $outer$;

-- ── Slumping producer detection ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_slumping_agents()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_body jsonb; v_list text; v_count int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('no_webhook',true); END IF;
  WITH active_producers AS (
    SELECT a.id, p.full_name,
      COUNT(d.id) FILTER (WHERE d.effective_date >= CURRENT_DATE - interval '90 days') AS deals_90d,
      MAX(d.effective_date) AS last_deal
    FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
    LEFT JOIN public.deals d ON d.agent_id = a.id
    WHERE NOT a.is_deactivated GROUP BY a.id, p.full_name)
  SELECT string_agg('• ' || full_name || ' — ' || deals_90d || ' deals in 90d, last on ' ||
    COALESCE(last_deal::text,'never'), E'\n' ORDER BY deals_90d DESC), COUNT(*)::int
  INTO v_list, v_count FROM active_producers
  WHERE deals_90d >= 3 AND last_deal < CURRENT_DATE - interval '7 days';
  IF v_count IS NULL OR v_count = 0 THEN RETURN jsonb_build_object('no_slumps',true); END IF;
  v_body := jsonb_build_object('username','APEX Slump Alert',
    'content', format(E'🚧 **%s producer%s went quiet 7+ days** — 1:1 check-in time\n\n%s',
      v_count, CASE WHEN v_count=1 THEN '' ELSE 's' END, v_list));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN jsonb_build_object('flagged', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.detect_slumping_agents() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='detect-slumping-agents') THEN
    PERFORM cron.unschedule('detect-slumping-agents'); END IF;
  PERFORM cron.schedule('detect-slumping-agents', '0 15 * * 1',
    $j$ SELECT public.detect_slumping_agents(); $j$);
END $outer$;

-- ── Hot-streak amplifier (3 deals in 24h) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_hot_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_agent_name text; v_count_24h int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_count_24h FROM public.deals
  WHERE agent_id = NEW.agent_id AND created_at > now() - interval '24 hours';
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
DROP TRIGGER IF EXISTS trg_hot_streak ON public.deals;
CREATE TRIGGER trg_hot_streak AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_hot_streak();

-- ── Licensing weekly nudge ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nudge_unlicensed_applicants()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_count int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  WITH targets AS (SELECT id, first_name, phone FROM public.applications
    WHERE status IN ('contracting','reviewing','no_pickup')
      AND (license_status IS NULL OR license_status ILIKE '%unlicensed%' OR license_status ILIKE '%pending%' OR license_status ILIKE '%not%')
      AND phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10
      AND (notes IS NULL OR notes NOT LIKE ('%licensing_nudge_' || to_char(CURRENT_DATE,'IYYY-IW') || '%'))
      AND created_at > now() - interval '90 days'),
  queued AS (INSERT INTO public.sms_fallback_queue (phone, body)
    SELECT phone, format('%s — APEX here. Licensing is the ONLY thing between you and your first check. Free study guide + state exam links: apex-financial.org/get-licensed. Reply Q for questions.',
      split_part(COALESCE(first_name,''),' ',1)) FROM targets RETURNING id),
  tagged AS (UPDATE public.applications
    SET notes = COALESCE(notes,'') || E'\n[licensing_nudge_' || to_char(CURRENT_DATE,'IYYY-IW') || ']'
    WHERE id IN (SELECT id FROM targets) RETURNING id)
  SELECT COUNT(*)::int INTO v_count FROM tagged;
  RETURN jsonb_build_object('nudged', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.nudge_unlicensed_applicants() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='licensing-weekly-nudge') THEN
    PERFORM cron.unschedule('licensing-weekly-nudge'); END IF;
  PERFORM cron.schedule('licensing-weekly-nudge', '0 16 * * 2',
    $j$ SELECT public.nudge_unlicensed_applicants(); $j$);
END $outer$;

-- ── Data quality audit ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.data_quality_audit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_missing_phone int; v_missing_dob int;
  v_missing_carrier int; v_bad_premium int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT
    COUNT(*) FILTER (WHERE client_phone IS NULL OR client_phone='UNKNOWN')::int,
    COUNT(*) FILTER (WHERE client_dob IS NULL OR client_dob = '1970-01-01'::date)::int,
    COUNT(*) FILTER (WHERE carrier_id IS NULL)::int,
    COUNT(*) FILTER (WHERE annual_premium <= 0)::int
  INTO v_missing_phone, v_missing_dob, v_missing_carrier, v_bad_premium FROM public.deals;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('missing_phone',v_missing_phone,'missing_dob',v_missing_dob,
    'missing_carrier',v_missing_carrier,'bad_premium',v_bad_premium); END IF;
  IF v_missing_phone + v_missing_dob + v_missing_carrier + v_bad_premium = 0 THEN
    RETURN jsonb_build_object('all_clean',true); END IF;
  v_body := jsonb_build_object('username','APEX Data Quality',
    'content', format(E'📊 **Data quality snapshot**\n📞 Missing phone: %s\n🎂 Missing/placeholder DOB: %s\n🏷️ Missing carrier: %s\n💰 Zero premium: %s',
      v_missing_phone, v_missing_dob, v_missing_carrier, v_bad_premium));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN jsonb_build_object('reported', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.data_quality_audit() TO service_role, authenticated;
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='data-quality-audit') THEN
    PERFORM cron.unschedule('data-quality-audit'); END IF;
  PERFORM cron.schedule('data-quality-audit', '0 13 * * 1',
    $j$ SELECT public.data_quality_audit(); $j$);
END $outer$;

-- ── Chargeback alert trigger ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_chargeback_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'charged_back' THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;
  SELECT p.full_name INTO v_agent_name FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
  v_body := jsonb_build_object('username','APEX Chargeback',
    'content', format(E'⚠️ **Chargeback on %s %s** — agent: %s · $%s ALP · policy %s\n\nReach out, understand why, rescue if possible.',
      NEW.client_first_name, NEW.client_last_name, COALESCE(v_agent_name,'unknown'),
      to_char(NEW.annual_premium,'FM999,999,990.00'), NEW.policy_number));
  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 10000);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_chargeback_alert ON public.deals;
CREATE TRIGGER trg_chargeback_alert AFTER UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_chargeback_alert();
