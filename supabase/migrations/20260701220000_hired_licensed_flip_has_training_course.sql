-- 2026-07-01 · MP-224 gap close · hired+licensed agents must have
-- agents.has_training_course=true so admin panels + ProducerProfile treat
-- them as course-enrolled without waiting for a browser visit.
--
-- Root cause: fn_enqueue_hired_licensed_onboarding only enqueued emails,
-- it never flipped the flag. Two agents (Zach Hurkmans, Andreia Green)
-- from 2026-06-29 had emails sent (or attempted) but the admin panel
-- showed them as course-less. Plus the trigger had a latent enum bug:
-- OLD.status guard referenced 'live' which does not exist in the
-- agent_status enum (active|inactive|pending|terminated), so every real
-- flip errored at runtime.
--
-- Fixes:
--   1. Trigger now flips has_training_course=true when the hired+licensed
--      predicate is satisfied (guarded by pg_trigger_depth() to prevent
--      self-recursion).
--   2. Enum-scrubbed guard: NEW.status='active' AND OLD.status <> 'active'.
--   3. Backfill every current hired+licensed agent missing the flag.
--   4. Guardrail view v_hired_licensed_missing_course for apex-doctor.

-- 1 + 2. Trigger fn (enum scrub + flag flip)
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
    (NEW.id, 'course',   now()),
    (NEW.id, 'discord',  now()),
    (NEW.id, 'whatsapp', now())
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 3. Backfill every current hired+licensed agent
UPDATE public.agents
SET has_training_course = true,
    updated_at = now()
WHERE COALESCE(is_deactivated, false) = false
  AND license_status = 'licensed'
  AND (onboarding_stage = 'live' OR status = 'active')
  AND COALESCE(has_training_course, false) = false;

-- 4. Guardrail view — empty = healthy
CREATE OR REPLACE VIEW public.v_hired_licensed_missing_course AS
SELECT
  a.id,
  COALESCE(p.full_name, a.display_name, a.agent_code, 'unknown') AS name,
  p.email,
  a.status,
  a.onboarding_stage,
  a.license_status,
  a.has_training_course,
  a.stage_changed_at,
  a.contracted_at,
  a.created_at
FROM public.agents a
LEFT JOIN public.profiles p ON p.user_id = a.user_id
WHERE COALESCE(a.is_deactivated, false) = false
  AND a.license_status = 'licensed'
  AND (a.onboarding_stage = 'live' OR a.status = 'active')
  AND COALESCE(a.has_training_course, false) = false;

COMMENT ON VIEW public.v_hired_licensed_missing_course IS
  '2026-07-01: guardrail — every hired+licensed agent should have has_training_course=true (MP-224 course auto-enroll on hire). Empty = healthy. Non-empty rows = trg_agents_hired_licensed_enqueue flag flip regressed.';
