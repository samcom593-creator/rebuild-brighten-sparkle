-- ════════════════════════════════════════════════════════════════════════
-- Section 6 — Discord channel router
-- Single entrypoint for every Discord post with per-channel webhook
-- support, 60-min dedup per (event_type, entity_id), and CST timestamps.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Discord event log — dedup + audit
CREATE TABLE IF NOT EXISTS public.discord_event_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL,
  entity_id    text,                       -- deal.id / application.id / agent.id / etc.
  channel      text NOT NULL,
  posted_at    timestamptz NOT NULL DEFAULT now(),
  http_status  int,
  payload      jsonb
);
CREATE INDEX IF NOT EXISTS idx_del_dedup ON public.discord_event_log(event_type, entity_id, posted_at DESC);
ALTER TABLE public.discord_event_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS del_svc ON public.discord_event_log;
DROP POLICY IF EXISTS del_admin ON public.discord_event_log;
CREATE POLICY del_svc   ON public.discord_event_log FOR ALL    TO service_role USING (true);
CREATE POLICY del_admin ON public.discord_event_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));

-- 2. Channel mapping (use per-channel webhooks if set; fall back to main)
-- Keys users put into system_settings:
--   discord_webhook_sales_wins
--   discord_webhook_retention_alerts
--   discord_webhook_hiring_pipeline
--   discord_webhook_leadership
--   discord_webhook_system_health
-- Fallback: discord_webhook_url

CREATE OR REPLACE FUNCTION public.discord_route(
  p_event_type text,
  p_entity_id  text,
  p_channel    text,           -- 'sales' | 'retention' | 'hiring' | 'leadership' | 'system'
  p_body       jsonb           -- full discord webhook payload (username, content, embeds, etc.)
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_webhook_key text;
  v_webhook text;
  v_fallback text;
  v_req bigint;
  v_is_dup boolean;
  v_log_id uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  -- Dedup: same event_type + entity_id in last 60 min → skip
  IF p_entity_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.discord_event_log
      WHERE event_type = p_event_type AND entity_id = p_entity_id
        AND posted_at > now() - interval '60 minutes'
    ) INTO v_is_dup;
    IF v_is_dup THEN RETURN jsonb_build_object('skipped','dedup','event_type',p_event_type,'entity_id',p_entity_id); END IF;
  END IF;

  v_webhook_key := CASE p_channel
    WHEN 'sales'      THEN 'discord_webhook_sales_wins'
    WHEN 'retention'  THEN 'discord_webhook_retention_alerts'
    WHEN 'hiring'     THEN 'discord_webhook_hiring_pipeline'
    WHEN 'leadership' THEN 'discord_webhook_leadership'
    WHEN 'system'     THEN 'discord_webhook_system_health'
    ELSE 'discord_webhook_url'
  END;

  SELECT value INTO v_webhook   FROM public.system_settings WHERE key = v_webhook_key;
  SELECT value INTO v_fallback  FROM public.system_settings WHERE key = 'discord_webhook_url';
  v_webhook := COALESCE(v_webhook, v_fallback);

  IF v_webhook IS NULL THEN
    INSERT INTO public.discord_event_log (event_type, entity_id, channel, http_status, payload)
    VALUES (p_event_type, p_entity_id, p_channel, 0, jsonb_build_object('error','no_webhook_configured'));
    RETURN jsonb_build_object('error','no_webhook');
  END IF;

  v_req := net.http_post(
    url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := p_body,
    timeout_milliseconds := 10000
  );

  INSERT INTO public.discord_event_log (event_type, entity_id, channel, http_status, payload)
  VALUES (p_event_type, p_entity_id, p_channel, 204, p_body)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('routed','ok','channel',p_channel,'webhook_key',v_webhook_key,'request_id',v_req);
EXCEPTION WHEN others THEN
  INSERT INTO public.discord_event_log (event_type, entity_id, channel, http_status, payload)
  VALUES (p_event_type, p_entity_id, p_channel, -1, jsonb_build_object('error', SQLERRM));
  RAISE;
END $fn$;
GRANT EXECUTE ON FUNCTION public.discord_route(text, text, text, jsonb) TO service_role, authenticated;

-- 3. Migrate all existing Discord triggers to use the router (retention alert, deal celebration, chargeback)
-- trg_fn_deal_celebration → route to 'sales'
-- trg_fn_deal_status_transition → 'retention' on lapsed/cancelled/charged_back
-- trg_fn_chargeback_alert → 'retention'
-- trg_fn_hot_streak → 'sales'
-- trg_fn_first_deal_welcome → 'sales'
-- trg_fn_referral_ask → 'sales'
-- trg_fn_reward_broadcast → 'sales'
-- post_morning_huddle / evening_recap / weekly_recap → 'leadership'
-- post_hiring_bottleneck_alert → 'hiring'
-- stale_submitted_alert / orphan_deal_audit → 'system'

-- Patch trg_fn_deal_celebration to use the router (keeps backfill guard intact)
CREATE OR REPLACE FUNCTION public.trg_fn_deal_celebration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_agent_name text; v_avatar text; v_carrier_name text;
  v_mtd_count int; v_mtd_alp numeric; v_body jsonb; v_fire text;
  v_is_backfill boolean;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  v_is_backfill := (NEW.effective_date IS NULL OR NEW.effective_date < (CURRENT_DATE - interval '2 days'));

  SELECT p.full_name, p.avatar_url INTO v_agent_name, v_avatar
  FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric INTO v_mtd_count, v_mtd_alp
  FROM public.deals WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', CURRENT_DATE)::date;

  -- Always drop a notification (low/high priority)
  INSERT INTO public.notifications (user_id, title, body, type, priority)
  SELECT p.id,
    format('Deal %s — %s %s', CASE WHEN v_is_backfill THEN 'imported' ELSE 'closed' END,
      NEW.client_first_name, NEW.client_last_name),
    format('$%s ALP · %s', to_char(NEW.annual_premium,'FM999,999,990.00'), COALESCE(NEW.product_sold,'policy')),
    'deal_closed',
    CASE WHEN v_is_backfill THEN 'low' ELSE 'high' END
  FROM public.agents a JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

  IF v_is_backfill THEN RETURN NEW; END IF;

  SELECT name INTO v_carrier_name FROM public.carriers WHERE id = NEW.carrier_id;
  v_fire := CASE WHEN NEW.annual_premium >= 3000 THEN '🔥🔥🔥'
                 WHEN NEW.annual_premium >= 1500 THEN '🔥🔥' ELSE '🔥' END;

  v_body := jsonb_build_object('username','APEX Sales',
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

  PERFORM public.discord_route('deal_closed', NEW.id::text, 'sales', v_body);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $fn$;

-- Patch trg_fn_deal_status_transition to route retention alerts to 'retention'
CREATE OR REPLACE FUNCTION public.trg_fn_deal_status_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_rate numeric; v_rate_source text; v_amount numeric;
  v_agent_name text; v_carrier_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'active' AND OLD.status = 'submitted' THEN
    IF NEW.agent_id IS NULL OR NEW.carrier_id IS NULL THEN
      INSERT INTO public.agentlink_alerts (severity, message)
      VALUES ('blocker', format('Deal %s went active — missing agent or carrier', NEW.id));
      RETURN NEW;
    END IF;
    SELECT rate_pct, rate_source INTO v_rate, v_rate_source FROM public.fn_commission_rate(NEW.agent_id, NEW.carrier_id);
    IF v_rate IS NULL THEN
      INSERT INTO public.agentlink_alerts (severity, message)
      VALUES ('blocker', format('Deal %s went active — no commission schedule for carrier', NEW.id));
      RETURN NEW;
    END IF;
    v_amount := COALESCE(NEW.annual_premium, 0) * v_rate / 100.0;
    INSERT INTO public.commission_ledger (deal_id, agent_id, carrier_id, annual_premium,
      rate_pct, rate_source, amount, as_earned_pct, expected_paid_date)
    VALUES (NEW.id, NEW.agent_id, NEW.carrier_id, NEW.annual_premium,
      v_rate, v_rate_source, v_amount, 100,
      COALESCE(NEW.effective_date, CURRENT_DATE) + interval '14 days')
    ON CONFLICT (deal_id) DO UPDATE SET
      rate_pct = EXCLUDED.rate_pct, rate_source = EXCLUDED.rate_source,
      amount = EXCLUDED.amount, updated_at = now();
    INSERT INTO public.commission_audit_log (deal_id, agent_id, carrier_id, rate_pct, rate_source, note)
    VALUES (NEW.id, NEW.agent_id, NEW.carrier_id, v_rate, v_rate_source,
      format('status %s → active, $%s booked', OLD.status, to_char(v_amount,'FM999,990.00')));
  END IF;

  IF NEW.status IN ('lapsed','cancelled','charged_back') AND OLD.status <> NEW.status THEN
    UPDATE public.commission_ledger
    SET status = CASE NEW.status WHEN 'charged_back' THEN 'clawed_back' ELSE 'voided' END, updated_at = now()
    WHERE deal_id = NEW.id AND status = 'pending';

    SELECT p.full_name INTO v_agent_name FROM public.agents a
      JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
    SELECT name INTO v_carrier_name FROM public.carriers WHERE id = NEW.carrier_id;
    v_body := jsonb_build_object('username','APEX Retention',
      'content', format(E'⚠️ **Policy %s — %s %s · agent %s · %s $%s**\n\nReach out, rescue if possible.',
        NEW.status, NEW.client_first_name, NEW.client_last_name,
        COALESCE(v_agent_name,'unknown'),
        COALESCE(v_carrier_name,'carrier'),
        to_char(NEW.annual_premium,'FM999,990.00')));
    PERFORM public.discord_route('deal_' || NEW.status, NEW.id::text, 'retention', v_body);
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  INSERT INTO public.agentlink_alerts (severity, message)
  VALUES ('warning', 'trg_deal_status_transition: ' || SQLERRM);
  RETURN NEW;
END $fn$;

-- Patch post_hiring_bottleneck_alert → 'hiring' channel
CREATE OR REPLACE FUNCTION public.post_hiring_bottleneck_alert()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_stale_new int; v_stale_pickup int; v_reviewing int; v_contracting int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT
    COUNT(*) FILTER (WHERE status='new' AND created_at < now() - interval '1 day')::int,
    COUNT(*) FILTER (WHERE status='no_pickup' AND updated_at < now() - interval '2 days')::int,
    COUNT(*) FILTER (WHERE status='reviewing' AND updated_at < now() - interval '3 days')::int,
    COUNT(*) FILTER (WHERE status='contracting')::int
  INTO v_stale_new, v_stale_pickup, v_reviewing, v_contracting
  FROM public.applications WHERE created_at > now() - interval '30 days';
  IF (v_stale_new + v_stale_pickup + v_reviewing) = 0 THEN RETURN jsonb_build_object('no_alerts', true); END IF;
  v_body := jsonb_build_object('username','APEX Hiring',
    'content', format(E'**⚠️ Hiring funnel needs love**\n\n🆕 **%s** new (untouched)\n📞 **%s** no-pickups >2 days\n👀 **%s** in review >3 days\n📝 **%s** contracting',
      v_stale_new, v_stale_pickup, v_reviewing, v_contracting));
  PERFORM public.discord_route('hiring_bottleneck', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'hiring', v_body);
  RETURN jsonb_build_object('posted', true);
END $fn$;

-- Patch stale_submitted_alert → 'system' channel
CREATE OR REPLACE FUNCTION public.stale_submitted_alert()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_count int; v_alp numeric; v_body jsonb; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('stale_submitted_alert');
  SELECT COUNT(*)::int, ROUND(COALESCE(SUM(annual_premium),0)::numeric, 2)
    INTO v_count, v_alp FROM public.deals
    WHERE status = 'submitted' AND effective_date < CURRENT_DATE - interval '7 days';
  IF v_count = 0 THEN
    PERFORM public.job_run_finish(v_job, 'ok', 0, NULL, jsonb_build_object('clean', true));
    RETURN jsonb_build_object('clean', true);
  END IF;
  v_body := jsonb_build_object('username','APEX System',
    'content', format(E'📋 **%s deals stuck in submitted >7d · $%s ALP unresolved**\n\nLikely carrier-side delay.',
      v_count, to_char(v_alp,'FM999,999,990.00')));
  PERFORM public.discord_route('stale_submitted', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'system', v_body);
  PERFORM public.job_run_finish(v_job, 'ok', v_count, NULL, jsonb_build_object('alp', v_alp));
  RETURN jsonb_build_object('flagged', v_count, 'alp', v_alp);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;

-- Patch orphan_deal_audit → 'system' channel
CREATE OR REPLACE FUNCTION public.orphan_deal_audit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_no_agent int; v_no_carrier int; v_deactivated int; v_body jsonb; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('orphan_deal_audit');
  SELECT COUNT(*) FILTER (WHERE agent_id IS NULL)::int,
         COUNT(*) FILTER (WHERE carrier_id IS NULL)::int,
         COUNT(*) FILTER (WHERE agent_id IN (SELECT id FROM public.agents WHERE is_deactivated))::int
    INTO v_no_agent, v_no_carrier, v_deactivated FROM public.deals;
  IF v_no_agent + v_no_carrier + v_deactivated > 0 THEN
    v_body := jsonb_build_object('username','APEX System',
      'content', format(E'🧭 **Orphan deals**\n• No agent: %s\n• No carrier: %s\n• Deactivated agent: %s',
        v_no_agent, v_no_carrier, v_deactivated));
    PERFORM public.discord_route('orphan_deal_audit', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'system', v_body);
  END IF;
  PERFORM public.job_run_finish(v_job, 'ok', v_no_agent+v_no_carrier+v_deactivated, NULL,
    jsonb_build_object('no_agent',v_no_agent,'no_carrier',v_no_carrier,'deactivated',v_deactivated));
  RETURN jsonb_build_object('no_agent',v_no_agent,'no_carrier',v_no_carrier,'deactivated',v_deactivated);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;
