-- PL-WIB-SEND-ADMIN-EMAIL-AUTH (2026-10-08). Hand-applied via bot-sql before the
-- send-admin-email gate was pushed, so there was no window where the gate refused
-- a real caller; CREATE OR REPLACE makes the CI re-apply a no-op.
--
-- These four are every pg function that posts to send-admin-email. All four sent
-- system_settings.supabase_anon_key, which ships in the browser bundle and which
-- requireSendAuth refuses. Only the send-admin-email call changes: it now sends
-- system_settings.service_role_key (v_email_key). The send-sms-auto-detect call
-- keeps the anon JWT because that function is verify_jwt = true and the gateway
-- does not accept an sb_secret key as a JWT.
--
-- notify_sam_on_licensing_milestone is live (trigger trg_notify_sam_licensing on
-- applications). The three digests are scheduled by no cron job today; they are
-- switched too so re-scheduling one cannot 401 in silence.
--
-- Bodies are pg_get_functiondef() of the live functions after the swap, not a
-- reconstruction from older migrations (supabase/migrations does not model
-- functions that were hand-applied).

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
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  -- PL-WIB-SEND-ADMIN-EMAIL-AUTH: send-admin-email refuses the anon key (it ships in
  -- the browser bundle). The SMS leg keeps the anon JWT: send-sms-auto-detect is
  -- verify_jwt=true and the gateway does not take an sb_secret key as a JWT.
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
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  -- PL-WIB-SEND-ADMIN-EMAIL-AUTH: send-admin-email refuses the anon key (it ships in
  -- the browser bundle). The SMS leg keeps the anon JWT: send-sms-auto-detect is
  -- verify_jwt=true and the gateway does not take an sb_secret key as a JWT.
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
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  -- PL-WIB-SEND-ADMIN-EMAIL-AUTH: send-admin-email refuses the anon key (it ships in
  -- the browser bundle). The SMS leg keeps the anon JWT: send-sms-auto-detect is
  -- verify_jwt=true and the gateway does not take an sb_secret key as a JWT.
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
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  -- PL-WIB-SEND-ADMIN-EMAIL-AUTH: send-admin-email refuses the anon key (it ships in
  -- the browser bundle). The SMS leg keeps the anon JWT: send-sms-auto-detect is
  -- verify_jwt=true and the gateway does not take an sb_secret key as a JWT.
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

