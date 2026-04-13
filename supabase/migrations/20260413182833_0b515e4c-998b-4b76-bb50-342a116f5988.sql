
CREATE OR REPLACE FUNCTION public.track_license_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when license_progress actually changes
  IF OLD.license_progress IS DISTINCT FROM NEW.license_progress THEN
    -- Set milestone timestamps
    IF NEW.license_progress = 'course_purchased' AND NEW.course_purchased_at IS NULL THEN
      NEW.course_purchased_at := now();
    END IF;
    IF NEW.license_progress = 'test_scheduled' AND NEW.exam_scheduled_at IS NULL THEN
      NEW.exam_scheduled_at := now();
    END IF;
    IF NEW.license_progress IN ('exam_passed', 'passed_test') AND NEW.exam_passed_at IS NULL THEN
      NEW.exam_passed_at := now();
    END IF;
    IF NEW.license_progress = 'fingerprints_done' AND NEW.fingerprints_submitted_at IS NULL THEN
      NEW.fingerprints_submitted_at := now();
    END IF;
    IF NEW.license_progress = 'licensed' AND NEW.license_approved_at IS NULL THEN
      NEW.license_approved_at := now();
    END IF;

    -- Close out previous pipeline_metrics stage
    UPDATE public.pipeline_metrics
    SET exited_at = now()
    WHERE application_id = NEW.id
      AND exited_at IS NULL;

    -- Insert new pipeline_metrics stage
    INSERT INTO public.pipeline_metrics (application_id, stage, entered_at)
    VALUES (NEW.id, NEW.license_progress::text, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_track_license_milestones
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.track_license_milestones();
