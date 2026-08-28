-- MP-338 — every applications.license_progress UPDATE has been throwing.
--
-- trg_license_milestone_emit (AFTER UPDATE OF license_progress) exists in NO repo
-- migration — it was hand-applied — and fn_license_milestone_emit compares
-- license_milestone_templates.template_key (text) to NEW.license_progress (enum
-- license_progress) with no cast: "operator does not exist: text = license_progress".
-- Proven 2026-08-27 by disabling triggers one at a time inside a rolled-back
-- transaction: with this single trigger disabled the UPDATE succeeds; with any other
-- disabled it still throws; the value does not matter (finished_course,
-- test_scheduled, course_purchased all throw). Every path that advances a candidate's
-- licensing stage through this trigger — LicenseProgressSelector, CallCenter,
-- ApplicationDetailSheet, LeadDetailSheet, the XCEL sync — has been failing at the
-- database. 370 XCEL students sit at 100% coursework with applications still at
-- unlicensed/course_purchased.
--
-- Fix: cast. Nothing else in the function changes.

create or replace function public.fn_license_milestone_emit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_template public.license_milestone_templates%ROWTYPE;
  v_phone    text;
  v_body     text;
BEGIN
  IF NEW.license_progress IS NULL OR NEW.license_progress = OLD.license_progress THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_template
    FROM public.license_milestone_templates
   WHERE template_key = NEW.license_progress::text AND is_active = true
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_phone := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone) < 10 THEN
    INSERT INTO public.license_milestone_outbox
      (application_id, prev_progress, new_progress, to_phone, template_key, rendered_body, status, last_error)
    VALUES
      (NEW.id, OLD.license_progress::text, NEW.license_progress::text, NEW.phone, NEW.license_progress::text, '', 'skipped', 'phone_too_short');
    RETURN NEW;
  END IF;
  v_body := replace(v_template.body, '{first_name}', COALESCE(NEW.first_name, 'there'));
  INSERT INTO public.license_milestone_outbox
    (application_id, prev_progress, new_progress, to_phone, template_key, rendered_body)
  VALUES
    (NEW.id, OLD.license_progress::text, NEW.license_progress::text, NEW.phone, NEW.license_progress::text, v_body);
  RETURN NEW;
END;
$function$;
