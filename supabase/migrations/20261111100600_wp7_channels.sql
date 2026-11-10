-- WP7 (onboarding audit 2026-11-10): retire Discord safely, offboarding that
-- covers Slack, and a #unlicensed room that tells the truth.
--
-- RULE, for every future change to a webhook key: a Discord/Slack webhook is
-- RETIRED by deleting its system_settings row or by setting
-- discord_notifications_paused='true' (raw text). NEVER by writing '' or a
-- JSON-quoted string ("..."). pg_net THROWS on a malformed URL, and a trigger
-- without an EXCEPTION handler then rolls back the parent write: every Licensed
-- click (auto_kickoff_new_licensee) and every application insert. The house
-- pattern of '' for "off" (discord_webhook_url_subagency_* on 2026-10-26) is
-- exactly how that happens.
--
-- What this migration does (each step re-verified live before writing):
--   1. Kill switch row discord_notifications_paused='true' (raw text). The edge
--      resolver canPostToDiscord() and 6 SQL readers already honour it; only
--      the row was missing. public.fn_discord_paused() is a READER of that same
--      key (no second switch).
--   2. Drops the PII-capable posters: trg_new_app_notify (raised on every insert
--      because of an enum/numeric COALESCE; "fixing" the types would post
--      applicant phone+email), trg_application_discord (name + IG handle under a
--      false "No personal information shared" footer), fn_alert_licensed_applicant
--      and two unattached applications_trigger_*_discord functions (phone+email),
--      plus 5 uncalled huddle/recap posters. Zero callers asserted below.
--   3. auto_kickoff_new_licensee: Discord block removed, EXCEPTION guard added.
--   4. Remaining direct pg_net posters gated on the switch.
--   5. One BEFORE INSERT guard on outbox_events skips discord/discord_subagency
--      rows while paused. It covers all 7 enqueuers (fn_notify_agent_hired,
--      fn_queue_external_deal_channels, trg_fn_agentlink_book_queue_discord,
--      fn_queue_licensing_milestone_slack, fn_sweep_recruiting_milestones,
--      transition_apex_deal_status, trg_fn_deal_celebration) without redefining
--      any of them, so every Slack leg stays byte-identical by construction.
--      Same pattern as trg_block_retired_cloud_outbox (insuracloud).
--   6. Terminal outbox statuses cancelled_retired / skipped_destination_dead.
--   7. Offboarding: Slack joins the deprovision legs; the Discord leg is closed
--      as not_actionable_no_bot while the row stays open for Slack/WhatsApp.
--   8. Slack: own-row "I've joined Slack" signal, roadmap stops gating on Slack,
--      email_lookup identity links (scope-gated), digest rewrite, guard view.
--
-- Applied live by WP7 (MCP execute_sql), then recorded in
-- supabase_migrations.schema_migrations. Idempotent throughout.

-- ============================================================================
-- PREIMAGES of every function this migration DROPS (verbatim pg_get_functiondef,
-- read live 2026-11-10 ~21:00Z). Also stored in public.ops_preimage_snapshots
-- (reason 'wp7_channels_preimage', with every redefined function too).
--   trigger trg_new_app_notify:      CREATE TRIGGER trg_new_app_notify AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION trg_fn_new_app_notify()
--   trigger trg_application_discord: CREATE TRIGGER trg_application_discord AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION trg_fn_application_discord()
--   trigger trg_dm_referral_manager: CREATE TRIGGER trg_dm_referral_manager AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION fn_dm_referral_manager_on_new_applicant()
-- ============================================================================
--
-- ---- preimage: trg_fn_new_app_notify ----
-- | -- sig: trg_fn_new_app_notify()
-- | CREATE OR REPLACE FUNCTION public.trg_fn_new_app_notify()
-- |  RETURNS trigger
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions', 'net'
-- | AS $function$
-- | DECLARE v_webhook text; v_wa text; v_body jsonb;
-- | BEGIN
-- |   PERFORM set_config('statement_timeout','0', true);
-- |   IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
-- |   SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
-- |   SELECT value INTO v_wa      FROM public.system_settings WHERE key='whatsapp_group_link';
-- | 
-- |   IF v_webhook IS NOT NULL THEN
-- |     v_body := jsonb_build_object('username','APEX Recruit',
-- |       'embeds', jsonb_build_array(jsonb_build_object(
-- |         'title', format('🆕 NEW APPLICATION — %s %s', NEW.first_name, NEW.last_name),
-- |         'description', format(
-- |           E'**%s**, %s · %s\n📞 %s\n📧 %s\n💼 Experience: %s\n🎯 Desired income: %s\n\n**Call within 5 minutes to 2× conversion.**',
-- |           NEW.first_name || ' ' || NEW.last_name,
-- |           COALESCE(NEW.city,'') || CASE WHEN NEW.state IS NOT NULL THEN ', ' || NEW.state ELSE '' END,
-- |           COALESCE(NEW.license_status,'license status unknown'),
-- |           COALESCE(NEW.phone,'—'), COALESCE(NEW.email,'—'),
-- |           COALESCE(NEW.years_experience::text || ' yrs','none'),
-- |           COALESCE(NEW.desired_income,'—')),
-- |         'color', 3447003, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'),
-- |         'footer', jsonb_build_object('text', CASE WHEN v_wa IS NOT NULL THEN 'Share in WhatsApp: ' || v_wa ELSE 'https://apex-financial.org/dashboard/recruit' END))));
-- |     PERFORM net.http_post(url := v_webhook,
-- |       headers := jsonb_build_object('Content-Type','application/json'),
-- |       body := v_body, timeout_milliseconds := 10000);
-- |   END IF;
-- | 
-- |   IF NEW.phone IS NOT NULL AND length(regexp_replace(NEW.phone,'\D','','g')) >= 10 THEN
-- |     PERFORM public.queue_sms(NEW.phone,
-- |       format('Hey %s — Sam at APEX here. Got your app, I''ll call within the hour. Reply STOP to opt out.',
-- |         split_part(COALESCE(NEW.first_name,''),' ',1)));
-- |   END IF;
-- |   RETURN NEW;
-- | EXCEPTION WHEN others THEN RETURN NEW;
-- | END $function$
--
-- ---- preimage: trg_fn_application_discord ----
-- | -- sig: trg_fn_application_discord()
-- | CREATE OR REPLACE FUNCTION public.trg_fn_application_discord()
-- |  RETURNS trigger
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions'
-- | AS $function$
-- | BEGIN
-- |   -- v26 NO-SPAM RULE 2026-06-11
-- |   IF COALESCE((SELECT (value::text::boolean) FROM public.system_settings WHERE key='discord_notifications_paused'), false) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- |   IF NOT public.should_post_to_discord('trg_fn_application_discord', 5) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- | 
-- |   PERFORM public.run_automation_job(
-- |     'new-application-discord',
-- |     'discord-webhook-notify',
-- |     jsonb_build_object(
-- |       'event_type', 'new_application',
-- |       'details', jsonb_build_object(
-- |         'first_name', NEW.first_name,
-- |         'last_name',  NEW.last_name,
-- |         'state',      COALESCE(NEW.state, ''),
-- |         'instagram',  NEW.instagram_handle
-- |       )
-- |     )
-- |   );
-- |   RETURN NEW;
-- | EXCEPTION WHEN others THEN
-- |   RETURN NEW;
-- | END;
-- | $function$
--
-- ---- preimage: fn_alert_licensed_applicant ----
-- | -- sig: fn_alert_licensed_applicant()
-- | CREATE OR REPLACE FUNCTION public.fn_alert_licensed_applicant()
-- |  RETURNS trigger
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- | DECLARE
-- |   v_webhook text;
-- |   v_payload jsonb;
-- |   v_name text;
-- |   v_states text;
-- | BEGIN
-- |   -- v26 NO-SPAM RULE 2026-06-11
-- |   IF COALESCE((SELECT (value::text::boolean) FROM public.system_settings WHERE key='discord_notifications_paused'), false) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- |   IF NOT public.should_post_to_discord('fn_alert_licensed_applicant', 5) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- | 
-- |   -- Only fire when license_status becomes 'licensed'
-- |   IF NEW.license_status IS DISTINCT FROM 'licensed' THEN
-- |     RETURN NEW;
-- |   END IF;
-- |   -- Avoid duplicate alerts when row is just touched
-- |   IF TG_OP = 'UPDATE' AND OLD.license_status = 'licensed' THEN
-- |     RETURN NEW;
-- |   END IF;
-- | 
-- |   SELECT value::text INTO v_webhook FROM system_settings WHERE key='discord_webhook_url_recruiting';
-- |   v_webhook := TRIM('"' FROM v_webhook);
-- |   IF v_webhook IS NULL OR v_webhook = '' THEN RETURN NEW; END IF;
-- | 
-- |   v_name := TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,''));
-- |   v_states := COALESCE(NEW.licensed_states::text, 'unknown');
-- | 
-- |   v_payload := jsonb_build_object(
-- |     'username', 'APEX Licensed-Applicant Alert',
-- |     'content', '🔥🔥🔥 **LICENSED APPLICANT** just landed: **' || v_name || '**',
-- |     'embeds', jsonb_build_array(jsonb_build_object(
-- |       'title', '🎯 ' || v_name || ' — Licensed',
-- |       'color', 16711680,
-- |       'fields', jsonb_build_array(
-- |         jsonb_build_object('name', '📱 Phone', 'value', COALESCE(NEW.phone,'(none)'), 'inline', true),
-- |         jsonb_build_object('name', '📧 Email', 'value', COALESCE(NEW.email,'(none)'), 'inline', true),
-- |         jsonb_build_object('name', '📍 Location', 'value', COALESCE(NEW.city,'?') || ', ' || COALESCE(NEW.state,'?'), 'inline', true),
-- |         jsonb_build_object('name', '🏷️ Licensed states', 'value', v_states, 'inline', false),
-- |         jsonb_build_object('name', '🆔 NPN', 'value', COALESCE(NEW.nipr_number,'(none)'), 'inline', true),
-- |         jsonb_build_object('name', '💼 Prev production', 'value', COALESCE(NEW.previous_production::text,'(none)'), 'inline', true),
-- |         jsonb_build_object('name', '⚡ Open in dashboard', 'value', 'https://apex-financial.org/dashboard/applicants?lead=' || NEW.id::text, 'inline', false)
-- |       ),
-- |       'footer', jsonb_build_object('text', 'Call this person within 60 minutes — licensed leads convert at 4x.')
-- |     ))
-- |   );
-- | 
-- |   PERFORM net.http_post(
-- |     url := v_webhook,
-- |     headers := jsonb_build_object('Content-Type','application/json'),
-- |     body := v_payload
-- |   );
-- |   RETURN NEW;
-- | END;
-- | $function$
--
-- ---- preimage: applications_trigger_new_applicant_discord ----
-- | -- sig: applications_trigger_new_applicant_discord()
-- | CREATE OR REPLACE FUNCTION public.applications_trigger_new_applicant_discord()
-- |  RETURNS trigger
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions'
-- | AS $function$
-- | BEGIN
-- |   -- v26 NO-SPAM RULE 2026-06-11
-- |   IF COALESCE((SELECT (value::text::boolean) FROM public.system_settings WHERE key='discord_notifications_paused'), false) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- |   IF NOT public.should_post_to_discord('applications_trigger_new_applicant_discord', 5) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- | 
-- |   PERFORM public.run_automation_job(
-- |     'new-applicant-discord-notify',
-- |     'discord-webhook-notify',
-- |     jsonb_build_object(
-- |       'event_type', 'new_applicant',
-- |       'agent_name', COALESCE(NEW.first_name || ' ' || NEW.last_name, 'New Applicant'),
-- |       'details', jsonb_build_object(
-- |         'email', NEW.email,
-- |         'phone',  COALESCE(NEW.phone, ''),
-- |         'state',  COALESCE(NEW.state, '')
-- |       )
-- |     )
-- |   );
-- |   RETURN NEW;
-- | EXCEPTION WHEN others THEN
-- |   RETURN NEW;
-- | END;
-- | $function$
--
-- ---- preimage: applications_trigger_stage_change_discord ----
-- | -- sig: applications_trigger_stage_change_discord()
-- | CREATE OR REPLACE FUNCTION public.applications_trigger_stage_change_discord()
-- |  RETURNS trigger
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions'
-- | AS $function$
-- | DECLARE
-- |   v_recruiter text;
-- | BEGIN
-- |   -- v26 NO-SPAM RULE 2026-06-11
-- |   IF COALESCE((SELECT (value::text::boolean) FROM public.system_settings WHERE key='discord_notifications_paused'), false) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- |   IF NOT public.should_post_to_discord('applications_trigger_stage_change_discord', 5) THEN
-- |     RETURN COALESCE(NEW, OLD);
-- |   END IF;
-- | 
-- |   IF OLD.license_progress IS NOT DISTINCT FROM NEW.license_progress THEN
-- |     RETURN NEW;
-- |   END IF;
-- | 
-- |   SELECT COALESCE(p.full_name, 'Manager')
-- |   INTO v_recruiter
-- |   FROM public.agents a
-- |   LEFT JOIN public.profiles p ON p.id = a.profile_id
-- |   WHERE a.id = NEW.assigned_agent_id
-- |   LIMIT 1;
-- | 
-- |   PERFORM public.run_automation_job(
-- |     'pipeline-stage-change-discord',
-- |     'discord-webhook-notify',
-- |     jsonb_build_object(
-- |       'event_type', 'stage_change',
-- |       'agent_name', COALESCE(NEW.first_name || ' ' || NEW.last_name, 'Applicant'),
-- |       'details', jsonb_build_object(
-- |         'from_stage', COALESCE(OLD.license_progress, 'new_applicant'),
-- |         'to_stage',   NEW.license_progress,
-- |         'email',      NEW.email,
-- |         'recruiter',  COALESCE(v_recruiter, '')
-- |       )
-- |     )
-- |   );
-- | 
-- |   RETURN NEW;
-- | EXCEPTION WHEN others THEN
-- |   RETURN NEW;
-- | END;
-- | $function$
--
-- ---- preimage: fn_dm_referral_manager_on_new_applicant ----
-- | -- sig: fn_dm_referral_manager_on_new_applicant()
-- | CREATE OR REPLACE FUNCTION public.fn_dm_referral_manager_on_new_applicant()
-- |  RETURNS trigger
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- | DECLARE
-- |   v_token text;
-- |   v_manager_chat bigint;
-- |   v_msg text;
-- | BEGIN
-- |   IF NEW.referral_manager_id IS NULL THEN RETURN NEW; END IF;
-- | 
-- |   -- Look up the manager's personal Telegram chat (via their agent record)
-- |   SELECT a.telegram_chat_id INTO v_manager_chat
-- |     FROM agents a WHERE a.id = NEW.referral_manager_id
-- |     LIMIT 1;
-- |   IF v_manager_chat IS NULL OR v_manager_chat = 0 THEN RETURN NEW; END IF;
-- | 
-- |   SELECT TRIM('"' FROM value::text) INTO v_token FROM system_settings WHERE key='telegram_bot_token';
-- |   IF v_token IS NULL OR v_token = '' THEN RETURN NEW; END IF;
-- | 
-- |   v_msg := '👥 <b>Your referral just applied:</b> ' || TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'')) || E'\n\n' ||
-- |            '📱 ' || COALESCE(NEW.phone, '(no phone)') || E'\n' ||
-- |            '📧 ' || COALESCE(NEW.email, '(no email)') || E'\n' ||
-- |            '🏷️ License: ' || COALESCE(NEW.license_status, 'unknown') || E'\n\n' ||
-- |            'You are auto-credited as their referrer. Call them within 60 min for highest conversion.';
-- | 
-- |   PERFORM net.http_post(
-- |     url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
-- |     headers := jsonb_build_object('Content-Type','application/json'),
-- |     body := jsonb_build_object(
-- |       'chat_id', v_manager_chat,
-- |       'text', v_msg,
-- |       'parse_mode', 'HTML'
-- |     )
-- |   );
-- |   RETURN NEW;
-- | END;
-- | $function$
--
-- ---- preimage: post_morning_huddle ----
-- | -- sig: post_morning_huddle()
-- | CREATE OR REPLACE FUNCTION public.post_morning_huddle()
-- |  RETURNS jsonb
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- | DECLARE
-- |   v_webhook text;
-- |   v_req bigint;
-- |   v_yesterday_deals int;
-- |   v_top_agent_yesterday text;
-- |   v_top_agent_alp numeric;
-- |   v_mtd_deals int;
-- |   v_yesterday_weekday text;
-- |   v_body jsonb;
-- | BEGIN
-- |   PERFORM set_config('statement_timeout','0', true);
-- | 
-- |   SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
-- |   IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
-- | 
-- |   v_yesterday_weekday := to_char(CURRENT_DATE - 1, 'Day');
-- | 
-- |   SELECT COUNT(*)::int INTO v_yesterday_deals
-- |   FROM public.deals
-- |   WHERE effective_date = (CURRENT_DATE - 1)::date
-- |     AND status IN ('submitted', 'active')
-- |     AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- | 
-- |   SELECT p.full_name, COALESCE(SUM(d.annual_premium),0)::numeric
-- |     INTO v_top_agent_yesterday, v_top_agent_alp
-- |   FROM public.deals d
-- |   JOIN public.agents a ON a.id = d.agent_id
-- |   JOIN public.profiles p ON p.id = a.profile_id
-- |   WHERE d.effective_date = (CURRENT_DATE - 1)::date
-- |     AND d.status IN ('submitted', 'active')
-- |     AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
-- |   GROUP BY p.full_name
-- |   ORDER BY SUM(d.annual_premium) DESC LIMIT 1;
-- | 
-- |   SELECT COUNT(*)::int INTO v_mtd_deals
-- |   FROM public.deals
-- |   WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date
-- |     AND status IN ('submitted', 'active')
-- |     AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- | 
-- |   -- POLICY: agency total ALP / MTD total ALP REMOVED. Top-N + counts only.
-- |   v_body := jsonb_build_object(
-- |     'username', 'APEX Morning Huddle',
-- |     'content', CASE
-- |       WHEN v_yesterday_deals = 0 THEN format(
-- |         E'🌅 **MORNING HUDDLE** — %s was a goose egg. Today is the day we fix that.\n\n**MTD**: %s deals\n\n📞 First dial by 10:30. No excuses.',
-- |         trim(v_yesterday_weekday),
-- |         v_mtd_deals)
-- |       ELSE format(
-- |         E'🌅 **MORNING HUDDLE** — %s wrote %s deals.\n\n🏆 Top producer %s: $%s ALP\n**MTD**: %s deals\n\nWho beats %s today? Go.',
-- |         trim(v_yesterday_weekday),
-- |         v_yesterday_deals,
-- |         COALESCE(v_top_agent_yesterday, 'TBD'),
-- |         to_char(v_top_agent_alp, 'FM999,999'),
-- |         v_mtd_deals,
-- |         COALESCE(v_top_agent_yesterday, 'them'))
-- |     END
-- |   );
-- | 
-- |   v_req := net.http_post(url := v_webhook, body := v_body,
-- |     headers := jsonb_build_object('Content-Type','application/json'));
-- |   RETURN jsonb_build_object('posted', true, 'request_id', v_req);
-- | END $function$
--
-- ---- preimage: post_evening_recap ----
-- | -- sig: post_evening_recap()
-- | CREATE OR REPLACE FUNCTION public.post_evening_recap()
-- |  RETURNS jsonb
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions', 'net'
-- | AS $function$
-- | DECLARE
-- |   v_webhook text; v_req bigint;
-- |   v_today_deals int;
-- |   v_top_3 text;
-- |   v_body jsonb;
-- |   v_today date := CURRENT_DATE;
-- | BEGIN
-- |   PERFORM set_config('statement_timeout','0', true);
-- |   SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
-- |   IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
-- | 
-- |   SELECT COUNT(*)::int INTO v_today_deals
-- |   FROM public.deals
-- |   WHERE effective_date = v_today
-- |     AND status IN ('submitted', 'active')
-- |     AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- | 
-- |   IF v_today_deals = 0 THEN
-- |     RETURN jsonb_build_object('skipped', true, 'reason', 'no_qualifying_deals');
-- |   END IF;
-- | 
-- |   SELECT string_agg(
-- |     (rank::text || '. ' || name || ' — $' || to_char(alp,'FM999,990') ||
-- |      ' (' || deals || ')'), E'\n' ORDER BY rank)
-- |   INTO v_top_3
-- |   FROM (
-- |     SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rank,
-- |       p.full_name AS name, SUM(d.annual_premium) AS alp, COUNT(*) AS deals
-- |     FROM public.deals d JOIN public.agents a ON a.id=d.agent_id
-- |     JOIN public.profiles p ON p.id=a.profile_id
-- |     WHERE d.effective_date = v_today
-- |       AND d.status IN ('submitted', 'active')
-- |       AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
-- |     GROUP BY p.full_name
-- |     ORDER BY SUM(d.annual_premium) DESC LIMIT 3) t;
-- | 
-- |   v_body := jsonb_build_object('username','APEX Evening Recap',
-- |     'embeds', jsonb_build_array(jsonb_build_object(
-- |       'title', format('🌆 Day Complete — %s', to_char(now() AT TIME ZONE 'America/Chicago', 'Dy, Mon DD')),
-- |       'description', format('**%s deals today**%s',
-- |         v_today_deals,
-- |         CASE WHEN v_top_3 IS NOT NULL THEN E'\n\n**Top 3:**\n' || v_top_3 ELSE '' END),
-- |       'color', 7506394, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));
-- | 
-- |   v_req := net.http_post(url := v_webhook,
-- |     headers := jsonb_build_object('Content-Type','application/json'),
-- |     body := v_body, timeout_milliseconds := 20000);
-- |   RETURN jsonb_build_object('posted', true);
-- | END $function$
--
-- ---- preimage: post_weekly_recap ----
-- | -- sig: post_weekly_recap()
-- | CREATE OR REPLACE FUNCTION public.post_weekly_recap()
-- |  RETURNS jsonb
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions', 'net'
-- | AS $function$
-- | DECLARE
-- |   v_webhook text; v_deals int;
-- |   v_top_3 text; v_new_hires int; v_body jsonb;
-- | BEGIN
-- |   PERFORM set_config('statement_timeout','0', true);
-- |   SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
-- |   IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
-- | 
-- |   SELECT COUNT(*)::int INTO v_deals
-- |   FROM public.deals
-- |   WHERE effective_date >= CURRENT_DATE - interval '7 days'
-- |     AND status IN ('submitted', 'active')
-- |     AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- | 
-- |   SELECT COUNT(*)::int INTO v_new_hires
-- |   FROM public.agents WHERE created_at > now() - interval '7 days';
-- | 
-- |   SELECT string_agg(
-- |     (rank::text || '. ' || name || ' — $' || to_char(alp,'FM999,990') ||
-- |      ' (' || deals || ' deals)'), E'\n' ORDER BY rank)
-- |   INTO v_top_3
-- |   FROM (
-- |     SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rank,
-- |       p.full_name AS name, SUM(d.annual_premium) AS alp, COUNT(*) AS deals
-- |     FROM public.deals d JOIN public.agents a ON a.id=d.agent_id
-- |     JOIN public.profiles p ON p.id=a.profile_id
-- |     WHERE d.effective_date >= CURRENT_DATE - interval '7 days'
-- |       AND d.status IN ('submitted', 'active')
-- |       AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
-- |     GROUP BY p.full_name
-- |     ORDER BY SUM(d.annual_premium) DESC LIMIT 3) t;
-- | 
-- |   -- POLICY: agency total ALP REMOVED. Deal count + new hires + Top-3 only.
-- |   v_body := jsonb_build_object('username','APEX Weekly Wrap',
-- |     'embeds', jsonb_build_array(jsonb_build_object(
-- |       'title','📅 Week in Review',
-- |       'description', format('**%s deals this week** · **%s new agents**%s',
-- |         v_deals, v_new_hires,
-- |         CASE WHEN v_top_3 IS NOT NULL THEN E'\n\n**Top performers:**\n' || v_top_3 ELSE '' END),
-- |       'color', 15844367, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));
-- | 
-- |   PERFORM net.http_post(url := v_webhook,
-- |     headers := jsonb_build_object('Content-Type','application/json'),
-- |     body := v_body, timeout_milliseconds := 20000);
-- |   RETURN jsonb_build_object('posted', true);
-- | END $function$
--
-- ---- preimage: post_daily_top_producer ----
-- | -- sig: post_daily_top_producer()
-- | CREATE OR REPLACE FUNCTION public.post_daily_top_producer()
-- |  RETURNS jsonb
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- | DECLARE
-- |   v_webhook text;
-- |   v_today_date date := (NOW() AT TIME ZONE 'America/Chicago')::date;
-- |   v_top record;
-- |   v_total_deals int;
-- |   v_body jsonb;
-- |   v_req bigint;
-- | BEGIN
-- |   PERFORM set_config('statement_timeout','0', true);
-- | 
-- |   SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
-- |   IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;
-- | 
-- |   SELECT p.full_name AS name,
-- |          COALESCE(p.avatar_url,'') AS avatar,
-- |          SUM(d.annual_premium)::numeric AS alp,
-- |          COUNT(*)::int AS deals
-- |   INTO v_top
-- |   FROM public.deals d
-- |   JOIN public.agents a ON a.id = d.agent_id
-- |   JOIN public.profiles p ON p.id = a.profile_id
-- |   WHERE d.effective_date = v_today_date
-- |     AND d.status IN ('submitted', 'active')
-- |     AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
-- |   GROUP BY p.full_name, p.avatar_url
-- |   ORDER BY SUM(d.annual_premium) DESC
-- |   LIMIT 1;
-- | 
-- |   SELECT COUNT(*)::int INTO v_total_deals
-- |   FROM public.deals
-- |   WHERE effective_date = v_today_date
-- |     AND status IN ('submitted', 'active')
-- |     AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- | 
-- |   IF v_top.alp IS NULL OR v_top.alp = 0 THEN
-- |     v_body := jsonb_build_object(
-- |       'username', 'APEX 7pm Recap',
-- |       'content', format(
-- |         E'📉 **No deals on the board today (%s).** Tomorrow''s goose egg is optional. The phone still works at 7:01pm.',
-- |         to_char(v_today_date, 'Dy Mon DD')));
-- |   ELSE
-- |     -- POLICY: agency total ALP removed; only deal count + Top-1 framing.
-- |     v_body := jsonb_build_object(
-- |       'username', 'APEX 7pm Recap',
-- |       'embeds', jsonb_build_array(jsonb_build_object(
-- |         'title', format('🏆 TOP PRODUCER — %s', to_char(v_today_date, 'Dy Mon DD')),
-- |         'description', format(
-- |           E'**%s** · **$%s ALP** · %s deal%s\n\n**%s deals across the floor today.**',
-- |           v_top.name,
-- |           to_char(v_top.alp, 'FM999,999'),
-- |           v_top.deals,
-- |           CASE WHEN v_top.deals = 1 THEN '' ELSE 's' END,
-- |           v_total_deals),
-- |         'color', 15844367,
-- |         'thumbnail', jsonb_build_object('url', v_top.avatar),
-- |         'footer', jsonb_build_object('text', 'Who beats them tomorrow?'),
-- |         'timestamp', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
-- |   END IF;
-- | 
-- |   v_req := net.http_post(url := v_webhook, body := v_body,
-- |     headers := jsonb_build_object('Content-Type','application/json'));
-- | 
-- |   RETURN jsonb_build_object('posted', true, 'top', v_top.name,
-- |     'alp', v_top.alp, 'date', v_today_date);
-- | END $function$
--
-- ---- preimage: post_midday_snapshot ----
-- | -- sig: post_midday_snapshot()
-- | CREATE OR REPLACE FUNCTION public.post_midday_snapshot()
-- |  RETURNS jsonb
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions', 'net'
-- | AS $function$
-- | DECLARE
-- |   v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
-- |   v_today_deals int;
-- |   v_today_hires int;
-- |   v_apps_today int;
-- |   v_top text;
-- |   v_body jsonb;
-- | BEGIN
-- |   PERFORM set_config('statement_timeout','0', true);
-- | 
-- |   SELECT COUNT(*)::int INTO v_today_deals
-- |   FROM public.deals
-- |   WHERE effective_date = v_today
-- |     AND status IN ('submitted', 'active')
-- |     AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';
-- | 
-- |   SELECT COUNT(*)::int INTO v_today_hires FROM public.agents
-- |   WHERE created_at::date = v_today;
-- | 
-- |   SELECT COUNT(*)::int INTO v_apps_today FROM public.v_applications_real applications
-- |   WHERE created_at::date = v_today AND terminated_at IS NULL;
-- | 
-- |   IF v_today_deals = 0 AND v_today_hires = 0 AND v_apps_today = 0 THEN
-- |     RETURN jsonb_build_object('skipped', true, 'reason', 'no_activity');
-- |   END IF;
-- | 
-- |   SELECT string_agg(line, E'\n' ORDER BY rn)
-- |   INTO v_top
-- |   FROM (
-- |     SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rn,
-- |       format('• %s — $%s · %s deal%s',
-- |         p.full_name,
-- |         to_char(SUM(d.annual_premium), 'FM999,990'),
-- |         COUNT(*),
-- |         CASE WHEN COUNT(*) = 1 THEN '' ELSE 's' END) AS line
-- |     FROM public.deals d
-- |     JOIN public.agents a ON a.id = d.agent_id
-- |     JOIN public.profiles p ON p.id = a.profile_id
-- |     WHERE d.effective_date = v_today
-- |       AND d.status IN ('submitted', 'active')
-- |       AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
-- |     GROUP BY p.full_name
-- |     ORDER BY SUM(d.annual_premium) DESC
-- |     LIMIT 5
-- |   ) t;
-- | 
-- |   v_body := jsonb_build_object('username','APEX Midday',
-- |     'content', format(
-- |       E'**☀️ MIDDAY CHECK — %s CT**\n\n' ||
-- |       E'📊 **Deals today:** %s\n' ||
-- |       E'📞 **New applications:** %s  ·  🎯 **Hires today:** %s\n\n' ||
-- |       E'%s\n\n' ||
-- |       E'Second half starts now. Who''s converting before 5?',
-- |       to_char(now() AT TIME ZONE 'America/Chicago', 'Dy HH12:MIam'),
-- |       v_today_deals,
-- |       v_apps_today, v_today_hires,
-- |       COALESCE(E'**Top 5 today:**\n' || v_top, '_no deals posted yet — who''s going to be first?_')));
-- | 
-- |   PERFORM public.discord_route('midday_snapshot',
-- |     to_char(v_today, 'YYYY-MM-DD'),
-- |     'leadership', v_body);
-- | 
-- |   RETURN jsonb_build_object('posted', true, 'today_deals', v_today_deals);
-- | END $function$


-- ---------------------------------------------------------------------------
-- 0. Preimage capture (runs once; a re-apply after the drops finds the row).
-- ---------------------------------------------------------------------------
do $$
declare
  v_fns jsonb := '{}'::jsonb;
  r record;
begin
  if to_regclass('public.ops_preimage_snapshots') is null then return; end if;
  if exists (select 1 from public.ops_preimage_snapshots where reason = 'wp7_channels_preimage') then return; end if;
  for r in
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'trg_fn_new_app_notify','trg_fn_application_discord','fn_alert_licensed_applicant',
      'applications_trigger_new_applicant_discord','applications_trigger_stage_change_discord',
      'post_morning_huddle','post_evening_recap','post_weekly_recap','post_daily_top_producer','post_midday_snapshot',
      'auto_kickoff_new_licensee','trg_fn_first_deal_welcome','trg_fn_hot_streak','trg_fn_referral_ask',
      'trg_fn_reward_broadcast','broadcast_to_all_channels','trg_fn_agent_inserted_discord',
      'trg_fn_agent_activated_discord','fn_agent_license_returned_alert','fn_dm_referral_manager_on_new_applicant',
      'fn_agent_deprovision','apex_agent_onboarding_roadmap','admin_team_engagement','my_onboarding_roll_call',
      'fn_unlicensed_slack_digest'])
  loop
    v_fns := v_fns || jsonb_build_object(r.proname, r.def);
  end loop;
  insert into public.ops_preimage_snapshots(reason, payload)
  values ('wp7_channels_preimage', jsonb_build_object(
    'functions', v_fns,
    'triggers', jsonb_build_object(
      'trg_new_app_notify', 'CREATE TRIGGER trg_new_app_notify AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION trg_fn_new_app_notify()',
      'trg_application_discord', 'CREATE TRIGGER trg_application_discord AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION trg_fn_application_discord()',
      'trg_dm_referral_manager', 'CREATE TRIGGER trg_dm_referral_manager AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION fn_dm_referral_manager_on_new_applicant()'),
    'channel_deprovision_queue_pending', (
      select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'channels', q.channels, 'notes', q.notes)), '[]'::jsonb)
      from public.channel_deprovision_queue q where q.status = 'pending'),
    'outbox_discord_open', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status)), '[]'::jsonb)
      from public.outbox_events o
      where o.destination in ('discord','discord_subagency') and o.status in ('pending','failed')),
    'discord_deal_sources', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.discord_deal_sources s),
    'outbox_events_status_check', (
      select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.outbox_events'::regclass and c.conname = 'outbox_events_status_check'),
    'messaging_identity_links_match_method_check', (
      select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.messaging_identity_links'::regclass and c.conname = 'messaging_identity_links_match_method_check')
  ));
end $$;

-- ---------------------------------------------------------------------------
-- 1. Kill switch (raw text). do nothing on conflict: if Sam flips it to 'false'
--    (decision N6 = mirror), a re-apply of this file must not flip it back.
-- ---------------------------------------------------------------------------
insert into public.system_settings(key, value)
values ('discord_notifications_paused', 'true')
on conflict (key) do nothing;

create or replace function public.fn_discord_paused()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Reader of the ONE Discord kill switch. Same semantics as canPostToDiscord()
  -- in supabase/functions/_shared/apex.ts: paused only when the raw value is
  -- the word true. A missing row means not paused.
  select coalesce(
    (select lower(btrim(value)) = 'true' from public.system_settings
      where key = 'discord_notifications_paused' limit 1),
    false);
$function$;
revoke all on function public.fn_discord_paused() from public, anon, authenticated;
grant execute on function public.fn_discord_paused() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Drop the PII-capable posters. Refuse to drop anything that still has a
--    caller (pg_proc body or cron.job), so this can never break a live path.
-- ---------------------------------------------------------------------------
do $$
declare
  v_names text[] := array[
    'trg_fn_new_app_notify','trg_fn_application_discord','fn_alert_licensed_applicant',
    'applications_trigger_new_applicant_discord','applications_trigger_stage_change_discord',
    'post_morning_huddle','post_evening_recap','post_weekly_recap','post_daily_top_producer','post_midday_snapshot'];
  v_bad text;
begin
  select string_agg(distinct x.name || ' <- ' || x.caller, ', ') into v_bad
  from (
    select t.name, p.proname::text as caller
    from unnest(v_names) t(name)
    join pg_proc p on p.prosrc ~ ('\m' || t.name || '\M')
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname <> all (v_names)
    union all
    select t.name, 'cron:' || j.jobname
    from unnest(v_names) t(name)
    join cron.job j on j.command ~ ('\m' || t.name || '\M')
  ) x;
  if v_bad is not null then
    raise exception 'WP7: refusing to drop functions that still have callers: %', v_bad;
  end if;
end $$;

drop trigger if exists trg_new_app_notify on public.applications;
drop function if exists public.trg_fn_new_app_notify();
drop trigger if exists trg_application_discord on public.applications;
drop function if exists public.trg_fn_application_discord();
drop function if exists public.fn_alert_licensed_applicant();
drop function if exists public.applications_trigger_new_applicant_discord();
drop function if exists public.applications_trigger_stage_change_discord();
drop function if exists public.post_morning_huddle();
drop function if exists public.post_evening_recap();
drop function if exists public.post_weekly_recap();
drop function if exists public.post_daily_top_producer();
drop function if exists public.post_midday_snapshot();
-- HUMAN-6: the referral-manager Telegram DM carried applicant phone+email, has
-- never fired (0 agents hold a telegram_chat_id), and would have rolled back the
-- application INSERT the day one did: COALESCE(NEW.license_status,'unknown')
-- raises on the license_status enum and the function had no handler.
drop trigger if exists trg_dm_referral_manager on public.applications;
drop function if exists public.fn_dm_referral_manager_on_new_applicant();

-- ---------------------------------------------------------------------------
-- 3. auto_kickoff_new_licensee: the license-back celebration lives in the
--    Slack outbox (candidate.licensing_milestone via
--    fn_queue_licensing_milestone_slack). The Discord block posted
--    "First Last just got licensed" into the team room, which the 2026-09-26
--    rule makes Sam-only, and it had NO exception handler, so a malformed
--    discord_webhook_url would have rolled back every Licensed transition.
--    The trigger is kept as the license-back hook point; the body is now a
--    guarded no-op past the transition check.
-- ---------------------------------------------------------------------------
create or replace function public.auto_kickoff_new_licensee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only fire on the exact transition to 'licensed'
  if new.license_progress is distinct from 'licensed' then return new; end if;
  if old.license_progress is not distinct from 'licensed' then return new; end if;

  -- PL-WIB-PG-ANON-BEARER: the portal-login leg that sat here is retired.
  -- WP7 (2026-11-10): the Discord "just got licensed" post is retired with
  -- Discord. Do not add a network call here without an EXCEPTION handler.
  return new;
exception when others then
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Remaining direct pg_net posters: gated on the switch. Bodies are the live
--    definitions with ONE change each (marked WP7).
-- ---------------------------------------------------------------------------
create or replace function public.trg_fn_first_deal_welcome()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
DECLARE v_prior int; v_webhook text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') THEN RETURN NEW; END IF;
  IF NEW.effective_date IS NULL OR NEW.effective_date < CURRENT_DATE - interval '2 days' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_prior FROM public.deals WHERE agent_id = NEW.agent_id AND id <> NEW.id;
  IF v_prior > 0 THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  -- WP7: the Slack first-deal post is production.first_deal (fn_enqueue_production_celebrations).
  IF v_webhook IS NULL OR public.fn_discord_paused() THEN RETURN NEW; END IF;
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
END $function$;

create or replace function public.trg_fn_hot_streak()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
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
  -- WP7: gated on the Discord kill switch.
  IF v_webhook IS NULL OR public.fn_discord_paused() THEN RETURN NEW; END IF;
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
END $function$;

create or replace function public.trg_fn_referral_ask()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
DECLARE v_webhook text; v_agent_name text; v_count int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') THEN RETURN NEW; END IF;
  IF NEW.effective_date IS NULL OR NEW.effective_date < CURRENT_DATE - interval '2 days' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::int INTO v_count FROM public.deals WHERE agent_id = NEW.agent_id;
  IF v_count NOT IN (3, 5, 10) THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  -- WP7: gated on the Discord kill switch.
  IF v_webhook IS NULL OR public.fn_discord_paused() THEN RETURN NEW; END IF;
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
END $function$;

create or replace function public.trg_fn_reward_broadcast()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
DECLARE v_webhook text; v_wa text; v_agent_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.rank > 1 THEN RETURN NEW; END IF;
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  SELECT value INTO v_wa      FROM public.system_settings WHERE key='whatsapp_group_link';
  -- WP7: gated on the Discord kill switch.
  IF v_webhook IS NULL OR public.fn_discord_paused() THEN RETURN NEW; END IF;
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
END $function$;

create or replace function public.broadcast_to_all_channels(p_title text, p_body text, p_priority text default 'normal'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
DECLARE v_webhook text; v_wa_link text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  -- v26 NO-SPAM RULE 2026-06-11 · kill switch + rate limit.
  -- WP7: read through fn_discord_paused(). The old value::text::boolean cast
  -- raised on any non-boolean value, and this function had no handler, so a
  -- typo in the switch would have failed flex_hire.
  IF public.fn_discord_paused() THEN
    RETURN jsonb_build_object('skipped','kill_switch');
  END IF;
  IF NOT public.should_post_to_discord('broadcast', 5) THEN
    RETURN jsonb_build_object('skipped','rate_limit');
  END IF;
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
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', 'broadcast_failed', 'detail', left(sqlerrm, 200));
END $function$;

create or replace function public.trg_fn_agent_inserted_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
DECLARE
  v_first_name text;
  v_manager_name text;
BEGIN
  -- WP7: gated on the Discord kill switch (Slack carries agent.hired).
  IF public.fn_discord_paused() THEN
    RETURN NEW;
  END IF;
  IF (NEW.status IS DISTINCT FROM 'active'::agent_status) AND (NEW.onboarding_stage IS NULL) THEN
    RETURN NEW;
  END IF;
  IF NEW.is_deactivated IS TRUE OR NEW.is_inactive IS TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.agent_code LIKE 'GHOST_%' THEN
    RETURN NEW;
  END IF;

  v_first_name := COALESCE(NULLIF(split_part(NEW.display_name, ' ', 1), ''), 'A new producer');

  SELECT m.display_name INTO v_manager_name FROM agents m WHERE m.id = NEW.manager_id;

  PERFORM public.broadcast_to_all_channels(
    '🎯 NEW HIRE — ' || COALESCE(NEW.display_name, 'unnamed agent'),
    'Welcome ' || v_first_name || ' to the Apex Empire 👑' ||
    CASE WHEN NEW.agent_code IS NOT NULL THEN E'\nAgent code: ' || NEW.agent_code ELSE '' END ||
    CASE WHEN v_manager_name IS NOT NULL THEN E'\nManager: ' || v_manager_name ELSE '' END ||
    E'\nLet''s get it. 🔥',
    'high'
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END $function$;

create or replace function public.trg_fn_agent_activated_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v_agent_name   text;
  v_instagram    text;
  v_manager_name text;
  v_referred_by  text;
  v_state        text;
  v_email        text;
BEGIN
  -- v26 NO-SPAM RULE 2026-06-11 (WP7: read through fn_discord_paused()).
  IF public.fn_discord_paused() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT public.should_post_to_discord('trg_fn_agent_activated_discord', 5) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only fire on initial activation (contracted_at going from NULL → value)
  IF OLD.contracted_at IS NOT NULL OR NEW.contracted_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Name + instagram from profile. v_email is used ONLY to find the state;
  -- WP7 removed it from the outbound payload (embedAgentActivated never
  -- rendered it, so it was contact data leaving the database for nothing).
  SELECT p.full_name, p.instagram_handle, p.email
  INTO v_agent_name, v_instagram, v_email
  FROM public.profiles p WHERE p.id = NEW.profile_id;

  -- State: prefer profile, fall back to matching application by email
  SELECT COALESCE(p.state,
                  (SELECT a.state FROM public.applications a
                   WHERE LOWER(a.email) = LOWER(v_email)
                     AND a.state IS NOT NULL
                   ORDER BY a.created_at DESC LIMIT 1),
                  '')
  INTO v_state
  FROM public.profiles p WHERE p.id = NEW.profile_id;

  IF NEW.manager_id IS NOT NULL THEN
    SELECT COALESCE(pm.full_name, 'Sam')
    INTO v_manager_name
    FROM public.agents am
    JOIN public.profiles pm ON pm.id = am.profile_id
    WHERE am.id = NEW.manager_id;
  END IF;

  IF NEW.invited_by_manager_id IS NOT NULL THEN
    SELECT COALESCE(pr.full_name, '')
    INTO v_referred_by
    FROM public.agents ar
    JOIN public.profiles pr ON pr.id = ar.profile_id
    WHERE ar.id = NEW.invited_by_manager_id;
  END IF;

  PERFORM public.run_automation_job(
    'agent-activated-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'agent_activated',
      'details', jsonb_build_object(
        'agent_name',  COALESCE(v_agent_name, 'New Agent'),
        'state',       COALESCE(v_state, ''),
        'hired_by',    COALESCE(v_manager_name, 'Sam'),
        'manager',     COALESCE(v_manager_name, 'Sam'),
        'referred_by', v_referred_by,
        'start_date',  TO_CHAR(COALESCE(NEW.start_date, CURRENT_DATE), 'Mon DD, YYYY'),
        'instagram',   v_instagram
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 5. EXCEPTION guard on an unowned trigger that call net.http_post with no
--    handler (bodies byte-identical to live apart from the guard).
--    * fn_agent_license_returned_alert (AFTER UPDATE on agents): a pg_net raise
--      would roll back the agent's license_status update. On failure we record
--      the alert as failed instead of losing it silently.
--    (fn_dm_referral_manager_on_new_applicant, the other unowned one, is
--    DROPPED in section 2 per HUMAN-6.)
-- ---------------------------------------------------------------------------
create or replace function public.fn_agent_license_returned_alert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows        integer := 0;
  v_url         text;
  v_key         text;
  v_name        text;
  v_email       text;
  v_npn         text;
  v_subject     text;
  v_sms         text;
  v_html        text;
  v_req_id      bigint;
begin
  -- Genuine transition into licensed only.
  if new.license_status::text is distinct from 'licensed' then
    return new;
  end if;
  if old.license_status::text is not distinct from new.license_status::text then
    return new;
  end if;

  -- Claim the alert. If a row already exists (backfill seed, or a previous
  -- transition), this inserts nothing and we send nothing.
  insert into public.agent_license_alerts
    (agent_id, milestone, prev_status, new_status, status)
  values
    (new.id, 'licensed', old.license_status::text, new.license_status::text, 'pending')
  on conflict (agent_id, milestone) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return new;
  end if;

  select p.full_name, p.email
    into v_name, v_email
  from public.profiles p
  where p.id = new.profile_id;

  v_name  := coalesce(nullif(btrim(coalesce(v_name, '')), ''), new.display_name, 'Agent ' || new.id::text);
  v_npn   := nullif(btrim(coalesce(new.nipr_number, '')), '');

  v_subject := format('LICENSE BACK — %s is field-ready', v_name);
  v_sms     := format('APEX: %s license came back. NPN %s. Contract + field-ready now.',
                      v_name, coalesce(v_npn, 'not on file'));
  v_html    := format(
    '<p><strong>%s just came back licensed.</strong></p>'
    || '<p>Email: %s<br/>NPN: %s<br/>License #: %s<br/>States: %s<br/>NIPR verified: %s</p>'
    || '<p>Next: get them contracted and into the field.</p>'
    || '<p><a href="https://apex-financial.org/dashboard/crm">Open CRM</a></p>',
    v_name,
    coalesce(v_email, '—'),
    coalesce(v_npn, 'not on file'),
    coalesce(nullif(btrim(coalesce(new.license_number, '')), ''), '—'),
    coalesce(array_to_string(new.license_states, ', '), '—'),
    case when new.nipr_verified then 'yes' else 'NO — self-reported' end);

  select value into v_url from public.system_settings where key = 'supabase_url';
  -- PL-WIB-ALERT-DISPATCH-AUTH: the service key, not the anon key. The anon key
  -- ships in the public bundle, so apex-alert-dispatch now refuses it on the
  -- ad-hoc path (anyone holding it could page Sam on 4 channels with their own
  -- link). 'service_role_key' is what run_automation_job, applicant_login_send
  -- and schedule_auto_populate_tick already send.
  select value into v_key from public.system_settings where key = 'service_role_key';
  if v_url is null then v_url := 'https://xrzweoneiieddzxogewk.supabase.co'; end if;

  if v_key is null then
    -- No creds = no send. Record the failure honestly instead of leaving a
    -- 'pending' row that looks like it is merely in flight.
    update public.agent_license_alerts
       set status = 'failed',
           last_error = 'service_role_key missing from system_settings'
     where agent_id = new.id and milestone = 'licensed';
    return new;
  end if;

  -- One POST. apex-alert-dispatch inserts its own bot_alerts row and, because
  -- severity='celebrate' is STANDALONE, immediately fans out to ntfy + email +
  -- Discord + SMS. We do not insert bot_alerts ourselves — that would either
  -- double-send or race the dispatcher.
  select net.http_post(
    url     := v_url || '/functions/v1/apex-alert-dispatch',
    body    := jsonb_build_object(
                 'source',      'trigger',
                 'event_type',  'agent_license_returned',
                 'severity',    'celebrate',
                 'subject',     v_subject,
                 'body',        v_html,
                 'sms_body',    v_sms,
                 'action_link', 'https://apex-financial.org/dashboard/crm',
                 'channels',    jsonb_build_array('email', 'sms', 'discord', 'ntfy')),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key,
                 'apikey',        v_key)
  ) into v_req_id;

  -- pg_net is fire-and-forget: the response is NOT visible in this
  -- transaction (see memory apex_pg_net_visibility). So we record
  -- 'dispatch_requested', never 'sent'. v_agent_license_alert_health below
  -- reconciles against bot_alerts to prove whether it actually landed.
  update public.agent_license_alerts
     set status = 'dispatch_requested',
         dispatch_requested_at = now(),
         net_request_id = v_req_id
   where agent_id = new.id and milestone = 'licensed';

  return new;
exception when others then
  -- WP7: never let the alert roll back the agent's license update. The claim
  -- row above was rolled back with this block, so record the failure here.
  begin
    insert into public.agent_license_alerts
      (agent_id, milestone, prev_status, new_status, status, last_error)
    values
      (new.id, 'licensed', old.license_status::text, new.license_status::text, 'failed',
       'trigger error: ' || left(sqlerrm, 300))
    on conflict (agent_id, milestone) do nothing;
  exception when others then
    raise warning 'fn_agent_license_returned_alert could not record failure for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Outbox: terminal statuses + one guard for every Discord enqueuer.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_vals text[];
  v_add text[] := array['cancelled_retired', 'skipped_destination_dead'];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.outbox_events'::regclass and c.conname = 'outbox_events_status_check';
  if v_def is null then
    raise exception 'WP7: outbox_events_status_check not found; refusing to guess the vocabulary';
  end if;
  select array_agg(m[1]) into v_vals from regexp_matches(v_def, '''([a-z_]+)''', 'g') m;
  if v_vals @> v_add then return; end if;
  -- Merge, never replace: keep every live value (another package may have
  -- added one since this file was written).
  v_vals := array(select distinct x from unnest(v_vals || v_add) x order by 1);
  alter table public.outbox_events drop constraint outbox_events_status_check;
  execute format(
    'alter table public.outbox_events add constraint outbox_events_status_check check (status = any (%L::text[]))',
    v_vals);
end $$;

create or replace function public.fn_block_paused_discord_outbox()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- WP7: while Discord is paused, a Discord outbox row would only retry into
  -- a dead letter. Returning NULL skips THIS row only; the Slack row in the
  -- same statement still inserts (same pattern as fn_block_retired_cloud_outbox).
  if public.fn_discord_paused() then
    return null;
  end if;
  return new;
exception when others then
  -- Fail open: discord-webhook-notify re-checks the switch at the edge.
  return new;
end;
$function$;

drop trigger if exists trg_block_paused_discord_outbox on public.outbox_events;
create trigger trg_block_paused_discord_outbox
  before insert on public.outbox_events
  for each row
  when (new.destination in ('discord', 'discord_subagency'))
  execute function public.fn_block_paused_discord_outbox();

update public.outbox_events
   set status = 'cancelled_retired',
       processed_at = now(),
       locked_at = null,
       last_error_redacted = 'Discord retired 2026-10-05 (discord_notifications_paused=true). Cancelled by WP7; never delivered.'
 where destination in ('discord', 'discord_subagency')
   and status in ('pending', 'failed');

-- Inbound Discord deal ingestion: credential-blocked forever and its channel is
-- in the retired guild. Disabled like discord_vantage_agentcloud (2026-10-07).
update public.discord_deal_sources
   set enabled = false, updated_at = now()
 where source = 'discord_apex_money_printer' and enabled;


-- ---------------------------------------------------------------------------
-- 7. Offboarding covers Slack. channel_deprovision_queue had channels
--    {discord,whatsapp} on all 155 pending rows and was never processed, so
--    departed agents kept the workspace the team actually uses. Per-leg state
--    lives in channel_states; a row is never closed on one leg.
-- ---------------------------------------------------------------------------
alter table public.channel_deprovision_queue
  add column if not exists channel_states jsonb not null default '{}'::jsonb;
alter table public.channel_deprovision_queue
  alter column channels set default array['slack', 'whatsapp', 'discord']::text[];

create or replace function public.fn_agent_deprovision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_email text;
begin
  if (coalesce(NEW.is_inactive,false)=true or NEW.status in ('inactive','terminated')) then
    if coalesce(NEW.has_discord_access,false)=true then NEW.has_discord_access := false; end if;
    -- also flag the paid ReadyMode dialer seat for reclamation (~$278/seat/mo)
    if coalesce(NEW.has_dialer_login,false)=true then NEW.has_dialer_login := false; end if;
    -- WP7: the queue insert can never block the status change it records.
    begin
      select pr.full_name, pr.email into v_name, v_email from public.profiles pr where pr.id=NEW.profile_id;
      insert into public.channel_deprovision_queue(agent_id, full_name, email, reason, channels, channel_states)
        values (NEW.id, v_name, v_email, coalesce(NEW.status::text,'inactive'),
                array['slack','whatsapp','discord']::text[],
                jsonb_build_object(
                  'slack', jsonb_build_object('state', 'pending'),
                  'whatsapp', jsonb_build_object('state', 'pending'),
                  'discord', jsonb_build_object(
                    'state', 'not_actionable_no_bot',
                    'at', now(),
                    'why', 'No Discord bot or identity link exists; guild retired 2026-10-05 (WP7).')))
        on conflict (agent_id) where status='pending' do nothing;
    exception when others then
      raise warning 'fn_agent_deprovision queue insert failed for agent %: %', NEW.id, sqlerrm;
    end;
  end if;
  return NEW;
end $function$;

-- Backfill the open rows: add the Slack leg, close only the Discord leg.
update public.channel_deprovision_queue q
   set channels = array(select distinct c from unnest(coalesce(q.channels, '{}'::text[]) || array['slack']) c order by 1),
       channel_states = jsonb_build_object(
                          'slack', jsonb_build_object('state', 'pending'),
                          'whatsapp', jsonb_build_object('state', 'pending'),
                          'discord', jsonb_build_object(
                            'state', 'not_actionable_no_bot',
                            'at', now(),
                            'why', 'No Discord bot or identity link exists; guild retired 2026-10-05 (WP7).'))
                        || q.channel_states,
       notes = case
                 when coalesce(q.notes, '') like '%[WP7]%' then q.notes
                 else concat_ws(' | ', nullif(q.notes, ''),
                   '[WP7] Slack leg added 2026-11-10; Discord leg not actionable (no bot, no identity link). Row stays open for Slack + WhatsApp.')
               end
 where q.status = 'pending'
   and (not ('slack' = any (coalesce(q.channels, '{}'::text[]))) or not (q.channel_states ? 'discord'));

-- ---------------------------------------------------------------------------
-- 8. Slack membership signal. slack_joined_at is a UX completion signal
--    (self-reported via mark_slack_joined, or stamped from a verified identity
--    link). It is NEVER an authorization input, and the numbers-DM keeps
--    requiring a verified messaging_identity_links row.
-- ---------------------------------------------------------------------------
alter table public.agents add column if not exists slack_joined_at timestamptz;
alter table public.agents add column if not exists slack_joined_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agents_slack_joined_source_check') then
    alter table public.agents add constraint agents_slack_joined_source_check
      check (slack_joined_source is null or slack_joined_source in ('self_reported', 'verified_link'));
  end if;
end $$;
-- agents uses column-level SELECT grants; new columns are invisible without this.
grant select (slack_joined_at, slack_joined_source) on public.agents to authenticated;

update public.agents a
   set slack_joined_at = coalesce(a.slack_joined_at, l.verified_at),
       slack_joined_source = 'verified_link'
  from (
    select agent_id, min(verified_at) as verified_at
    from public.messaging_identity_links
    where verification_status = 'verified' and revoked_at is null and agent_id is not null
    group by agent_id
  ) l
 where a.id = l.agent_id
   and (a.slack_joined_source is distinct from 'verified_link');

create or replace function public.mark_slack_joined()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- Own rows only: the caller can only mark the agent record(s) tied to their
  -- own login. A verified link is never downgraded to self_reported.
  update public.agents
     set slack_joined_at = coalesce(slack_joined_at, now()),
         slack_joined_source = coalesce(slack_joined_source, 'self_reported')
   where user_id = v_uid
     and coalesce(is_deactivated, false) = false;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'No active agent record is linked to this login' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'updated', v_rows);
end;
$function$;
revoke all on function public.mark_slack_joined() from public, anon;
grant execute on function public.mark_slack_joined() to authenticated, service_role;

-- email_lookup identity links (written only by slack-unlicensed-welcome once
-- Sam grants users:read.email). Same exact-email + eligibility rules as
-- admin_verify_slack_identity; only the match_method differs.
do $$
declare
  v_def text;
  v_vals text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.messaging_identity_links'::regclass
    and c.conname = 'messaging_identity_links_match_method_check';
  if v_def is null then
    raise exception 'WP7: messaging_identity_links_match_method_check not found';
  end if;
  select array_agg(m[1]) into v_vals from regexp_matches(v_def, '''([a-z_]+)''', 'g') m;
  if 'email_lookup' = any (v_vals) then return; end if;
  v_vals := array(select distinct x from unnest(v_vals || array['email_lookup']) x order by 1);
  alter table public.messaging_identity_links drop constraint messaging_identity_links_match_method_check;
  execute format(
    'alter table public.messaging_identity_links add constraint messaging_identity_links_match_method_check check (match_method = any (%L::text[]))',
    v_vals);
end $$;

create or replace function public.fn_link_slack_identity_email_lookup(p_agent_id uuid, p_slack_user_id text, p_slack_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_installation_id uuid;
  v_eligible public.v_slack_invite_eligibility;
  v_link_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_slack_user_id, '')) !~ '^[UW][A-Z0-9]{8,}$' then
    raise exception 'Invalid Slack user ID' using errcode = '22023';
  end if;

  select * into v_eligible from public.v_slack_invite_eligibility where agent_id = p_agent_id;
  if not found or not v_eligible.is_eligible then
    raise exception 'Agent is not Slack eligible' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_slack_email, ''))) <> v_eligible.email then
    raise exception 'Slack email does not match the hired-agent record' using errcode = '22023';
  end if;

  select id into v_installation_id
  from public.messaging_workspace_installations
  where provider = 'slack' and environment = 'production' and status = 'active'
  order by installed_at desc nulls last, created_at desc
  limit 1;
  if v_installation_id is null then
    raise exception 'Active Slack installation not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.messaging_identity_links
    where installation_id = v_installation_id
      and slack_user_id = btrim(p_slack_user_id)
      and agent_id is distinct from p_agent_id
      and revoked_at is null
  ) then
    raise exception 'Slack user is already linked to another agent' using errcode = '23505';
  end if;

  insert into public.messaging_identity_links(
    installation_id, slack_user_id, auth_user_id, agent_id, match_method,
    verification_status, linked_by, linked_at, verified_at, revoked_at
  ) values (
    v_installation_id, btrim(p_slack_user_id), v_eligible.user_id, p_agent_id,
    'email_lookup', 'verified', null, now(), now(), null
  )
  on conflict (installation_id, slack_user_id) do update
  set auth_user_id = excluded.auth_user_id,
      agent_id = excluded.agent_id,
      verification_status = 'verified',
      verified_at = coalesce(messaging_identity_links.verified_at, now()),
      revoked_at = null,
      updated_at = now()
    -- never downgrade an admin-verified link to email_lookup
  where messaging_identity_links.match_method <> 'admin_verified'
     or messaging_identity_links.agent_id is not distinct from excluded.agent_id
  returning id into v_link_id;

  update public.agents
     set slack_joined_at = coalesce(slack_joined_at, now()),
         slack_joined_source = 'verified_link'
   where id = p_agent_id;

  return jsonb_build_object('ok', true, 'link_id', v_link_id, 'agent_id', p_agent_id,
                            'verification_status', 'verified', 'match_method', 'email_lookup');
end;
$function$;
revoke all on function public.fn_link_slack_identity_email_lookup(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_link_slack_identity_email_lookup(uuid, text, text) to service_role;

-- Ledger for the scope-gated #unlicensed / licensed-channel placement. One row
-- per person; lookups are retried after 3 days for not_found. FORWARD ONLY:
-- placement candidates are people who entered the state after the cutoff
-- below. Older people are a STAGED count in v_channel_health for Sam.
create table if not exists public.slack_placement_ledger (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('application', 'agent')),
  subject_id uuid not null,
  target text not null check (target in ('unlicensed', 'licensed')),
  lookup_state text not null check (lookup_state in ('found', 'not_found', 'error')),
  slack_user_id text,
  invited_channels text[] not null default '{}'::text[],
  invite_errors jsonb not null default '{}'::jsonb,
  looked_up_at timestamptz not null default now(),
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_kind, subject_id, target)
);
alter table public.slack_placement_ledger enable row level security;
revoke all on public.slack_placement_ledger from anon, authenticated;
grant select, insert, update on public.slack_placement_ledger to service_role;
drop policy if exists slack_placement_ledger_admin_read on public.slack_placement_ledger;
create policy slack_placement_ledger_admin_read on public.slack_placement_ledger
  for select to authenticated using (public.apex_is_admin());
grant select on public.slack_placement_ledger to authenticated;

insert into public.system_settings(key, value)
values ('slack_placement_cutoff_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 9. Roadmap: Slack no longer gates licensing or contracting. Before this,
--    the license and contracting steps were 'locked' unless a verified Slack
--    identity existed, and 1 of 73 agents had one. v_slack is now a verified
--    link OR the agent's own "I've joined Slack" mark, and an unjoined Slack
--    step is 'available' so it never becomes the "do this now" step ahead of
--    licensing.
-- ---------------------------------------------------------------------------
create or replace function public.apex_agent_onboarding_roadmap(p_agent_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_agent public.agents%rowtype;
  v_name text;
  v_licensed boolean;
  v_slack_verified boolean;
  v_slack boolean;
  v_call boolean;
  v_intake boolean;
  v_contracting boolean;
  v_active_modules integer;
  v_started_modules integer;
  v_passed_modules integer;
  v_training boolean;
  v_dialer boolean;
  v_first_deal boolean;
  v_slack_url text;
  v_call_url text;
  v_steps jsonb := '[]'::jsonb;
  v_done integer := 0;
  v_total integer;
  v_next jsonb;
begin
  if auth.uid() is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'Not permitted to view this onboarding roadmap' using errcode = '42501';
  end if;

  select * into v_agent from public.agents where id = p_agent_id;
  if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;

  select coalesce(nullif(trim(v_agent.display_name), ''), nullif(trim(p.full_name), ''), 'Galaxy agent')
    into v_name
    from public.profiles p
   where p.id = v_agent.profile_id or p.user_id = v_agent.user_id
   order by (p.id = v_agent.profile_id) desc
   limit 1;
  v_name := coalesce(v_name, nullif(trim(v_agent.display_name), ''), 'Galaxy agent');

  v_licensed := v_agent.license_status::text = 'licensed';
  select exists (
    select 1 from public.messaging_identity_links mil
     where mil.agent_id = p_agent_id
       and mil.verification_status = 'verified'
       and mil.revoked_at is null
  ) into v_slack_verified;
  v_slack := v_slack_verified or v_agent.slack_joined_at is not null;
  v_call := public.fn_agent_onboarding_call_booking(p_agent_id) is not null;
  select exists (
    select 1 from public.contracting_intakes ci
     where ci.status in ('accepted', 'completed')
       and (
         ci.agent_id = p_agent_id
         or (v_agent.nipr_number is not null and ci.npn = v_agent.nipr_number)
       )
  ) into v_intake;
  v_contracting := v_call and (v_intake or v_agent.contracted_at is not null);

  select count(*)::int into v_active_modules from public.onboarding_modules where is_active = true;
  select count(*)::int,
         count(*) filter (where p.passed = true or p.completed_at is not null)::int
    into v_started_modules, v_passed_modules
    from public.onboarding_progress p
    join public.onboarding_modules m on m.id = p.module_id and m.is_active = true
   where p.agent_id = p_agent_id;
  v_training := v_agent.onboarding_completed_at is not null
    or (v_active_modules > 0 and v_passed_modules >= v_active_modules);
  v_dialer := coalesce(v_agent.has_dialer_login, false);
  v_first_deal := v_agent.first_deal_at is not null or exists (
    select 1 from public.deals d where d.agent_id = p_agent_id limit 1
  );

  select value into v_slack_url from public.system_settings where key = 'slack_community_invite_url';
  select value into v_call_url from public.system_settings where key = 'onboarding_call_scheduling_url';
  v_slack_url := coalesce(nullif(trim(v_slack_url), ''), 'https://apex-financial.org/dashboard/community');
  v_call_url := coalesce(nullif(trim(v_call_url), ''), 'https://calendly.com/apexfinancialempire/apex-onboarding-call');

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'slack', 'label', 'Join the Galaxy Slack',
    'detail', case
      when v_slack_verified then 'Workspace identity verified. Team support and daily updates are live.'
      when v_slack then 'You marked Slack as joined. Team support and daily updates are in #general.'
      else 'Join the team workspace; your invite was also sent by email. Tap "I''ve joined Slack" once you are in.' end,
    'status', case when v_slack then 'complete' else 'available' end,
    'action_label', case when v_slack then null else 'Join Slack' end,
    'action_url', case when v_slack then null else v_slack_url end
  ));
  if v_slack then v_done := v_done + 1; end if;

  if not v_licensed then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'key', 'license', 'label', 'Finish your licensing roadmap',
      'detail', 'Update course, exam, fingerprint, and license milestones as they happen.',
      'status', 'current',
      'action_label', 'Open licensing roadmap',
      'action_url', '/get-licensed'
    ));
  end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'contracting',
    'label', case when v_call then 'Finish contracting with Milver' else 'Book your Milver onboarding call' end,
    'detail', case
      when v_contracting then 'Milver call booked and native contracting intake received.'
      when not v_call then 'Milver is your Contracting & Onboarding Manager. Book the 30-minute fast-track call.'
      else 'Your Milver call is booked. Submit the native contracting intake to finish this milestone.' end,
    'status', case when v_contracting then 'complete' when v_licensed then 'current' else 'locked' end,
    'action_label', case when v_contracting then null when not v_call then 'Book with Milver' else 'Complete contracting' end,
    'action_url', case when v_contracting or not v_licensed then null when not v_call then v_call_url else '/start-contracting' end
  ));
  if v_contracting then v_done := v_done + 1; end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'training', 'label', 'Complete online onboarding',
    'detail', case when v_training then 'All required onboarding modules are complete.' when v_started_modules > 0 then v_passed_modules || ' of ' || v_active_modules || ' required modules complete.' else 'Watch the Galaxy, script, objections, ReadyMode, pipeline, deal-posting, and underwriting walkthroughs.' end,
    'status', case when v_training then 'complete' when v_contracting then 'current' else 'locked' end,
    'action_label', case when v_training then null else 'Open training' end,
    'action_url', case when v_contracting and not v_training then '/dashboard/recruiting/training/library' else null end
  ));
  if v_training then v_done := v_done + 1; end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'dialer', 'label', 'Get ReadyMode field-ready',
    'detail', case when v_dialer then 'ReadyMode access is confirmed.' else 'Finish the four system walkthroughs and have your manager confirm dialer access.' end,
    'status', case when v_dialer then 'complete' when v_training then 'current' else 'locked' end,
    'action_label', case when v_dialer then null else 'Review ReadyMode training' end,
    'action_url', case when v_training and not v_dialer then '/dashboard/recruiting/training/library' else null end
  ));
  if v_dialer then v_done := v_done + 1; end if;

  v_steps := v_steps || jsonb_build_array(jsonb_build_object(
    'key', 'first_deal', 'label', 'Post your first deal',
    'detail', case when v_first_deal then 'First sale is recorded in the canonical production ledger.' else 'Launch into the field and post the sale immediately so production and commissions update live.' end,
    'status', case when v_first_deal then 'complete' when v_dialer then 'current' else 'locked' end,
    'action_label', case when v_first_deal then null else 'Post a deal' end,
    'action_url', case when v_dialer and not v_first_deal then '/dashboard/production' else null end
  ));
  if v_first_deal then v_done := v_done + 1; end if;

  v_total := jsonb_array_length(v_steps);
  select step into v_next
    from jsonb_array_elements(v_steps) step
   where step->>'status' = 'current'
   limit 1;

  return jsonb_build_object(
    'agent_id', p_agent_id,
    'agent_name', v_name,
    'path', case when v_licensed then 'licensed' else 'unlicensed' end,
    'completed_steps', v_done,
    'total_steps', v_total,
    'progress_percent', case when v_total = 0 then 0 else round(100.0 * v_done / v_total)::int end,
    'next_step_key', v_next->>'key',
    'next_step_label', v_next->>'label',
    'next_step_detail', v_next->>'detail',
    'next_step_url', v_next->>'action_url',
    'next_step_action', v_next->>'action_label',
    'slack_join_source', case when v_slack_verified then 'verified_link' when v_slack then 'self_reported' else null end,
    'contact_name', 'Milver Taca',
    'contact_email', 'milver.taca@gmail.com',
    'steps', v_steps
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Readiness surfaces stop grading a retired requirement. 4 of 76 active
--     agents had has_discord_access, nothing ever set it true, and it inflated
--     "needs setup". admin_team_engagement returns the Slack signal instead
--     (return type changes, so drop + create; grants restored exactly).
-- ---------------------------------------------------------------------------
drop function if exists public.admin_team_engagement();
create function public.admin_team_engagement()
returns table(agent_id uuid, display_name text, email text, phone text, status text, license_status text,
              onboarding_stage text, hired_at timestamp with time zone, manager_name text, has_login boolean,
              last_sign_in_at timestamp with time zone, days_since_login integer,
              portal_email_last_sent_at timestamp with time zone, portal_link_used_at timestamp with time zone,
              discord_sent_at timestamp with time zone, discord_last_error text,
              course_sent_at timestamp with time zone, get_licensed_sent_at timestamp with time zone,
              slack_joined_at timestamp with time zone, slack_joined_source text,
              has_training_course boolean, modules_total integer, modules_completed integer,
              last_module_activity_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  -- discord_sent_at / discord_last_error keep their legacy names: they read
  -- agent_onboarding_queue email_kind 'discord', which is the SLACK invite email
  -- (send-agent-onboarding-email/index.ts, "legacy kind name").
  with q as (
    select agent_id,
           max(sent_at) filter (where email_kind = 'discord') as discord_sent_at,
           max(last_error) filter (where email_kind = 'discord' and sent_at is null) as discord_last_error,
           max(sent_at) filter (where email_kind = 'course') as course_sent_at,
           max(sent_at) filter (where email_kind = 'get_licensed') as get_licensed_sent_at
    from public.agent_onboarding_queue group by agent_id
  ),
  t as (select agent_id, max(created_at) as portal_email_last_sent_at, max(used_at) as portal_link_used_at from public.magic_login_tokens group by agent_id),
  prog as (
    select agent_id,
           count(*) filter (where completed_at is not null or passed) as modules_completed,
           max(greatest(coalesce(completed_at, started_at), started_at)) as last_module_activity_at
    from public.onboarding_progress group by agent_id
  ),
  mods as (select count(*)::integer as modules_total from public.onboarding_modules where coalesce(is_active, true))
  select a.id, a.display_name, coalesce(p.email, u.email), p.phone, a.status::text, a.license_status::text, a.onboarding_stage::text,
    a.created_at, m.display_name, (a.user_id is not null), u.last_sign_in_at,
    case when u.last_sign_in_at is null then null else floor(extract(epoch from (now() - u.last_sign_in_at)) / 86400)::integer end,
    t.portal_email_last_sent_at, t.portal_link_used_at,
    q.discord_sent_at, q.discord_last_error, q.course_sent_at, q.get_licensed_sent_at,
    a.slack_joined_at, a.slack_joined_source, coalesce(a.has_training_course, false),
    (select modules_total from mods), coalesce(prog.modules_completed, 0)::integer, prog.last_module_activity_at
  from public.agents a
  left join public.profiles p on p.id = a.profile_id
  left join auth.users u on u.id = a.user_id
  left join public.agents m on m.id = a.manager_id
  left join q on q.agent_id = a.id
  left join t on t.agent_id = a.id
  left join prog on prog.agent_id = a.id
  where public.has_role(auth.uid(), 'admin'::app_role)
    and coalesce(a.is_deactivated, false) = false
    and a.status::text <> 'terminated'
  order by a.created_at desc
$function$;
revoke all on function public.admin_team_engagement() from public, anon;
grant execute on function public.admin_team_engagement() to authenticated, service_role;

create or replace function public.my_onboarding_roll_call(p_days integer default 14)
returns table(agent_id uuid, display_name text, hired_on date, days_since_hire integer, license_status text,
              onboarding_stage text, manager_name text, email text, phone text, has_login boolean,
              invite_email_sent_on date, email_deliverable boolean, reachable boolean, blocker text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false
    limit 1
  ), scope as (
    select a.id from public.agents a where public.apex_is_admin()
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  ), base as (
    select
      a.id,
      a.display_name,
      a.created_at::date as hired_on,
      (current_date - a.created_at::date)::integer as days_since_hire,
      a.license_status::text as license_status,
      coalesce(a.onboarding_stage::text, 'not_started') as onboarding_stage,
      coalesce(m.display_name, 'Unassigned') as manager_name,
      nullif(btrim(coalesce(p.email, ap.email, '')), '') as email,
      nullif(btrim(coalesce(p.phone, ap.phone, '')), '') as phone,
      (a.user_id is not null) as has_login,
      -- The community invite email IS tracked (queue kind 'discord' is the
      -- legacy name of the SLACK invite email). Whether they joined is the
      -- agent's own slack_joined_at mark or a verified identity link (WP7);
      -- has_discord_access is a retired flag nothing ever set to true.
      (select max(q.sent_at)::date from public.agent_onboarding_queue q
        where q.agent_id = a.id and q.email_kind = 'discord' and q.sent_at is not null)
        as invite_email_sent_on,
      a.slack_joined_at::date as slack_joined_on
    from public.agents a
    left join public.agents m on m.id = a.manager_id
    left join public.profiles p on p.id = a.profile_id
    left join public.applications ap on ap.id = a.source_application_id
    join scope s on s.id = a.id
    where a.status = 'active'
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false
      and a.created_at >= current_date - greatest(coalesce(p_days, 14), 1)
      and not public.fn_agent_is_roster_excluded(a.id)
  )
  select
    b.id, b.display_name, b.hired_on, b.days_since_hire,
    b.license_status, b.onboarding_stage, b.manager_name,
    b.email, b.phone, b.has_login, b.invite_email_sent_on,
    (b.email is not null and split_part(b.email, '@', 2) not in
       ('gmai.com','gmial.com','gmail.co','gmaill.com','yaho.com','hotmial.com','outlok.com','iclou.com')
    ) as email_deliverable,
    (b.email is not null or b.phone is not null) as reachable,
    case
      when b.email is null and b.phone is null then 'no contact on file — only their manager can reach them'
      when b.email is not null and split_part(b.email, '@', 2) in
        ('gmai.com','gmial.com','gmail.co','gmaill.com','yaho.com','hotmial.com','outlok.com','iclou.com')
        then 'email address looks mistyped — mail to it is bouncing'
      when not b.has_login then 'no login yet — account was never provisioned'
      when b.slack_joined_on is not null then 'joined Slack ' || to_char(b.slack_joined_on, 'Mon DD')
      when b.invite_email_sent_on is null then 'never sent the Slack invite'
      else 'Slack invite sent ' || to_char(b.invite_email_sent_on, 'Mon DD') || ', not joined yet'
    end as blocker
  from base b
  order by (b.email is null and b.phone is null) desc, b.hired_on desc, b.display_name;
$function$;


-- ---------------------------------------------------------------------------
-- 11. Weekday #unlicensed digest. Before: the floor counted every open
--     non-licensed application ever (674, 88% older than 90 days); "Nobody
--     moved a step" was printed whenever the course sensor was dark (last
--     course event 2026-09-06); and "Book a call" linked the post-hire
--     onboarding call. Read-only, well under Slack's 40k limit.
-- ---------------------------------------------------------------------------
create or replace function public.fn_unlicensed_slack_digest()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  c_licensing_call constant text := 'https://calendly.com/apexfinancialempire/licensing-call';
  v_call text;
  v_proofs integer := 0;
  v_milestones integer := 0;
  v_moved integer := 0;
  v_course_last timestamptz;
  v_tracking_stale boolean;
  v_lines text := '';
  v_counts text := '';
  v_total60 integer := 0;
  v_new7 integer := 0;
  v_wins text := '';
  r record;
begin
  -- Licensing questions call. Never the post-hire onboarding call and never a
  -- licensed-track call: an unlicensed recruit routed there skips the course.
  select nullif(btrim(value), '') into v_call
    from public.system_settings where key = 'licensing_support_call_url' limit 1;
  v_call := replace(coalesce(v_call, ''), '"', '');
  if v_call = '' or v_call !~* '^https://'
     or v_call ~* '(licensed-prospect|onboarding-call|1on1)' then
    v_call := c_licensing_call;
  end if;

  -- Movement = course receipts uploaded + licensing milestones (incl. license
  -- issued and applicant self-reports), last 24h.
  select count(*) into v_proofs
    from public.licensing_course_proofs where submitted_at >= now() - interval '24 hours';
  select count(*) into v_milestones
    from public.licensing_milestone_events where created_at >= now() - interval '24 hours';
  v_moved := v_proofs + v_milestones;

  if v_proofs > 0 then
    v_lines := v_lines || format('   • %s × course receipt uploaded%s', v_proofs, chr(10));
  end if;
  for r in
    select milestone_type, count(*) as n
    from public.licensing_milestone_events
    where created_at >= now() - interval '24 hours'
    group by milestone_type
    order by count(*) desc
    limit 6
  loop
    v_lines := v_lines || format('   • %s × %s%s', r.n, replace(r.milestone_type, '_', ' '), chr(10));
  end loop;

  -- The course sensor: if no course-type milestone landed in 7 days, silence
  -- means "not tracked", not "nobody moved".
  select max(created_at) into v_course_last
    from public.licensing_milestone_events
   where milestone_type in ('enrolled_course', 'course_halfway', 'completed_course');
  v_tracking_stale := v_course_last is null or v_course_last < now() - interval '7 days';

  -- The floor: last 60 days only.
  for r in
    select coalesce(a.license_progress::text, 'not started') as stage,
           count(*) as n,
           count(*) filter (where a.created_at >= now() - interval '7 days') as n7
    from public.applications a
    where a.created_at >= now() - interval '60 days'
      and a.terminated_at is null and a.contracted_at is null and a.closed_at is null
      and coalesce(a.license_status::text, '') <> 'licensed'
      and coalesce(a.is_duplicate, false) = false
    group by 1 order by count(*) desc
  loop
    v_counts := v_counts || format('   • %s — %s%s', r.n, replace(r.stage, '_', ' '), chr(10));
    v_total60 := v_total60 + r.n;
    v_new7 := v_new7 + r.n7;
  end loop;

  -- Wins: producers licensed in the last 90 days who are already writing.
  -- First name + days + dollars only (team channel rule: no client data).
  for r in
    select split_part(coalesce(nullif(btrim(ag.display_name), ''), 'A teammate'), ' ', 1) as first_name,
           (v_today - (ag.licensed_at at time zone 'America/Phoenix')::date) as days,
           sum(m.annual_premium) as alp
    from public.agents ag
    join public.mat_production_unified m on m.agent_id = ag.id
    where ag.licensed_at >= now() - interval '90 days'
      and ag.license_status::text = 'licensed'
      and ag.status::text = 'active'
      and coalesce(ag.is_deactivated, false) = false
      and coalesce(ag.is_inactive, false) = false
      and m.posted_date >= (ag.licensed_at at time zone 'America/Phoenix')::date
      and lower(coalesce(m.status, '')) not in
          ('lapsed', 'cancelled', 'canceled', 'charged_back', 'chargeback', 'withdrawn', 'not_taken', 'declined', 'terminated')
      and not public.fn_agent_is_roster_excluded(ag.id)
    group by ag.id, ag.display_name, ag.licensed_at
    having sum(m.annual_premium) > 0
    order by sum(m.annual_premium) desc
    limit 3
  loop
    v_wins := v_wins || format('   • %s got licensed %s days ago and has already written %s%s',
      r.first_name, r.days, to_char(r.alp, 'FM$999,999,990'), chr(10));
  end loop;

  return format(
    '*Licensing floor — %s*%s%s%s%s%s',
    to_char(v_today, 'Mon DD'),
    chr(10) || chr(10),
    case
      when v_moved > 0
        then format(':fire: *%s %s forward in the last 24 hours*%s%s%s',
                    v_moved, case when v_moved = 1 then 'step' else 'steps' end, chr(10), v_lines, chr(10))
      when v_tracking_stale
        then ':hourglass_flowing_sand: *Course tracking is catching up: upload your progress in your portal.* '
             || 'Bought the course or finished a section? Put it in your Galaxy portal so the team sees it.' || chr(10) || chr(10)
      else ':warning: *Nobody moved a step in the last 24 hours.* One call, one form, one video — pick the smallest one and do it today.' || chr(10) || chr(10)
    end,
    format('*Last 60 days: %s working toward a license, %s new this week*%s', v_total60, v_new7, chr(10))
      || coalesce(nullif(v_counts, ''), '   • nobody yet' || chr(10)) || chr(10),
    case when v_wins <> ''
      then '*Licensed and already writing*' || chr(10) || v_wins || chr(10)
      else '' end,
    format(':telephone_receiver: *Questions about getting licensed? Book a licensing call:* %s', v_call)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Guard view for apex-doctor drop-in #48. Scalar subqueries only, so it
--     returns exactly one row in every state (it cannot go blank-green).
-- ---------------------------------------------------------------------------
create or replace view public.v_channel_health
with (security_invoker = true)
as
select
  public.fn_discord_paused() as discord_paused,
  (select count(*) from public.system_settings s
    where s.key like 'discord\_webhook\_url%' and btrim(coalesce(s.value, '')) ~* '^https://')::int as discord_keys_set,
  (select count(*) from public.outbox_events o
    where o.destination in ('discord', 'discord_subagency') and o.status in ('pending', 'failed'))::int as discord_outbox_open,
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}'::text[])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~* '(discord_webhook|discord(app)?\.com/api/webhooks|hooks\.slack\.com|discord-webhook-notify|slack-announce|''(discord|discord_subagency|slack)''\s*,)'
      and (p.prosrc ~* '\mnew\.(phone|email)\M'
           or p.prosrc ~* '\mnew\.(first_name|last_name)\s*\|\|'
           or p.prosrc ~* '''(phone|email)''\s*,\s*(new\.|v_|p\.|a\.|ap\.|coalesce\s*\(|nullif\s*\()')
  ) as pii_chat_posters,
  (select coalesce(array_agg(distinct p.proname::text), '{}'::text[])
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_trigger t on t.tgfoid = p.oid and not t.tgisinternal and t.tgenabled <> 'D'
    where n.nspname = 'public'
      and p.prosrc ~* 'net\.http_post'
      and p.prosrc !~* 'exception\s+when'
  ) as unguarded_http_triggers,
  (select max(l.created_at) from public.automation_run_log l where l.job_name = 'slack_unlicensed_welcome') as welcome_last_log_at,
  (select (l.response_body ->> 'members')::int from public.automation_run_log l
    where l.job_name = 'slack_unlicensed_welcome' and l.response_body ? 'members'
    order by l.created_at desc limit 1) as unlicensed_members,
  (select count(*) from public.slack_channel_welcomes w
    where w.channel_id = 'C0BUTAKNB38' and w.welcomed_at >= now() - interval '14 days')::int as unlicensed_joins_14d,
  (select count(distinct lower(e.recipient_email)) from public.email_delivery_log e
    where e.template = 'submit-application-applicant' and e.status = 'sent'
      and e.provider_message_id is not null and e.created_at >= now() - interval '14 days')::int as applicants_emailed_14d,
  (select l.status from public.automation_run_log l
    where l.job_name = 'slack_community_scopes' order by l.created_at desc limit 1) as slack_scope_status,
  (select l.response_body -> 'missing' from public.automation_run_log l
    where l.job_name = 'slack_community_scopes' order by l.created_at desc limit 1) as slack_scope_missing,
  (select max(l.created_at) from public.automation_run_log l where l.job_name = 'slack_community_scopes') as slack_scope_checked_at,
  (select count(*) from public.channel_deprovision_queue q
    where q.status = 'pending' and not ('slack' = any (coalesce(q.channels, '{}'::text[]))))::int as deprov_pending_without_slack,
  (select count(*) from public.channel_deprovision_queue q where q.status = 'pending')::int as deprov_pending,
  now() as measured_at;

revoke all on public.v_channel_health from public, anon, authenticated;
grant select on public.v_channel_health to service_role;

-- ---------------------------------------------------------------------------
-- 13. Daily Slack integration health (it existed, but only ever ran once by
--     hand). run_automation_job sends the service-role bearer the function
--     accepts. One row per day in automation_run_log; never pages anyone.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'apex-slack-integration-health') then
    perform cron.unschedule('apex-slack-integration-health');
  end if;
  perform cron.schedule(
    'apex-slack-integration-health',
    '35 13 * * *',
    $cmd$select public.run_automation_job('apex-slack-integration-health', 'slack-integration-health', '{}'::jsonb);$cmd$
  );
end $$;
