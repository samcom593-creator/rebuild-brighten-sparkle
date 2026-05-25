-- PL-086: wire /seminar to durable seminar registrations + application seminar fields.
--
-- Production still had the older register_for_seminar(..., p_notes text)
-- signature while the React form sends p_reminder_opt_in. That mismatch made
-- the public /seminar form fail before any durable write happened.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS seminar_date date,
  ADD COLUMN IF NOT EXISTS seminar_registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_attended_at timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_slot_at timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_zoom_link text,
  ADD COLUMN IF NOT EXISTS seminar_ics_uid text;

ALTER TABLE public.seminar_registrations
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications(id),
  ADD COLUMN IF NOT EXISTS reminder_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_email_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_alert_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS discord_alert_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS paid_after boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_seminar_registrations_application_id
  ON public.seminar_registrations(application_id);
CREATE INDEX IF NOT EXISTS idx_seminar_registrations_email_date
  ON public.seminar_registrations(lower(email), seminar_date);
CREATE INDEX IF NOT EXISTS idx_applications_seminar_date
  ON public.applications(seminar_date)
  WHERE seminar_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_seminar_registered_at
  ON public.applications(seminar_registered_at)
  WHERE seminar_registered_at IS NOT NULL;

DROP FUNCTION IF EXISTS public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, text);
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
  v_phone text := NULLIF(trim(coalesce(p_phone, '')), '');
  v_phone_digits text := NULLIF(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_first text := NULLIF(trim(coalesce(p_first_name, '')), '');
  v_last text := NULLIF(trim(coalesce(p_last_name, '')), '');
  v_license public.license_status;
  v_app_id uuid;
  v_registration_id uuid;
  v_is_new boolean := false;
  v_slot_hour int;
  v_slot_at timestamptz;
  v_zoom_url text;
  v_message text;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_seminar_date IS NULL THEN
    RAISE EXCEPTION 'Seminar date is required';
  END IF;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'First name is required';
  END IF;

  IF v_last IS NULL THEN
    RAISE EXCEPTION 'Last name is required';
  END IF;

  v_license := CASE lower(coalesce(p_license_status, 'unknown'))
    WHEN 'licensed' THEN 'licensed'::public.license_status
    WHEN 'unlicensed' THEN 'unlicensed'::public.license_status
    ELSE 'pending'::public.license_status
  END;

  v_slot_hour := CASE extract(dow FROM p_seminar_date)
    WHEN 6 THEN 10
    ELSE 19
  END;
  v_slot_at := ((p_seminar_date::timestamp + make_interval(hours => v_slot_hour)) AT TIME ZONE 'America/Chicago');

  SELECT value INTO v_zoom_url
  FROM public.system_settings
  WHERE key IN ('seminar_zoom_url', 'seminar_meeting_url')
  ORDER BY CASE key WHEN 'seminar_zoom_url' THEN 0 ELSE 1 END
  LIMIT 1;

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
      first_name,
      last_name,
      email,
      phone,
      license_status,
      status,
      referral_source,
      referral_source_detail,
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      notes,
      seminar_date,
      seminar_registered_at,
      seminar_slot_at,
      seminar_zoom_link,
      next_action_type,
      next_action_at
    )
    VALUES (
      v_first,
      v_last,
      v_email,
      v_phone,
      v_license,
      'new'::public.application_status,
      'seminar',
      p_source,
      p_source,
      p_utm_source,
      p_utm_medium,
      p_utm_campaign,
      format('Created from /seminar registration for %s', p_seminar_date),
      p_seminar_date,
      now(),
      v_slot_at,
      v_zoom_url,
      'seminar_follow_up',
      v_slot_at + interval '1 day'
    )
    RETURNING id INTO v_app_id;

    v_is_new := true;
  ELSE
    UPDATE public.applications
       SET first_name = coalesce(v_first, first_name),
           last_name = coalesce(v_last, last_name),
           phone = coalesce(v_phone, phone),
           license_status = CASE
             WHEN license_status = 'pending'::public.license_status THEN v_license
             ELSE license_status
           END,
           referral_source = coalesce(referral_source, 'seminar'),
           referral_source_detail = coalesce(referral_source_detail, p_source),
           source = coalesce(source, p_source),
           utm_source = coalesce(utm_source, p_utm_source),
           utm_medium = coalesce(utm_medium, p_utm_medium),
           utm_campaign = coalesce(utm_campaign, p_utm_campaign),
           seminar_date = p_seminar_date,
           seminar_registered_at = now(),
           seminar_slot_at = v_slot_at,
           seminar_zoom_link = coalesce(seminar_zoom_link, v_zoom_url),
           next_action_type = coalesce(next_action_type, 'seminar_follow_up'),
           next_action_at = coalesce(next_action_at, v_slot_at + interval '1 day'),
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
      first_name,
      last_name,
      email,
      phone,
      license_status,
      source,
      seminar_date,
      application_id,
      reminder_opt_in,
      utm_source,
      utm_medium,
      utm_campaign
    )
    VALUES (
      v_first,
      v_last,
      v_email,
      v_phone,
      coalesce(p_license_status, 'unknown'),
      p_source,
      p_seminar_date,
      v_app_id,
      p_reminder_opt_in,
      p_utm_source,
      p_utm_medium,
      p_utm_campaign
    )
    RETURNING id INTO v_registration_id;
  ELSE
    UPDATE public.seminar_registrations
       SET first_name = v_first,
           last_name = v_last,
           phone = coalesce(v_phone, phone),
           license_status = coalesce(p_license_status, license_status),
           source = coalesce(p_source, source),
           application_id = v_app_id,
           reminder_opt_in = p_reminder_opt_in,
           utm_source = coalesce(p_utm_source, utm_source),
           utm_medium = coalesce(p_utm_medium, utm_medium),
           utm_campaign = coalesce(p_utm_campaign, utm_campaign),
           registered_at = now()
     WHERE id = v_registration_id;
  END IF;

  v_message := format(
    'You are registered for the APEX career seminar on %s. We will send reminders before the call.',
    to_char(p_seminar_date, 'FMDay, Mon FMDD')
  );

  INSERT INTO public.notification_log (
    recipient_email,
    recipient_phone,
    channel,
    title,
    message,
    subject,
    body,
    notification_type,
    status,
    metadata
  )
  VALUES (
    v_email,
    v_phone,
    'email',
    'APEX seminar confirmation',
    v_message,
    'APEX seminar confirmation',
    v_message,
    'seminar_confirmation',
    'pending',
    jsonb_build_object(
      'source', 'register_for_seminar',
      'registration_id', v_registration_id,
      'application_id', v_app_id,
      'seminar_date', p_seminar_date
    )
  );

  IF p_reminder_opt_in AND v_phone IS NOT NULL THEN
    INSERT INTO public.notification_log (
      recipient_email,
      recipient_phone,
      channel,
      title,
      message,
      subject,
      body,
      notification_type,
      status,
      metadata
    )
    VALUES (
      v_email,
      v_phone,
      'sms-auto',
      'APEX seminar reminder opt-in',
      v_message,
      'APEX seminar reminder opt-in',
      v_message,
      'seminar_sms_opt_in',
      'pending',
      jsonb_build_object(
        'source', 'register_for_seminar',
        'registration_id', v_registration_id,
        'application_id', v_app_id,
        'seminar_date', p_seminar_date
      )
    );
  END IF;

  INSERT INTO public.bot_alerts (
    source,
    event_type,
    severity,
    subject,
    body,
    sms_body,
    action_link,
    channels
  )
  VALUES (
    'seminar_registration',
    'seminar_registration',
    'info',
    format('Seminar registration: %s %s', v_first, v_last),
    jsonb_build_object(
      'name', v_first || ' ' || v_last,
      'email', v_email,
      'phone', v_phone,
      'seminar_date', p_seminar_date,
      'application_id', v_app_id,
      'registration_id', v_registration_id,
      'reminder_opt_in', p_reminder_opt_in,
      'source', p_source
    )::text,
    format('%s %s registered for seminar %s', v_first, v_last, p_seminar_date),
    '/dashboard/seminar-control',
    ARRAY['email','discord']::text[]
  );

  UPDATE public.seminar_registrations
     SET confirmation_email_queued_at = coalesce(confirmation_email_queued_at, now()),
         manager_alert_queued_at = coalesce(manager_alert_queued_at, now()),
         discord_alert_queued_at = coalesce(discord_alert_queued_at, now())
   WHERE id = v_registration_id;

  RETURN QUERY SELECT v_registration_id, v_app_id, v_is_new;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, boolean) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, boolean) IS
'PL-086: durable /seminar registration write path. Creates or updates applications.seminar_* fields and seminar_registrations in one SECURITY DEFINER transaction.';
