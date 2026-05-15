-- 2026-05-15 launch readiness: make seminar registration/control self-contained.
-- Adds explicit reminder opt-in, applicant linkage, queued communication logs,
-- manager/Discord alert records, and the roster/metrics surfaces used by
-- SeminarControl.

BEGIN;

ALTER TABLE public.seminar_registrations
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications(id),
  ADD COLUMN IF NOT EXISTS reminder_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_email_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_alert_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS discord_alert_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text;

CREATE INDEX IF NOT EXISTS idx_seminar_registrations_application_id
  ON public.seminar_registrations(application_id);
CREATE INDEX IF NOT EXISTS idx_seminar_registrations_email_date
  ON public.seminar_registrations(lower(email), seminar_date);

DROP FUNCTION IF EXISTS public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.register_for_seminar(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_seminar_date date,
  p_license_status text DEFAULT 'unknown',
  p_source text DEFAULT 'website-seminar-form',
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_reminder_opt_in boolean DEFAULT false
)
RETURNS TABLE (
  registration_id uuid,
  application_id uuid,
  is_new_application boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(trim(p_email));
  v_phone_digits text := NULLIF(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_app_id uuid;
  v_registration_id uuid;
  v_is_new boolean := false;
  v_license license_status;
  v_message text;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF p_seminar_date IS NULL THEN
    RAISE EXCEPTION 'Seminar date is required';
  END IF;

  v_license := CASE
    WHEN p_license_status = 'licensed' THEN 'licensed'::license_status
    WHEN p_license_status = 'unlicensed' THEN 'unlicensed'::license_status
    ELSE 'pending'::license_status
  END;

  SELECT id INTO v_app_id
  FROM public.applications
  WHERE terminated_at IS NULL
    AND (
      lower(email) = v_email
      OR (v_phone_digits IS NOT NULL AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits)
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_app_id IS NULL THEN
    INSERT INTO public.applications (
      first_name, last_name, email, phone, license_status, status,
      referral_source, referral_source_detail, notes
    )
    VALUES (
      trim(p_first_name), trim(p_last_name), v_email, p_phone, v_license, 'new'::application_status,
      'seminar', p_source,
      format('Created from seminar registration for %s', p_seminar_date)
    )
    RETURNING id INTO v_app_id;
    v_is_new := true;
  ELSE
    UPDATE public.applications
       SET first_name = coalesce(nullif(trim(p_first_name), ''), first_name),
           last_name = coalesce(nullif(trim(p_last_name), ''), last_name),
           phone = coalesce(nullif(p_phone, ''), phone),
           license_status = CASE WHEN license_status = 'pending' THEN v_license ELSE license_status END,
           referral_source = coalesce(referral_source, 'seminar'),
           referral_source_detail = coalesce(referral_source_detail, p_source),
           next_action_type = coalesce(next_action_type, 'seminar_follow_up'),
           next_action_at = coalesce(next_action_at, (p_seminar_date::timestamptz + interval '1 day')),
           updated_at = now()
     WHERE id = v_app_id;
  END IF;

  SELECT id INTO v_registration_id
  FROM public.seminar_registrations
  WHERE lower(email) = v_email
    AND seminar_date = p_seminar_date
  ORDER BY registered_at DESC
  LIMIT 1;

  IF v_registration_id IS NULL THEN
    INSERT INTO public.seminar_registrations (
      first_name, last_name, email, phone, license_status, source, seminar_date,
      application_id, reminder_opt_in, utm_source, utm_medium, utm_campaign
    )
    VALUES (
      trim(p_first_name), trim(p_last_name), v_email, p_phone, coalesce(p_license_status, 'unknown'), p_source,
      p_seminar_date, v_app_id, p_reminder_opt_in, p_utm_source, p_utm_medium, p_utm_campaign
    )
    RETURNING id INTO v_registration_id;
  ELSE
    UPDATE public.seminar_registrations
       SET first_name = trim(p_first_name),
           last_name = trim(p_last_name),
           phone = p_phone,
           license_status = coalesce(p_license_status, license_status),
           source = coalesce(p_source, source),
           application_id = v_app_id,
           reminder_opt_in = p_reminder_opt_in,
           utm_source = p_utm_source,
           utm_medium = p_utm_medium,
           utm_campaign = p_utm_campaign,
           registered_at = now()
     WHERE id = v_registration_id;
  END IF;

  v_message := format(
    'You are registered for the APEX career seminar on %s. We will send reminders before the call.',
    to_char(p_seminar_date, 'FMDay, Mon FMDD')
  );

  INSERT INTO public.notification_log (
    recipient_email, recipient_phone, channel, title, message, subject, body,
    notification_type, status, metadata
  )
  VALUES (
    v_email, p_phone, 'email', 'APEX seminar confirmation', v_message,
    'APEX seminar confirmation', v_message, 'seminar_confirmation', 'pending',
    jsonb_build_object('source', 'register_for_seminar', 'registration_id', v_registration_id, 'application_id', v_app_id)
  );

  IF p_reminder_opt_in AND p_phone IS NOT NULL THEN
    INSERT INTO public.notification_log (
      recipient_email, recipient_phone, channel, title, message, subject, body,
      notification_type, status, metadata
    )
    VALUES (
      v_email, p_phone, 'sms-auto', 'APEX seminar reminder opt-in', v_message,
      'APEX seminar reminder opt-in', v_message, 'seminar_sms_opt_in', 'pending',
      jsonb_build_object('source', 'register_for_seminar', 'registration_id', v_registration_id, 'application_id', v_app_id)
    );
  END IF;

  INSERT INTO public.bot_alerts (
    source, event_type, severity, subject, body, sms_body, action_link, channels
  )
  VALUES (
    'seminar_registration',
    'seminar_registration',
    'info',
    format('Seminar opt-in: %s %s', trim(p_first_name), trim(p_last_name)),
    jsonb_build_object(
      'name', trim(p_first_name) || ' ' || trim(p_last_name),
      'email', v_email,
      'phone', p_phone,
      'seminar_date', p_seminar_date,
      'application_id', v_app_id,
      'registration_id', v_registration_id,
      'reminder_opt_in', p_reminder_opt_in
    )::text,
    format('%s %s registered for seminar %s', trim(p_first_name), trim(p_last_name), p_seminar_date),
    '/dashboard/seminar-control',
    ARRAY['email','discord']::text[]
  );

  UPDATE public.seminar_registrations
     SET confirmation_email_queued_at = now(),
         manager_alert_queued_at = now(),
         discord_alert_queued_at = now()
   WHERE id = v_registration_id;

  RETURN QUERY SELECT v_registration_id, v_app_id, v_is_new;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE VIEW public.v_kj_seminar_control AS
SELECT
  sr.id AS registration_id,
  app.id AS application_id,
  trim(sr.first_name || ' ' || sr.last_name) AS attendee_name,
  sr.email,
  sr.phone,
  sr.license_status,
  sr.source,
  sr.seminar_date,
  sr.registered_at,
  sr.attended,
  sr.reminder_opt_in,
  sr.confirmation_email_queued_at,
  sr.manager_alert_queued_at,
  sr.discord_alert_queued_at,
  (app.course_purchased_at IS NOT NULL) AS paid_after,
  app.course_purchased_at AS paid_at,
  (app.course_purchased_at IS NOT NULL) AS ica_paid,
  app.course_purchased_at AS ica_paid_at,
  app.status AS app_status,
  app.license_progress AS app_license_progress,
  NULL::uuid AS converted_agent_id,
  NULL::text AS agent_status,
  NULL::text AS onboarding_stage,
  app.contracted_at AS agent_contracted_at,
  app.first_deal_at,
  CASE
    WHEN app.first_deal_at IS NOT NULL THEN 'active_producer'
    WHEN app.contracted_at IS NOT NULL THEN 'contracted_no_deal'
    WHEN app.licensed_at IS NOT NULL OR app.license_status = 'licensed' THEN 'licensed_pre_contract'
    WHEN app.license_progress IN ('course_purchased','finished_course','test_scheduled','passed_test','fingerprints_done','waiting_on_license','waiting_fingerprints') THEN 'in_licensing'
    WHEN app.course_purchased_at IS NOT NULL THEN 'paid_pre_licensing'
    WHEN sr.attended IS TRUE THEN 'attended_unpaid'
    WHEN sr.attended IS FALSE AND sr.seminar_date < current_date THEN 'no_show'
    WHEN sr.seminar_date >= current_date OR sr.attended IS NULL THEN 'upcoming'
    ELSE 'unknown'
  END AS stage,
  floor(extract(epoch from (now() - sr.registered_at)) / 86400)::int AS days_since_registered
FROM public.seminar_registrations sr
LEFT JOIN LATERAL (
  SELECT a.*
  FROM public.applications a
  WHERE a.id = sr.application_id
     OR lower(a.email) = lower(sr.email)
  ORDER BY (a.id = sr.application_id) DESC, a.created_at DESC
  LIMIT 1
) app ON true;

GRANT SELECT ON public.v_kj_seminar_control TO authenticated;

CREATE OR REPLACE FUNCTION public.kj_seminar_metrics()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH rows AS (
    SELECT * FROM public.v_kj_seminar_control
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'upcoming_total', count(*) FILTER (WHERE stage = 'upcoming'),
    'next_seminar_date', min(seminar_date) FILTER (WHERE seminar_date >= current_date),
    'no_shows_30d', count(*) FILTER (WHERE stage = 'no_show' AND registered_at >= now() - interval '30 days'),
    'attended_30d', count(*) FILTER (WHERE attended IS TRUE AND registered_at >= now() - interval '30 days'),
    'attended_unpaid', count(*) FILTER (WHERE stage = 'attended_unpaid'),
    'paid_pre_licensing', count(*) FILTER (WHERE stage = 'paid_pre_licensing'),
    'in_licensing', count(*) FILTER (WHERE stage = 'in_licensing'),
    'licensed_pre_contract', count(*) FILTER (WHERE stage = 'licensed_pre_contract'),
    'contracted_no_deal', count(*) FILTER (WHERE stage = 'contracted_no_deal'),
    'active_producers', count(*) FILTER (WHERE stage = 'active_producer'),
    'conversion_funnel', jsonb_build_object(
      'registered', count(*),
      'attended', count(*) FILTER (WHERE attended IS TRUE),
      'paid', count(*) FILTER (WHERE paid_after IS TRUE),
      'licensed', count(*) FILTER (WHERE stage IN ('licensed_pre_contract','contracted_no_deal','active_producer')),
      'contracted', count(*) FILTER (WHERE stage IN ('contracted_no_deal','active_producer')),
      'producing', count(*) FILTER (WHERE stage = 'active_producer')
    )
  )
  FROM rows;
$function$;

GRANT EXECUTE ON FUNCTION public.kj_seminar_metrics() TO authenticated;

COMMIT;
