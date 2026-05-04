-- Hiring pipeline v2 — auto-notify Sam on every key transition + stuck-
-- applicant daily sweep + peer-pressure nudges for conversion boost.
--
-- Why: Sam is scaling hiring hard. He can't check the pipeline 50 times
-- a day. These hooks push to him (SMS + email) the moments that matter,
-- and push applicants themselves when they stall.

-- ───────────────────────────────────────────────────────────────────────
-- #1 Trigger: applicant hits a course milestone → Sam gets SMS + email
-- ───────────────────────────────────────────────────────────────────────
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
  -- Fire only on actual stage-progression transitions
  IF NEW.license_progress IS NOT DISTINCT FROM OLD.license_progress THEN RETURN NEW; END IF;

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
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

  IF v_label IS NULL THEN RETURN NEW; END IF;  -- non-milestone transition

  v_sms := format('APEX %s: %s (%s)', v_label, v_name, COALESCE(NEW.state,''));
  v_html := format(
    '<p><strong>%s</strong></p><p>%s</p><p>Email: %s<br/>Phone: %s<br/>State: %s</p><p>Open: <a href="https://apex-financial.org/dashboard/hiring-pipeline">Hiring Pipeline</a></p>',
    v_label, v_name,
    COALESCE(NEW.email,'—'),
    COALESCE(NEW.phone,'—'),
    COALESCE(NEW.state,'—'));

  IF v_svc_key IS NOT NULL THEN
    -- SMS to Sam
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-sms-auto-detect',
      body := jsonb_build_object('phone','4697676068','message', v_sms),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,
        'apikey', v_svc_key)
    );
    -- Email to Sam
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('%s — %s', v_label, v_name),
        'html', v_html),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,
        'apikey', v_svc_key)
    );
  END IF;

  -- Log to notifications queue so we can verify in the UI
  INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, channels, sent_at)
  VALUES ('trigger', 'licensing_milestone', 'info',
          format('%s — %s', v_label, v_name), v_sms,
          ARRAY['sms','email']::text[], now());

  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_notify_sam_licensing ON public.applications;
CREATE TRIGGER trg_notify_sam_licensing
  AFTER UPDATE OF license_progress ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_sam_on_licensing_milestone();

-- ───────────────────────────────────────────────────────────────────────
-- #2 Daily sweep: applicants stuck >= 5 days in their current stage
-- Runs 14:00 UTC (9am CDT) weekdays. Single email digest to Sam listing
-- who's stuck where, so he can choose who to chase.
-- ───────────────────────────────────────────────────────────────────────
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
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  WITH stuck AS (
    SELECT
      first_name, last_name, email, phone, license_progress,
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
  INTO v_count, v_body
  FROM stuck;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('count', 0, 'skipped','none_stuck');
  END IF;

  IF v_svc_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('🚧 %s applicants stuck 5+ days — chase list', v_count),
        'html', format('<p>Here''s who stalled in licensing 5+ days. One phone call unsticks each one.</p><p>%s</p><p><a href="https://apex-financial.org/dashboard/hiring-pipeline">Open pipeline</a></p>', v_body)),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,
        'apikey', v_svc_key)
    );
    -- SMS summary
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-sms-auto-detect',
      body := jsonb_build_object(
        'phone','4697676068',
        'message', format('APEX 🚧 %s applicants stuck 5d+ in licensing. Check email for chase list.', v_count)),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,
        'apikey', v_svc_key)
    );
  END IF;

  RETURN jsonb_build_object('count', v_count, 'emailed', true);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #3 Peer-pressure conversion boost: when applicants stall, send them a
-- nudge that says their peers are moving. Fires from rescue_stale (day 14)
-- path but with a variant message for in-course applicants specifically.
-- Already handled by rescue_stale_applications; this adds a tighter 5-day
-- cadence for applicants in 'course_purchased' who haven't moved, so we
-- push them to finish.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.in_course_peer_pressure()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_svc_url text;
  v_svc_key text;
  v_active_peers int;
  v_nudged int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
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
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- Cron schedules
-- ───────────────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM cron.unschedule('stuck-applicants-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('in-course-peer-pressure'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('stuck-applicants-daily', '0 14 * * 1-5',
  'SELECT public.stuck_applicants_daily_digest();')::text;

-- Mon/Wed/Fri 16:00 UTC (11am CDT) — spread peer-pressure across week
SELECT cron.schedule('in-course-peer-pressure', '0 16 * * 1,3,5',
  'SELECT public.in_course_peer_pressure();')::text;

SELECT 'hiring_pipeline_v2 installed'::text AS status;
