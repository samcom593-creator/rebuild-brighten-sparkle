-- Auto-signup for seminar when applicant purchases the pre-license course — PL-057
--
-- THE PAIN: When an unlicensed applicant pays for the pre-license course, the
-- hiring manager has to manually move them onto a seminar. They often forget,
-- so the applicant pays + ghosts. Sam wants this automated.
--
-- THE FIX:
--   1) Trigger on applications.course_purchased_at NULL→NOT NULL.
--   2) Compute the next seminar (Wed 7pm CT OR Sat 10am CT — whichever is sooner
--      AND at least 6h out so we don't auto-book the seminar starting in 10 min).
--   3) Stamp applications.seminar_date + seminar_registered_at (only if NULL —
--      respect any manual override the manager already made).
--   4) Insert into seminar_registrations with source='auto_course_paid' and
--      reminder_opt_in=true (so seminar-reminder-tick picks them up).
--   5) Fire pg_net to notify-seminar-signup edge fn so the assigned manager gets
--      an email + Discord ping with the booked date.
--
-- Built: 2026-05-20. Idempotent (re-runnable). Non-destructive.

-- ============================================================================
-- 1) next-seminar-date helper
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_next_seminar_date(p_from timestamptz DEFAULT now())
RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today_ct timestamptz;
  v_dow int;
  v_today_date date;
  v_offset_to_wed int;
  v_offset_to_sat int;
  v_wed_ts timestamptz;
  v_sat_ts timestamptz;
BEGIN
  -- Work in CT
  v_today_ct := p_from AT TIME ZONE 'America/Chicago';
  v_today_date := v_today_ct::date;
  v_dow := EXTRACT(dow FROM v_today_ct);  -- Sun=0, Mon=1, ... Sat=6

  -- Days until next Wed (3) and next Sat (6) from today
  v_offset_to_wed := MOD(3 - v_dow + 7, 7);
  v_offset_to_sat := MOD(6 - v_dow + 7, 7);

  -- Candidate timestamps at the seminar hour (CT)
  v_wed_ts := ((v_today_date + v_offset_to_wed)::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago';
  v_sat_ts := ((v_today_date + v_offset_to_sat)::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago';

  -- Require ≥ 6h lead time — bump to next week if the candidate is too soon
  IF v_wed_ts < p_from + interval '6 hours' THEN
    v_wed_ts := v_wed_ts + interval '7 days';
  END IF;
  IF v_sat_ts < p_from + interval '6 hours' THEN
    v_sat_ts := v_sat_ts + interval '7 days';
  END IF;

  -- Whichever is sooner
  IF v_wed_ts < v_sat_ts THEN
    RETURN v_wed_ts::date;
  ELSE
    RETURN v_sat_ts::date;
  END IF;
END $$;

COMMENT ON FUNCTION public.fn_next_seminar_date IS
'Returns the next Apex seminar date (Wed 7pm CT or Sat 10am CT, whichever is sooner with ≥6h lead time). DST-safe.';

-- ============================================================================
-- 2) Trigger fn — auto-signup on course paid
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_seminar_signup_on_course_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_target_date date;
  v_reg_id uuid;
  v_drain_url text := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/notify-seminar-signup';
  v_secret text;
BEGIN
  -- Only fire when course_purchased_at flips NULL → NOT NULL
  IF NEW.course_purchased_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.course_purchased_at IS NOT NULL THEN RETURN NEW; END IF;

  -- Required identity fields for seminar_registrations (NOT NULL)
  IF NEW.first_name IS NULL OR NEW.last_name IS NULL OR NEW.email IS NULL THEN
    RAISE LOG 'fn_auto_seminar_signup: application % missing first/last/email — skipping', NEW.id;
    RETURN NEW;
  END IF;

  -- Compute target date — respect any prior manual signup
  IF NEW.seminar_date IS NOT NULL THEN
    v_target_date := NEW.seminar_date;
  ELSE
    v_target_date := public.fn_next_seminar_date(now());
    -- Stamp it on the application for downstream UIs that read this column
    UPDATE public.applications
       SET seminar_date = v_target_date,
           seminar_registered_at = COALESCE(seminar_registered_at, now())
     WHERE id = NEW.id;
  END IF;

  -- Insert seminar_registrations row — dedupe by email + seminar_date
  IF NOT EXISTS (
    SELECT 1 FROM public.seminar_registrations
     WHERE LOWER(email) = LOWER(NEW.email) AND seminar_date = v_target_date
  ) THEN
    INSERT INTO public.seminar_registrations(
      first_name, last_name, email, phone,
      license_status, source, seminar_date, application_id,
      paid_after
    ) VALUES (
      NEW.first_name, NEW.last_name, LOWER(NEW.email), NEW.phone,
      COALESCE(NEW.license_status::text, 'unlicensed'),
      'auto_course_paid', v_target_date, NEW.id,
      true
    )
    RETURNING id INTO v_reg_id;
    RAISE LOG 'fn_auto_seminar_signup: applicant % auto-registered for seminar % (reg %)', NEW.id, v_target_date, v_reg_id;
  END IF;

  -- Notify manager via pg_net → notify-seminar-signup edge fn
  BEGIN
    SELECT value INTO v_secret FROM system_settings WHERE key = 'apex_drain_secret' LIMIT 1;
    PERFORM net.http_post(
      url := v_drain_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-apex-drain-secret', COALESCE(v_secret, '')
      ),
      body := jsonb_build_object(
        'application_id', NEW.id,
        'seminar_date', v_target_date,
        'source', 'auto_course_paid'
      ),
      timeout_milliseconds := 15000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'fn_auto_seminar_signup: notify dispatch failed for app % — %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_seminar_signup_on_course_paid ON public.applications;
CREATE TRIGGER trg_auto_seminar_signup_on_course_paid
AFTER UPDATE OF course_purchased_at ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_seminar_signup_on_course_paid();

COMMENT ON FUNCTION public.fn_auto_seminar_signup_on_course_paid IS
'PL-057: when course_purchased_at flips NULL→NOT NULL, auto-create a seminar_registrations row for the next available seminar (Wed/Sat CT) and notify the assigned manager.';
