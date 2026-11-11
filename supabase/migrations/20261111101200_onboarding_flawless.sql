-- onboarding-flawless (2026-11-10): the last reviewer findings from the WP1-WP8 build.
--
-- 1) Routing order. trg_assign_recruiting_owner (BEFORE INSERT) sorted before
--    trg_reconcile_licensing_vocabularies, so an applicant inserted with license_progress
--    'licensed' but an unreconciled license_status was routed as unlicensed - now to Aisha
--    instead of Sam. Renamed z_assign_recruiting_owner so it runs after reconciliation
--    (BEFORE triggers fire in name order; z_default_application_manager_to_sam still runs last).
-- 2) Four uncalled functions (no trigger, no cron, no anon/authenticated EXECUTE) still posted
--    to system_settings.discord_webhook_url without reading the Discord kill switch. Each post
--    is now wrapped in IF NOT fn_discord_paused(); the rest of each body is unchanged.
-- 3) trg_fn_agent_new_hire_flow swallowed failures silently; it now raises a WARNING.

do $do$ begin
  if exists (select 1 from pg_trigger where tgname = 'trg_assign_recruiting_owner' and tgrelid = 'public.applications'::regclass) then
    alter trigger trg_assign_recruiting_owner on public.applications rename to z_assign_recruiting_owner;
  end if;
end $do$;

-- detect_milestone_verge: 1 Discord post(s) now gated on fn_discord_paused(); nothing calls this today.
CREATE OR REPLACE FUNCTION public.detect_milestone_verge()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_webhook text;
  v_fired int := 0;
  v_msg text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  -- Agents within striking distance of a weekly $10k ALP threshold.
  -- "Striking distance" = $7500–$9999 so they know they can push.
  FOR r IN
    WITH wk AS (
      SELECT d.agent_id, SUM(d.annual_premium) AS wk_alp, COUNT(*) AS wk_deals
      FROM public.deals d
      WHERE d.effective_date >= date_trunc('week', CURRENT_DATE)::date
      GROUP BY d.agent_id
    )
    SELECT a.id, p.full_name, wk.wk_alp, wk.wk_deals,
           COALESCE(p.avatar_url,'') AS avatar_url
    FROM wk
    JOIN public.agents a ON a.id = wk.agent_id
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE wk.wk_alp BETWEEN 7500 AND 9999
      AND NOT EXISTS (
        -- Don't double-fire within the same week for the same agent
        SELECT 1 FROM public.bot_alerts ba
        WHERE ba.event_type = 'milestone_verge_10k_week'
          AND ba.subject LIKE '%' || p.full_name || '%'
          AND ba.created_at > date_trunc('week', CURRENT_DATE)
      )
  LOOP
    v_msg := format(
      E'🔥 **%s** is within **$%s** of the $10,000 ALP week — current: **$%s** from %s deals. Go get it.',
      r.full_name,
      to_char(10000 - r.wk_alp, 'FM999,999'),
      to_char(r.wk_alp, 'FM999,999'),
      r.wk_deals);

    IF NOT public.fn_discord_paused() THEN PERFORM net.http_post(
      url := v_webhook,
      body := jsonb_build_object(
        'username', 'APEX Verge Alert',
        'content', v_msg,
        'embeds', jsonb_build_array(jsonb_build_object(
          'color', 16753920,  -- orange
          'thumbnail', jsonb_build_object('url', r.avatar_url)
        ))),
      headers := jsonb_build_object('Content-Type','application/json')); END IF;

    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, channels)
    VALUES ('automation','milestone_verge_10k_week','celebrate',
            format('%s close to $10k ALP week', r.full_name), v_msg, ARRAY['discord']);

    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object('verge_alerts_fired', v_fired);
END;
$function$;

-- orphan_deal_audit: 1 Discord post(s) now gated on fn_discord_paused(); nothing calls this today.
CREATE OR REPLACE FUNCTION public.orphan_deal_audit()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE v_no_agent int; v_no_carrier int; v_deactivated int; v_webhook text; v_body jsonb; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('orphan_deal_audit');
  SELECT COUNT(*) FILTER (WHERE agent_id IS NULL)::int,
         COUNT(*) FILTER (WHERE carrier_id IS NULL)::int,
         COUNT(*) FILTER (WHERE agent_id IN (SELECT id FROM public.agents WHERE is_deactivated))::int
    INTO v_no_agent, v_no_carrier, v_deactivated FROM public.deals;

  IF v_no_agent + v_no_carrier + v_deactivated > 0 THEN
    SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
    IF v_webhook IS NOT NULL THEN
      v_body := jsonb_build_object('username','APEX Orphan Audit',
        'content', format(E'🧭 **Orphan deals found**\n• No agent: %s\n• No carrier: %s\n• Deactivated agent: %s',
          v_no_agent, v_no_carrier, v_deactivated));
      IF NOT public.fn_discord_paused() THEN PERFORM net.http_post(url := v_webhook,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := v_body, timeout_milliseconds := 10000); END IF;
    END IF;
  END IF;

  PERFORM public.job_run_finish(v_job, 'ok', v_no_agent+v_no_carrier+v_deactivated, NULL,
    jsonb_build_object('no_agent',v_no_agent,'no_carrier',v_no_carrier,'deactivated',v_deactivated));
  RETURN jsonb_build_object('no_agent',v_no_agent,'no_carrier',v_no_carrier,'deactivated',v_deactivated);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $function$;

-- stale_submitted_alert: 1 Discord post(s) now gated on fn_discord_paused(); nothing calls this today.
CREATE OR REPLACE FUNCTION public.stale_submitted_alert()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE v_webhook text; v_count int; v_alp numeric; v_body jsonb; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('stale_submitted_alert');
  SELECT COUNT(*)::int, ROUND(COALESCE(SUM(annual_premium),0)::numeric, 2)
    INTO v_count, v_alp
  FROM public.deals
  WHERE status = 'submitted' AND effective_date < CURRENT_DATE - interval '7 days';

  IF v_count = 0 THEN
    PERFORM public.job_run_finish(v_job, 'ok', 0, NULL, jsonb_build_object('clean', true));
    RETURN jsonb_build_object('clean', true);
  END IF;

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NOT NULL THEN
    v_body := jsonb_build_object('username','APEX Stale Book',
      'content', format(E'📋 **%s deals stuck in submitted >7d · $%s ALP unresolved**\n\nMost likely carrier-side delay — cross-check top carriers for status updates.',
        v_count, to_char(v_alp,'FM999,999,990.00')));
    IF NOT public.fn_discord_paused() THEN PERFORM net.http_post(url := v_webhook,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := v_body, timeout_milliseconds := 10000); END IF;
  END IF;

  PERFORM public.job_run_finish(v_job, 'ok', v_count, NULL, jsonb_build_object('alp', v_alp));
  RETURN jsonb_build_object('flagged', v_count, 'alp', v_alp);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $function$;

-- trg_fn_agentlink_book_announce: 1 Discord post(s) now gated on fn_discord_paused(); nothing calls this today.
CREATE OR REPLACE FUNCTION public.trg_fn_agentlink_book_announce()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_webhook text;
  v_channel text;
  v_agency text;
  v_is_vantage boolean := false;
  v_recent int;
  v_body jsonb;
  v_name text;
BEGIN
  IF NEW.deal_key IS NULL OR NEW.annual_premium IS NULL THEN RETURN NEW; END IF;
  IF NEW.is_dead IS TRUE THEN RETURN NEW; END IF;
  IF public.fn_agent_is_roster_excluded(NEW.agent_id) THEN RETURN NEW; END IF;

  -- guard 2: only genuinely recent business speaks
  IF NEW.posted_date IS NULL OR NEW.posted_date < v_today - 3 THEN
    INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
    VALUES (NEW.deal_key, 'skipped_stale', false) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- guard 1: never announce the same deal twice, however often the sync reruns
  IF EXISTS (SELECT 1 FROM public.agentlink_book_announced a WHERE a.deal_key = NEW.deal_key) THEN
    RETURN NEW;
  END IF;

  -- guard 3: a burst is an import, not a sales day
  SELECT count(*) INTO v_recent
  FROM public.agentlink_book_announced
  WHERE announced_at > now() - interval '2 minutes' AND posted;
  IF v_recent >= 25 THEN
    INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
    VALUES (NEW.deal_key, 'skipped_burst', false) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Vantage (KJ's leg) announces in its own channel; everyone else in the main
  -- one. Never falls back between channels — a deal posted to the wrong team's
  -- room is worse than one that waits for a fix.
  SELECT (a.agent_code = 'KJV01' OR mgr.agent_code = 'KJV01')
    INTO v_is_vantage
  FROM public.agents a
  LEFT JOIN public.agents mgr ON mgr.id = a.manager_id
  WHERE a.id = NEW.agent_id;
  v_is_vantage := coalesce(v_is_vantage, false);

  IF v_is_vantage THEN
    v_channel := 'subagency_deals'; v_agency := 'Vantage Financial';
    SELECT value INTO v_webhook FROM public.system_settings WHERE key = 'discord_webhook_url_subagency_deals';
  ELSE
    v_channel := 'main'; v_agency := 'APEX Financial';
    SELECT value INTO v_webhook FROM public.system_settings WHERE key = 'discord_webhook_url';
  END IF;
  IF v_webhook IS NULL OR v_webhook NOT LIKE 'https://discord.com/api/webhooks/%' THEN RETURN NEW; END IF;

  v_name := coalesce(nullif(btrim(NEW.agent_name), ''), 'Agent');

  -- Producer in the title, never the client. Publishing a life-insurance
  -- customer's name into a chat channel is the a71e321c defect; it stays fixed.
  v_body := jsonb_build_object('embeds', jsonb_build_array(jsonb_build_object(
    'title', format('✅ DEAL POSTED — %s', v_name),
    'color', 13210919,
    'fields', jsonb_build_array(
      jsonb_build_object('name','Annual premium','value','$' || to_char(NEW.annual_premium,'FM999,999,990.00'),'inline',true),
      jsonb_build_object('name','Carrier','value',coalesce(NEW.carrier,'N/A'),'inline',true),
      jsonb_build_object('name','Agency','value',v_agency,'inline',true)),
    'footer', jsonb_build_object('text','APEX Financial · via AgentLink'),
    'timestamp', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));

  IF NOT public.fn_discord_paused() THEN PERFORM net.http_post(url := v_webhook, body := v_body,
                        headers := jsonb_build_object('Content-Type','application/json')); END IF;

  INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
  VALUES (NEW.deal_key, v_channel, true) ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- An announcement must never be able to break the sync that feeds production.
  BEGIN
    INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
    VALUES (NEW.deal_key, 'error:' || left(SQLERRM, 80), false) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN NEW;
END;
$function$;

-- trg_fn_agent_new_hire_flow: a failure now leaves a WARNING instead of vanishing.
CREATE OR REPLACE FUNCTION public.trg_fn_agent_new_hire_flow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  -- WP5: only the move INTO in_field_training, only once (production_unlocked_at is the edge function's claim), and only
  -- while Sam has switched the flow on (system_settings.new_hire_live_flow_enabled='true'; shipped 'false' until he
  -- approves the copy). The contracted_at branch is gone: contracting is not "You're Live". Payload key is agentId,
  -- which is what the edge function reads (it sent agent_id since April and every run 404'd).
  if old.onboarding_stage is distinct from new.onboarding_stage
     and new.onboarding_stage = 'in_field_training'
     and new.production_unlocked_at is null
     and coalesce((select s.value from public.system_settings s where s.key = 'new_hire_live_flow_enabled'), 'false') = 'true' then
    perform public.run_automation_job(
      'trigger-new-hire-flow',
      'trigger-new-hire-flow',
      jsonb_build_object('agentId', new.id, 'triggerType', 'stage_in_field_training')
    );
  end if;
  return new;
exception when others then
  raise warning 'trg_fn_agent_new_hire_flow failed for agent %: %', NEW.id, SQLERRM;
  return new;
end;
$function$;
