-- PL-WIB-PG-ANON-BEARER
--
-- Eleven SECURITY DEFINER functions read system_settings.supabase_anon_key and
-- sent it as the Bearer on a pg_net call to a gated edge function. Measured
-- 2026-10-09 with an empty body, so nothing could send:
--
--   send-sms-auto-detect    anon -> 401 UNAUTHORIZED_LEGACY_JWT (gateway)
--                           service_role_key -> 400 "phone and message are required"
--   send-notification       anon -> 401 (requireSendAuth)   service -> 400 body
--   send-agent-portal-login anon -> 401                     service -> 401
--
-- 20261008050000 kept the SMS legs on the anon JWT on the belief that the
-- gateway would not take the sb_secret key under verify_jwt=true. The second
-- row above shows the opposite, so those legs were the ones that could not land.
--
-- Reach, read off pg_trigger / cron.job / pg_proc / EXECUTE grants / src rpc():
--   LIVE  notify_sam_on_licensing_milestone  (trg_notify_sam_licensing on
--         applications). Its email leg delivered; its SMS leg to Sam was
--         refused at the gateway, while bot_alerts stamps sent_at at insert.
--   LIVE  auto_kickoff_new_licensee  (trg_auto_kickoff_new_licensee). Its
--         portal-login leg could never send: the endpoint takes only a signed-in
--         admin/manager JWT and reads agentId, and this posted applicant_id+email.
--         Retired here; the Discord leg is unchanged.
--   UNREACHED  the other nine. No trigger, no cron job, no pg caller, no
--         anon/authenticated EXECUTE, no src rpc(). Re-keyed so that scheduling
--         one later does not ship a call that 401s and is read by nothing.
--
-- Not touched: applicant_login_fire -> applicant-magic-link and
-- fn_next_step_messages_auto_dispatch -> next-step-dispatch. Both targets are
-- verify_jwt=false and answer the anon pg_net call 200 in 24h edge logs.
-- run_automation_job already prefers service_role_key.
--
-- CREATE OR REPLACE keeps owner and ACL. Each body below is the live
-- pg_get_functiondef with only the key read (and its stale comment) changed.

CREATE OR REPLACE FUNCTION public.notify_sam_on_licensing_milestone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_email_key text;
  v_label text;
  v_sms text;
  v_html text;
  v_name text;
BEGIN
  IF NEW.license_progress IS NOT DISTINCT FROM OLD.license_progress THEN RETURN NEW; END IF;

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  -- PL-WIB-PG-ANON-BEARER: every leg presents the service key. The anon JWT in
  -- system_settings is refused by the gateway (401 UNAUTHORIZED_LEGACY_JWT,
  -- measured 2026-10-09), and the service key passes verify_jwt=true there.
  SELECT value INTO v_email_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  v_name := COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'');

  v_label := CASE NEW.license_progress::text
    WHEN 'course_purchased'    THEN '📚 Started course'
    WHEN 'finished_course'     THEN '🎓 Finished course — schedule exam'
    WHEN 'test_scheduled'      THEN '🗓️ Exam scheduled'
    WHEN 'passed_test'         THEN '🔥 PASSED exam — fingerprints next'
    WHEN 'fingerprints_done'   THEN '🖐️ Fingerprints done — waiting on state'
    WHEN 'waiting_on_license'  THEN '⏳ State processing license'
    WHEN 'licensed'            THEN '✅ LICENSED — field-ready'
    ELSE NULL
  END;

  IF v_label IS NULL THEN RETURN NEW; END IF;

  v_sms := format('APEX %s: %s (%s)', v_label, v_name, COALESCE(NEW.state,''));
  v_html := format(
    '<p><strong>%s</strong></p><p>%s</p><p>Email: %s<br/>Phone: %s<br/>State: %s</p><p>Open: <a href="https://apex-financial.org/dashboard/hiring-pipeline">Hiring Pipeline</a></p>',
    v_label, v_name, COALESCE(NEW.email,'—'), COALESCE(NEW.phone,'—'), COALESCE(NEW.state,'—'));

  IF v_svc_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-sms-auto-detect',
      body := jsonb_build_object('phone','4697676068','message', v_sms),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-admin-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('%s — %s', v_label, v_name),
        'html', v_html),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_email_key,'apikey', v_email_key));
  END IF;

  INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, channels, sent_at)
  VALUES ('trigger', 'licensing_milestone', 'info',
          format('%s — %s', v_label, v_name), v_sms,
          ARRAY['sms','email']::text[], now());

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_kickoff_new_licensee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_svc_url text;
  v_webhook text;
BEGIN
  -- Only fire on the exact transition to 'licensed'
  IF NEW.license_progress IS DISTINCT FROM 'licensed' THEN RETURN NEW; END IF;
  IF OLD.license_progress IS NOT DISTINCT FROM 'licensed' THEN RETURN NEW; END IF;

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  -- PL-WIB-PG-ANON-BEARER: the portal-login leg that sat here is retired. It
  -- POSTed {applicant_id, email} to send-agent-portal-login with the anon key;
  -- that endpoint takes only a signed-in admin/manager JWT and reads agentId, so
  -- it answered 401 to the anon key AND to the service key. It could not send.
  -- Staff send the login link from /recruit-pipeline and /dashboard/team.

  -- 2. Welcome Discord post (competitive tone — other agents see it)
  IF v_webhook IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_webhook,
      body := jsonb_build_object(
        'username', 'APEX New Licensee',
        'content', format(
          E'🎓 **%s %s just got licensed.** Field-ready as of %s. Who beats them to the first deal?',
          COALESCE(NEW.first_name,'Agent'), COALESCE(NEW.last_name,''),
          to_char(NOW(), 'Mon DD'))
      ),
      headers := jsonb_build_object('Content-Type','application/json'));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dm_overnight_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_email_key text;
  v_inbound_count int;
  v_replied_count int;
  v_hot_count int;
  v_skipped_count int;
  v_body text;
  v_window_hours int := 14;  -- "overnight" = last 14h since 7am-prior-day
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  -- PL-WIB-PG-ANON-BEARER: every leg presents the service key. The anon JWT in
  -- system_settings is refused by the gateway (401 UNAUTHORIZED_LEGACY_JWT,
  -- measured 2026-10-09), and the service key passes verify_jwt=true there.
  SELECT value INTO v_email_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  SELECT COUNT(*) FILTER (WHERE direction = 'inbound')::int,
         COUNT(*) FILTER (WHERE direction = 'outbound')::int,
         COUNT(*) FILTER (WHERE direction = 'inbound' AND lead_score >= 70)::int,
         COUNT(*) FILTER (WHERE direction = 'inbound' AND auto_replied = false)::int
  INTO v_inbound_count, v_replied_count, v_hot_count, v_skipped_count
  FROM public.inbox_messages
  WHERE created_at > NOW() - (v_window_hours || ' hours')::interval;

  IF v_inbound_count = 0 THEN
    RETURN jsonb_build_object('inbound', 0, 'skipped', 'no_inbound');
  END IF;

  -- Build the digest HTML: top hot leads + sample replies + skipped list
  WITH hot AS (
    SELECT sender_handle, sender_name, body AS msg, intent, lead_score, created_at
    FROM public.inbox_messages
    WHERE direction = 'inbound'
      AND lead_score >= 70
      AND created_at > NOW() - (v_window_hours || ' hours')::interval
    ORDER BY lead_score DESC, created_at DESC
    LIMIT 10
  ),
  skipped AS (
    SELECT sender_handle, body AS msg, intent, created_at
    FROM public.inbox_messages
    WHERE direction = 'inbound'
      AND auto_replied = false
      AND intent NOT IN ('spam', 'not_interested')
      AND created_at > NOW() - (v_window_hours || ' hours')::interval
    ORDER BY created_at DESC
    LIMIT 5
  ),
  hot_html AS (
    SELECT string_agg(format(
      '<div style="margin:8px 0;padding:10px;background:#f8fafc;border-left:3px solid #10b981;border-radius:4px"><strong>%s</strong> · <span style="color:#10b981;font-weight:700">tier %s</span> · <span style="color:#64748b;font-size:12px">%s</span><br/><span style="color:#0f172a">%s</span></div>',
      COALESCE(NULLIF(sender_name,''), sender_handle, 'unknown'),
      lead_score,
      to_char(created_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'),
      LEFT(msg, 200)), '') AS html
    FROM hot
  ),
  skipped_html AS (
    SELECT string_agg(format(
      '<div style="margin:6px 0;padding:8px;background:#fef9c3;border-radius:4px;font-size:13px"><strong>%s</strong> said: "%s" <span style="color:#854d0e">(intent: %s, no auto-reply fired)</span></div>',
      COALESCE(sender_handle, 'unknown'),
      LEFT(msg, 120),
      intent), '') AS html
    FROM skipped
  )
  SELECT format(
    '<h2 style="margin:0 0 8px 0">DM digest — overnight</h2>'
    '<p style="color:#64748b;margin:0 0 16px 0">%s inbound · %s auto-replies fired · %s hot leads (≥70) · %s needed your manual touch</p>'
    '<h3 style="color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px">🔥 Hot leads (call these first)</h3>'
    '%s'
    '<h3 style="color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-top:24px">⚠️ Got past the auto-replier — needs you</h3>'
    '%s'
    '<p style="margin-top:24px"><a href="https://apex-financial.org/dashboard/inbox" style="color:#0ea5e9">Open inbox →</a></p>',
    v_inbound_count, v_replied_count, v_hot_count, v_skipped_count,
    COALESCE((SELECT html FROM hot_html), '<p style="color:#64748b">no hot leads tonight</p>'),
    COALESCE((SELECT html FROM skipped_html), '<p style="color:#64748b">none — auto-replier covered everything</p>')
  ) INTO v_body;

  IF v_svc_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-admin-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('💬 DM digest · %s overnight (%s hot)', v_inbound_count, v_hot_count),
        'html', v_body),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_email_key,'apikey', v_email_key));

    -- SMS only if there are HOT leads worth waking up to
    IF v_hot_count > 0 THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-sms-auto-detect',
        body := jsonb_build_object(
          'phone','4697676068',
          'message', format('APEX 💬 %s DMs overnight, %s hot leads — check email for chase list.', v_inbound_count, v_hot_count)),
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'inbound', v_inbound_count,
    'replied', v_replied_count,
    'hot', v_hot_count,
    'needs_manual', v_skipped_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.stuck_applicants_daily_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_email_key text;
  v_count int;
  v_body text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  -- PL-WIB-PG-ANON-BEARER: every leg presents the service key. The anon JWT in
  -- system_settings is refused by the gateway (401 UNAUTHORIZED_LEGACY_JWT,
  -- measured 2026-10-09), and the service key passes verify_jwt=true there.
  SELECT value INTO v_email_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  WITH stuck AS (
    SELECT first_name, last_name, email, phone, license_progress,
      EXTRACT(DAY FROM NOW() - COALESCE(last_response_at, updated_at, created_at))::int AS days_stuck,
      CASE license_progress::text
        WHEN 'course_purchased' THEN 'In course'
        WHEN 'finished_course'  THEN 'Course done — no exam scheduled'
        WHEN 'test_scheduled'   THEN 'Exam scheduled — not passed'
        WHEN 'passed_test'      THEN 'Passed — no fingerprints'
        WHEN 'fingerprints_done' THEN 'Fingerprints done — no license'
        ELSE 'Unknown stage'
      END AS stage_label
    FROM public.applications
    WHERE terminated_at IS NULL
      AND status NOT IN ('rejected','approved')
      AND license_progress IN ('course_purchased','finished_course','test_scheduled','passed_test','fingerprints_done')
      AND COALESCE(last_response_at, updated_at, created_at) < NOW() - INTERVAL '5 days'
    ORDER BY days_stuck DESC
    LIMIT 25
  )
  SELECT COUNT(*)::int,
    string_agg(format('• <b>%s %s</b> — %s <i>(%s days)</i><br/>&nbsp;&nbsp;%s · %s',
      first_name, last_name, stage_label, days_stuck,
      COALESCE(phone,'no phone'), COALESCE(email,'no email')), E'<br/><br/>')
  INTO v_count, v_body FROM stuck;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('count', 0, 'skipped','none_stuck');
  END IF;

  IF v_svc_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-admin-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('🚧 %s applicants stuck 5+ days — chase list', v_count),
        'html', format('<p>Here''s who stalled in licensing 5+ days. One phone call unsticks each one.</p><p>%s</p><p><a href="https://apex-financial.org/dashboard/hiring-pipeline">Open pipeline</a></p>', v_body)),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_email_key,'apikey', v_email_key));
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-sms-auto-detect',
      body := jsonb_build_object(
        'phone','4697676068',
        'message', format('APEX 🚧 %s applicants stuck 5d+ in licensing. Check email for chase list.', v_count)),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
  END IF;

  RETURN jsonb_build_object('count', v_count, 'emailed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.manager_daily_accountability()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  v_svc_url text;
  v_svc_key text;
  v_email_key text;
  v_fired int := 0;
  v_stuck_body text;
  v_stuck_count int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  -- PL-WIB-PG-ANON-BEARER: every leg presents the service key. The anon JWT in
  -- system_settings is refused by the gateway (401 UNAUTHORIZED_LEGACY_JWT,
  -- measured 2026-10-09), and the service key passes verify_jwt=true there.
  SELECT value INTO v_email_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  FOR m IN
    SELECT DISTINCT hma.manager_user_id AS user_id, p.email, p.full_name
    FROM public.hiring_manager_assignments hma
    JOIN public.profiles p ON p.user_id = hma.manager_user_id
    WHERE p.email IS NOT NULL AND hma.is_active = true
  LOOP
    WITH stuck AS (
      SELECT a.first_name, a.last_name, a.license_progress,
             EXTRACT(DAY FROM NOW() - COALESCE(a.last_contacted_at, a.created_at))::int AS days
      FROM public.applications a
      WHERE a.hiring_manager_user_id = m.user_id::uuid
        AND a.terminated_at IS NULL
        AND a.status NOT IN ('rejected','approved')
        AND a.license_progress != 'licensed'
        AND COALESCE(a.last_contacted_at, a.created_at) < NOW() - INTERVAL '5 days'
      ORDER BY COALESCE(a.last_contacted_at, a.created_at) ASC
      LIMIT 10
    )
    SELECT COUNT(*)::int,
           string_agg(format('• %s %s (%s · %s days silent)',
             COALESCE(first_name,''), COALESCE(last_name,''),
             COALESCE(license_progress::text,'unlicensed'), days), E'\n')
    INTO v_stuck_count, v_stuck_body FROM stuck;

    IF v_stuck_count = 0 THEN CONTINUE; END IF;

    IF v_svc_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-admin-email',
        body := jsonb_build_object(
          'to', m.email,
          'subject', format('🎯 %s — your %s stuck applicants today',
            split_part(m.full_name,' ',1), v_stuck_count),
          'html', format(
            E'<p>Hey %s,</p><p>Here''s who on your desk has gone silent 5+ days. Pick up the phone — momentum dies when people don''t hear from you.</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap">%s</pre><p>— APEX Ops</p>',
            split_part(m.full_name,' ',1), v_stuck_body)),
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer '||v_email_key,'apikey', v_email_key));
    END IF;

    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object('managers_emailed', v_fired);
END;
$function$;

CREATE OR REPLACE FUNCTION public.in_course_peer_pressure()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_svc_url text;
  v_svc_key text;
  v_active_peers int;
  v_nudged int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';  -- PL-WIB-PG-ANON-BEARER: was the anon JWT, refused 401
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  -- How many other applicants are actively working their license right now?
  -- Simplified from 'responded in last 3 days' (last_response_at is rarely
  -- populated) to 'currently in a licensing stage' — more accurate.
  SELECT COUNT(*)::int INTO v_active_peers
  FROM public.applications
  WHERE license_progress IN ('course_purchased','finished_course','test_scheduled','passed_test')
    AND terminated_at IS NULL;

  FOR r IN
    SELECT id, first_name, phone, course_purchased_at
    FROM public.applications
    WHERE terminated_at IS NULL
      AND license_progress = 'course_purchased'
      AND phone IS NOT NULL
      AND COALESCE(last_contacted_at, course_purchased_at, created_at) < NOW() - INTERVAL '5 days'
      AND COALESCE(course_purchased_at, created_at) < NOW() - INTERVAL '7 days'  -- give them a full week grace
    LIMIT 50
  LOOP
    -- Guard: never send "0 other recruits" (demoralizing) or fire when keys missing
    IF v_svc_key IS NOT NULL AND v_active_peers > 0 THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-sms-auto-detect',
        body := jsonb_build_object(
          'phone', r.phone,
          'message', format(
            '%s — %s other APEX recruits are working their license with you. Course bought %s days ago — two hours tonight puts you back in the pack. Reply here for help.',
            COALESCE(NULLIF(r.first_name,''),'Hey'),
            v_active_peers,
            EXTRACT(DAY FROM NOW() - r.course_purchased_at)::int)),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,
          'apikey', v_svc_key)
      );
    END IF;

    UPDATE public.applications SET last_contacted_at = NOW() WHERE id = r.id;
    v_nudged := v_nudged + 1;
  END LOOP;

  RETURN jsonb_build_object('nudged', v_nudged, 'active_peers_mentioned', v_active_peers);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rescue_stale_applications()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_svc_url text;
  v_svc_key text;
  v_nudged int := 0;
  v_closed int := 0;
  v_days_since int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';  -- PL-WIB-PG-ANON-BEARER: was the anon JWT, refused 401
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  FOR r IN
    SELECT id, first_name, last_name, email, phone, license_progress,
           created_at, last_contacted_at
    FROM public.applications
    WHERE terminated_at IS NULL
      AND status NOT IN ('rejected','approved')
      AND license_progress != 'licensed'
      AND COALESCE(last_contacted_at, created_at) < NOW() - INTERVAL '14 days'
    ORDER BY COALESCE(last_contacted_at, created_at) ASC
    LIMIT 150
  LOOP
    v_days_since := EXTRACT(DAY FROM NOW() - COALESCE(r.last_contacted_at, r.created_at))::int;

    -- 14, 21, 30-day ladder. 45+ days: auto-close with 'no_pickup'.
    IF v_days_since >= 45 THEN
      UPDATE public.applications
      SET status = 'no_pickup',
          last_contacted_at = NOW(),
          updated_at = NOW()
      WHERE id = r.id;
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    -- Fire re-engagement via send-sms-auto-detect (anon-key auth OK on our
    -- verify_jwt=false edge functions).
    IF r.phone IS NOT NULL AND v_svc_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-sms-auto-detect',
        body := jsonb_build_object(
          'phone', r.phone,
          'message', format(
            '%s — Sam at APEX. Still interested in your license? We cover the course fee. Reply YES or tap https://apex-financial.org/reapply?app=%s',
            COALESCE(NULLIF(r.first_name,''), 'Hey'),
            r.id)
        ),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,
          'apikey', v_svc_key
        )
      );
    END IF;

    UPDATE public.applications SET last_contacted_at = NOW() WHERE id = r.id;
    v_nudged := v_nudged + 1;
  END LOOP;

  RETURN jsonb_build_object('nudged', v_nudged, 'auto_closed', v_closed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nudge_day2_not_enrolled()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'nudge_day2_xcel_enroll_2026_04_23';
  v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';  -- PL-WIB-PG-ANON-BEARER: was the anon JWT, refused 401

  FOR v_row IN
    SELECT a.id, a.first_name, a.email
    FROM public.applications a
    LEFT JOIN public.xcel_progress xp ON LOWER(xp.student_email) = LOWER(a.email)
    WHERE a.created_at BETWEEN now() - interval '72 hours' AND now() - interval '36 hours'
      AND a.terminated_at IS NULL
      AND a.status IN ('new','no_pickup','reviewing')
      AND a.license_status <> 'licensed'
      AND a.email IS NOT NULL AND a.email <> ''
      AND xp.student_email IS NULL   -- never enrolled in XCEL
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(a.email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent')
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', 'Still thinking about getting licensed?',
        'message', format(
          $h$Hey %s,<br><br>
You applied to APEX a couple days ago but I don''t see you enrolled in the licensing course yet. That''s the one step that stands between you and your first paid week.<br><br>
<strong>One click. Apex covers the course.</strong><br><br>
<a href="https://partners.xcelsolutions.com/afe" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px;font-size:16px">Enroll in XCEL now</a><br><br>
The state exam is simpler than you think. Most of our unlicensed hires pass on their first try and are writing deals inside 30 days.<br><br>
Stuck? Call me: <a href="tel:+14697676068">(469) 767-6068</a><br><br>
— Sam$h$, COALESCE(NULLIF(TRIM(v_row.first_name),''),'there'))),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.email, 'email', 'Still thinking about getting licensed?', 'day-2 nudge', 'sent',
      jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id));
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END $function$;

CREATE OR REPLACE FUNCTION public.nudge_day4_not_enrolled()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'nudge_day4_xcel_enroll_2026_04_23';
  v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';  -- PL-WIB-PG-ANON-BEARER: was the anon JWT, refused 401

  FOR v_row IN
    SELECT a.id, a.first_name, a.email
    FROM public.applications a
    LEFT JOIN public.xcel_progress xp ON LOWER(xp.student_email) = LOWER(a.email)
    WHERE a.created_at BETWEEN now() - interval '120 hours' AND now() - interval '84 hours'
      AND a.terminated_at IS NULL
      AND a.status IN ('new','no_pickup','reviewing')
      AND a.license_status <> 'licensed'
      AND a.email IS NOT NULL AND a.email <> ''
      AND xp.student_email IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(a.email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent')
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', 'Last nudge before I call you',
        'message', format(
          $h$%s,<br><br>
Day 4. Still no XCEL enrollment. I''m going to call you tomorrow — this is heads-up so you''re not blindsided when my number (469-767-6068) shows up on your phone.<br><br>
Simpler path: beat me to it. Pick up the course link right now and I''ll switch the call from "where are you?" to "welcome in."<br><br>
<a href="https://partners.xcelsolutions.com/afe" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">Enroll now</a><br><br>
— Sam$h$, COALESCE(NULLIF(TRIM(v_row.first_name),''),'Hey'))),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.email, 'email', 'Last nudge before I call you', 'day-4 nudge', 'sent',
      jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id));
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END $function$;

CREATE OR REPLACE FUNCTION public.send_completion_contracting_handoff()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'xcel_completion_contracting_handoff';
  v_fired int := 0; v_admin_names text := '';
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';  -- PL-WIB-PG-ANON-BEARER: was the anon JWT, refused 401

  FOR v_row IN
    SELECT DISTINCT ON (e.student_email)
      e.student_email, e.student_name, e.state_line, e.event_at
    FROM public.xcel_events e
    LEFT JOIN public.applications app ON LOWER(app.email) = LOWER(e.student_email)
    WHERE e.kind = 'completion'
      AND e.event_at > now() - interval '24 hours'
      AND (app.status IS NULL OR app.status NOT IN ('contracting','rejected'))
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(e.student_email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent')
    ORDER BY e.student_email, e.event_at DESC
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object(
        'email', v_row.student_email,
        'title', 'Course complete — let''s get you contracted',
        'message', format(
          $h$Hey %s,<br><br>
You just finished your %s course. Real respect — most don''t.<br><br>
<strong>What''s next, in order:</strong><br>
1. Book your state exam (if not done) — takes 15 min to schedule<br>
2. Sign your SureLC contracting paperwork — I''ll email you the packet today<br>
3. First deal within 30 days (you''ll be writing before the license hits your mailbox)<br><br>
<a href="tel:+14697676068" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">📞 Call me to schedule the exam: (469) 767-6068</a><br><br>
Don''t let momentum die here.<br><br>
— Sam$h$,
          COALESCE(NULLIF(TRIM(split_part(v_row.student_name,' ',1)),''),'there'),
          COALESCE(v_row.state_line,'course'))),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.student_email, 'email', 'Course complete — let''s get you contracted', 'completion handoff', 'sent',
      jsonb_build_object('campaign', v_campaign, 'state_line', v_row.state_line));

    v_admin_names := v_admin_names || '• ' || COALESCE(v_row.student_name, v_row.student_email) ||
                     ' · ' || COALESCE(v_row.state_line,'') || E'\n';
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;

  -- Admin alert to #hiring when there's someone to contract
  IF v_fired > 0 THEN
    PERFORM public.discord_route(
      'xcel_completion_handoff', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'hiring',
      jsonb_build_object('username','APEX · Course Done',
        'content', format(E'🎓 **%s just finished their XCEL course** — contact them TODAY before momentum dies:\n\n%s\n\nSend the SureLC packet + schedule the state exam.', v_fired, v_admin_names)));
  END IF;

  RETURN jsonb_build_object('handed_off', v_fired);
END $function$;

CREATE OR REPLACE FUNCTION public.weekly_xcel_progress_emails()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'weekly_xcel_progress';
  v_pct int; v_msg text;
  v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';  -- PL-WIB-PG-ANON-BEARER: was the anon JWT, refused 401

  FOR v_row IN
    SELECT xp.student_email, xp.student_name, xp.total_courses, xp.completed,
           xp.in_progress, xp.past_due, xp.due_soon
    FROM public.xcel_progress xp
    WHERE xp.total_courses > 0
      AND xp.completed < xp.total_courses
      -- Only one weekly send per student per 6 days
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(xp.student_email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent'
          AND nl.created_at > now() - interval '6 days')
  LOOP
    v_pct := (v_row.completed * 100) / GREATEST(v_row.total_courses, 1);
    v_msg := format(
      $h$Hey %s,<br><br>
Quick check-in on your XCEL progress:<br><br>
<table cellpadding="6" style="font-size:14px;border-collapse:collapse">
<tr><td><strong>Completion:</strong></td><td>%s%% (%s of %s courses)</td></tr>
<tr><td><strong>In progress:</strong></td><td>%s</td></tr>
<tr><td style="color:#dc2626"><strong>Past due:</strong></td><td style="color:#dc2626">%s</td></tr>
<tr><td style="color:#d97706"><strong>Due soon:</strong></td><td style="color:#d97706">%s</td></tr>
</table><br>
%s<br><br>
Keep going: <a href="https://partners.xcelsolutions.com/afe">continue the course</a><br>
Stuck? Call me: <a href="tel:+14697676068">(469) 767-6068</a><br><br>
— Sam$h$,
      COALESCE(NULLIF(TRIM(split_part(v_row.student_name,' ',1)),''),'there'),
      v_pct, v_row.completed, v_row.total_courses,
      v_row.in_progress, v_row.past_due, v_row.due_soon,
      CASE
        WHEN v_row.past_due > 0 THEN 'You''ve got past-due items. Knock one out today before you lose momentum.'
        WHEN v_pct >= 75       THEN 'You''re closer than most people get. Finish this week.'
        WHEN v_pct >= 50       THEN 'Halfway there. Don''t let it sit.'
        ELSE                         'Block 30 minutes today. Progress compounds.'
      END);

    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object('email', v_row.student_email, 'title', 'Your XCEL progress — week check-in', 'message', v_msg),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.student_email, 'email', 'Your XCEL progress — week check-in', 'weekly xcel progress', 'sent',
      jsonb_build_object('campaign', v_campaign, 'completion_pct', v_pct));
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END $function$;
