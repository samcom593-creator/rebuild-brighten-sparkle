-- Section 10 · Notifications · Role-scoped in-app inbox + event triggers
-- Ships:
--   1. fn_emit_inbox_notification(user_id, type, title, body, link, priority) helper
--   2. INSERT trigger on applications -> notify assigned recruiter (new applicant)
--   3. UPDATE trigger on applications -> notify recruiter on license_progress milestones
--      (covers application completed = 'licensed', course milestones via license_progress
--       course_purchased / finished_course / passed_test / licensed)
--   4. AFTER UPDATE on onboarding_progress -> notify agent + recruiter on completed_at
--   5. AFTER INSERT on scheduled_interviews -> notify scheduled_by
--   6. pg_cron sweep every 5 min:
--        - upcoming interview T-30 min reminder (one-shot via jsonb metadata key)
--        - missed interview (interview_date < now()-15min AND status='scheduled')
--   7. pg_cron daily 14:00 UTC: manager follow-up reminders for applications
--      with no contact in 72h (recruiter is the recipient if set, else assigned_agent)
--
-- All rows route through agents.user_id -> auth.users.id so user_roles join works.
-- Each event uses a distinct notifications.type string for role-scoped filtering.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Helper: fn_emit_inbox_notification
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_emit_inbox_notification(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text,
  p_link    text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link, priority, metadata, created_at, read)
  VALUES (p_user_id, p_type, p_title, p_body, p_link, COALESCE(p_priority,'normal'), COALESCE(p_metadata,'{}'::jsonb), now(), false)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Never block the calling write on inbox-emit failure
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_emit_inbox_notification(uuid,text,text,text,text,text,jsonb) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trigger fn: new applicant inbox row -> recruiter (assigned_agent_id)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_inbox_new_applicant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_name    text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  v_name := COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'');
  -- Route through agents.user_id; prefer assigned_agent_id, fallback to recruiter_id
  SELECT a.user_id INTO v_user_id FROM public.agents a
   WHERE a.id = COALESCE(NEW.assigned_agent_id, NEW.recruiter_id);
  IF v_user_id IS NOT NULL THEN
    PERFORM public.fn_emit_inbox_notification(
      v_user_id,
      'new_applicant',
      'New applicant: ' || trim(v_name),
      'Call within 5 minutes to 2x conversion.',
      '/dashboard/applicants/' || NEW.id::text,
      'high',
      jsonb_build_object('application_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbox_new_applicant ON public.applications;
CREATE TRIGGER trg_inbox_new_applicant
AFTER INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_inbox_new_applicant();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger fn: license_progress milestone -> recruiter inbox
--    Maps prelicensing course milestones (NOT ICA terminology) +
--    application-completed = 'licensed'.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_inbox_license_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_name    text;
  v_label   text;
  v_type    text;
  v_prio    text;
BEGIN
  IF NEW.license_progress IS NOT DISTINCT FROM OLD.license_progress THEN RETURN NEW; END IF;

  v_label := CASE NEW.license_progress::text
    WHEN 'course_purchased'   THEN 'Prelicensing course started (25%)'
    WHEN 'finished_course'    THEN 'Prelicensing course finished (75%) - schedule exam'
    WHEN 'test_scheduled'     THEN 'Exam scheduled'
    WHEN 'passed_test'        THEN 'Passed exam - fingerprints next'
    WHEN 'fingerprints_done'  THEN 'Fingerprints done - state processing'
    WHEN 'waiting_on_license' THEN 'Waiting on state license'
    WHEN 'licensed'           THEN 'Application completed - LICENSED (field-ready)'
    ELSE NULL
  END;
  IF v_label IS NULL THEN RETURN NEW; END IF;

  v_type := CASE NEW.license_progress::text
    WHEN 'course_purchased'  THEN 'course_milestone_25'
    WHEN 'finished_course'   THEN 'course_milestone_100'
    WHEN 'licensed'          THEN 'application_completed'
    ELSE 'license_milestone'
  END;
  v_prio := CASE WHEN NEW.license_progress::text = 'licensed' THEN 'high' ELSE 'normal' END;

  v_name := COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'');
  SELECT a.user_id INTO v_user_id FROM public.agents a
   WHERE a.id = COALESCE(NEW.assigned_agent_id, NEW.recruiter_id);
  IF v_user_id IS NOT NULL THEN
    PERFORM public.fn_emit_inbox_notification(
      v_user_id, v_type, v_label || ': ' || trim(v_name),
      COALESCE(NEW.state,'-') || ' . ' || COALESCE(NEW.phone,'-'),
      '/dashboard/applicants/' || NEW.id::text, v_prio,
      jsonb_build_object('application_id', NEW.id, 'license_progress', NEW.license_progress)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbox_license_milestone ON public.applications;
CREATE TRIGGER trg_inbox_license_milestone
AFTER UPDATE OF license_progress ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_inbox_license_milestone();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trigger fn: onboarding step done -> agent inbox
--    Fires when completed_at transitions from null -> not-null OR passed flips true.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_inbox_onboarding_step_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_title   text;
BEGIN
  IF NEW.completed_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.completed_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT a.user_id INTO v_user_id FROM public.agents a WHERE a.id = NEW.agent_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT 'Onboarding step done: ' || COALESCE(om.title,'module')
    INTO v_title
    FROM public.onboarding_modules om
   WHERE om.id = NEW.module_id;

  PERFORM public.fn_emit_inbox_notification(
    v_user_id, 'onboarding_step_done',
    COALESCE(v_title,'Onboarding step done'),
    CASE WHEN NEW.passed IS TRUE THEN 'Passed' ELSE 'Completed' END,
    '/dashboard/onboarding', 'normal',
    jsonb_build_object('module_id', NEW.module_id, 'score', NEW.score)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbox_onboarding_step_done ON public.onboarding_progress;
CREATE TRIGGER trg_inbox_onboarding_step_done
AFTER UPDATE OF completed_at, passed ON public.onboarding_progress
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_inbox_onboarding_step_done();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Trigger fn: scheduled_interviews INSERT -> scheduler inbox
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_inbox_interview_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_app_name text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  v_user_id := NEW.scheduled_by; -- already auth user id
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
    INTO v_app_name FROM public.applications WHERE id = NEW.application_id;

  PERFORM public.fn_emit_inbox_notification(
    v_user_id, 'interview_scheduled',
    'Interview scheduled: ' || COALESCE(trim(v_app_name),'applicant'),
    to_char(NEW.interview_date AT TIME ZONE 'America/Phoenix','Mon DD, HH12:MI AM TZ'),
    '/dashboard/applicants/' || NEW.application_id::text, 'normal',
    jsonb_build_object('application_id', NEW.application_id, 'interview_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbox_interview_scheduled ON public.scheduled_interviews;
CREATE TRIGGER trg_inbox_interview_scheduled
AFTER INSERT ON public.scheduled_interviews
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_inbox_interview_scheduled();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Sweeps: upcoming-T30 + missed-interview
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sweep_interview_reminders()
RETURNS TABLE(upcoming_emitted int, missed_emitted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; up int := 0; ms int := 0; v_user_id uuid; v_app_name text;
BEGIN
  -- Upcoming T-30 (window: 28-32 min ahead), one-shot guarded by NOT EXISTS notif of same type+interview_id
  FOR r IN
    SELECT si.id, si.application_id, si.scheduled_by, si.interview_date
      FROM public.scheduled_interviews si
     WHERE si.status = 'scheduled'
       AND si.interview_date BETWEEN now() + interval '28 minutes' AND now() + interval '32 minutes'
       AND si.scheduled_by IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = si.scheduled_by
            AND n.type = 'interview_upcoming_t30'
            AND (n.metadata->>'interview_id')::uuid = si.id
       )
  LOOP
    SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
      INTO v_app_name FROM public.applications WHERE id = r.application_id;
    PERFORM public.fn_emit_inbox_notification(
      r.scheduled_by, 'interview_upcoming_t30',
      'Interview in 30 min: ' || COALESCE(trim(v_app_name),'applicant'),
      to_char(r.interview_date AT TIME ZONE 'America/Phoenix','Mon DD, HH12:MI AM TZ'),
      '/dashboard/applicants/' || r.application_id::text, 'high',
      jsonb_build_object('application_id', r.application_id, 'interview_id', r.id)
    );
    up := up + 1;
  END LOOP;

  -- Missed: interview_date < now() - 15 min AND status='scheduled'
  FOR r IN
    SELECT si.id, si.application_id, si.scheduled_by, si.interview_date
      FROM public.scheduled_interviews si
     WHERE si.status = 'scheduled'
       AND si.interview_date < now() - interval '15 minutes'
       AND si.scheduled_by IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = si.scheduled_by
            AND n.type = 'interview_missed'
            AND (n.metadata->>'interview_id')::uuid = si.id
       )
  LOOP
    SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
      INTO v_app_name FROM public.applications WHERE id = r.application_id;
    PERFORM public.fn_emit_inbox_notification(
      r.scheduled_by, 'interview_missed',
      'Missed interview: ' || COALESCE(trim(v_app_name),'applicant'),
      'Reschedule now to recover the applicant.',
      '/dashboard/applicants/' || r.application_id::text, 'high',
      jsonb_build_object('application_id', r.application_id, 'interview_id', r.id)
    );
    ms := ms + 1;
  END LOOP;

  RETURN QUERY SELECT up, ms;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_sweep_interview_reminders() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Sweep: manager follow-up reminder (applicants with no contact in 72h)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sweep_manager_followup_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; emitted int := 0; v_user_id uuid;
BEGIN
  FOR r IN
    SELECT app.id, app.first_name, app.last_name, app.last_contacted_at,
           COALESCE(app.assigned_agent_id, app.recruiter_id) AS owner_agent_id
      FROM public.applications app
     WHERE COALESCE(app.last_contacted_at, app.created_at) < now() - interval '72 hours'
       AND app.terminated_at IS NULL
       AND COALESCE(app.assigned_agent_id, app.recruiter_id) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.type = 'manager_followup_reminder'
            AND (n.metadata->>'application_id')::uuid = app.id
            AND n.created_at > now() - interval '24 hours'
       )
     LIMIT 200
  LOOP
    SELECT a.user_id INTO v_user_id FROM public.agents a WHERE a.id = r.owner_agent_id;
    IF v_user_id IS NOT NULL THEN
      PERFORM public.fn_emit_inbox_notification(
        v_user_id, 'manager_followup_reminder',
        'Follow up: ' || trim(COALESCE(r.first_name,'') || ' ' || COALESCE(r.last_name,'')),
        'No contact in 72h. Reach out today.',
        '/dashboard/applicants/' || r.id::text, 'normal',
        jsonb_build_object('application_id', r.id)
      );
      emitted := emitted + 1;
    END IF;
  END LOOP;
  RETURN emitted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_sweep_manager_followup_reminders() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. pg_cron schedules (guarded by unschedule)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('apex_notif_interview_sweep_5min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'apex_notif_interview_sweep_5min',
  '*/5 * * * *',
  $$SELECT public.fn_sweep_interview_reminders();$$
);

DO $$
BEGIN
  PERFORM cron.unschedule('apex_notif_manager_followup_daily');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'apex_notif_manager_followup_daily',
  '0 14 * * *',
  $$SELECT public.fn_sweep_manager_followup_reminders();$$
);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Admin role-scoping view: v_notification_log_with_role
--    Joins notification_log -> auth.users via recipient_user_id -> user_roles.role
--    so admins can filter the log by recipient role.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_notification_log_with_role AS
SELECT nl.*,
       ur.role::text AS recipient_role
  FROM public.notification_log nl
  LEFT JOIN public.user_roles ur ON ur.user_id = nl.recipient_user_id;

GRANT SELECT ON public.v_notification_log_with_role TO authenticated, service_role;
