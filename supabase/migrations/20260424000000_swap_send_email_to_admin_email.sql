-- Swap send-email → send-admin-email in hiring-pipeline notification
-- functions. send-email is registered in config.toml but Lovable's deploy
-- pipeline has been sitting on the function for multiple commits without
-- shipping it; send-admin-email is live and identical for our purposes
-- (thin Resend wrapper). This unblocks:
--   • notify_sam_on_licensing_milestone (trigger fire on stage change)
--   • stuck_applicants_daily_digest (9am CDT weekday cron)
--   • manager_daily_accountability (8am CDT weekday cron)
--
-- Applied via bot-sql as a dynamic pg_get_functiondef + replace. This
-- migration re-defines them explicitly so a rebuild preserves the swap.

-- 1. notify_sam_on_licensing_milestone
CREATE OR REPLACE FUNCTION public.notify_sam_on_licensing_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_label text;
  v_sms text;
  v_html text;
  v_name text;
BEGIN
  IF NEW.license_progress IS NOT DISTINCT FROM OLD.license_progress THEN RETURN NEW; END IF;

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://msydzhzolwourcdmqxvn.supabase.co'; END IF;

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
        'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
  END IF;

  INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, channels, sent_at)
  VALUES ('trigger', 'licensing_milestone', 'info',
          format('%s — %s', v_label, v_name), v_sms,
          ARRAY['sms','email']::text[], now());

  RETURN NEW;
END;
$body$;

-- 2. stuck_applicants_daily_digest
CREATE OR REPLACE FUNCTION public.stuck_applicants_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_count int;
  v_body text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://msydzhzolwourcdmqxvn.supabase.co'; END IF;

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
        'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
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
$body$;

-- 3. manager_daily_accountability
CREATE OR REPLACE FUNCTION public.manager_daily_accountability()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  m record;
  v_svc_url text;
  v_svc_key text;
  v_fired int := 0;
  v_stuck_body text;
  v_stuck_count int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://msydzhzolwourcdmqxvn.supabase.co'; END IF;

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
          'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
    END IF;

    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object('managers_emailed', v_fired);
END;
$body$;
