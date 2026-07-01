-- 2026-07-02 · MP231-verify · idempotency-double-fire root-cause fix
--
-- Bug: fn_enqueue_hired_licensed_onboarding inserts email_kind='whatsapp'
-- but agent_onboarding_queue_email_kind_check only permits
-- ('course','discord','hired_whatsapp'). The CHECK violation rolls back
-- the ENTIRE atomic INSERT (all 3 rows: course + discord + whatsapp),
-- silently killing the hired→licensed auto-send flow for every agent
-- with a valid profile email.
--
-- Symptom looked like idempotency was fine (0 dupes even on triple-fire),
-- but that was because 0 rows ever landed. Legitimate hired→licensed
-- transitions were being dropped on the floor.
--
-- Fix: change 'whatsapp' → 'hired_whatsapp' to match the constraint
-- (and the WhatsApp cohort router migration 20260701140000 which
-- renamed the kind). Course + discord + hired_whatsapp now all enqueue
-- atomically on real transitions.

CREATE OR REPLACE FUNCTION public.fn_enqueue_hired_licensed_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  agent_email text;
  stage_flipped boolean;
  status_flipped boolean;
BEGIN
  stage_flipped := (OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage)
                   AND (NEW.onboarding_stage = 'live');

  status_flipped := (OLD.status IS DISTINCT FROM NEW.status)
                    AND (NEW.status = 'active')
                    AND (OLD.status IS NULL OR OLD.status <> 'active');

  IF NOT (stage_flipped OR status_flipped) THEN
    RETURN NEW;
  END IF;

  IF NEW.license_status IS DISTINCT FROM 'licensed' THEN
    RETURN NEW;
  END IF;

  -- Flip has_training_course = true so ProducerProfile + CourseProgressPanel
  -- + DashboardCRM treat this agent as enrolled without waiting for their
  -- first /course-catalog visit.
  IF pg_trigger_depth() = 1
     AND COALESCE(NEW.has_training_course, false) = false THEN
    UPDATE public.agents
    SET has_training_course = true,
        updated_at = now()
    WHERE id = NEW.id
      AND COALESCE(has_training_course, false) = false;
  END IF;

  SELECT p.email INTO agent_email
  FROM public.profiles p
  WHERE p.user_id = NEW.user_id
  LIMIT 1;

  IF agent_email IS NULL OR length(trim(agent_email)) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  VALUES
    (NEW.id, 'course',         now()),
    (NEW.id, 'discord',        now()),
    (NEW.id, 'hired_whatsapp', now())
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_enqueue_hired_licensed_onboarding() IS
  '2026-07-02 MP231-verify: email_kind ''whatsapp'' → ''hired_whatsapp'' to match agent_onboarding_queue_email_kind_check. Prior version silently rolled back all 3 enqueues on every legitimate hired→licensed transition.';
