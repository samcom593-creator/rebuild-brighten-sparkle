-- MP231-verify · cohort-routing-lic fix
-- 2026-07-01 · Cover the INSERT path so agents inserted DIRECTLY as
-- active + licensed + live still enqueue course + discord + hired_whatsapp.
--
-- Root cause: trg_agents_hired_licensed_enqueue was AFTER UPDATE OF
-- (onboarding_stage, status, license_status) only. Rows inserted straight
-- into the terminal state (as happens for admin-created / promoted /
-- backfilled agents) never fired the UPDATE trigger, and the
-- agents_after_insert_enqueue_onboarding INSERT trigger early-returned
-- whenever the profile-email lookup failed (e.g. probe agents with no
-- user_id/profile_id) — so hired+licensed agents inserted without a
-- pre-linked profile silently got 0 queue rows.
--
-- Fix:
--   1. fn_enqueue_hired_licensed_onboarding now handles TG_OP='INSERT'
--      (OLD is null) — enqueues when NEW is hired+licensed regardless of
--      diff, using the same guard as the UPDATE path (has_training_course
--      flag flip + queue insert). Email is NOT required at enqueue time;
--      the queue drainer already skips rows lacking a reachable email and
--      surfaces them via last_error, and v_hired_licensed_missing_course
--      surfaces the routing-not-enqueued case for apex-doctor.
--   2. Re-create trg_agents_hired_licensed_enqueue as AFTER INSERT OR
--      UPDATE OF (onboarding_stage, status, license_status).
--   3. Backfill missing queue rows for fb5e82fc-47ed-4488-b8f6-e2d5c9d2234c
--      (MP231 verify probe) + any other currently-hired+licensed agent that
--      has 0 rows in agent_onboarding_queue.
--   4. Broaden v_hired_licensed_missing_course to also flag any
--      hired+licensed agent missing course/discord/hired_whatsapp queue
--      rows — this is the row apex-doctor will red-alert on.

-- 1. Refactored trigger fn — INSERT + UPDATE aware.
CREATE OR REPLACE FUNCTION public.fn_enqueue_hired_licensed_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  should_fire boolean;
BEGIN
  -- Only hired+licensed agents get the hired chain.
  IF NEW.license_status IS DISTINCT FROM 'licensed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Enqueue when the row lands in the terminal hired state directly.
    should_fire := (NEW.onboarding_stage = 'live')
                   OR (NEW.status = 'active');
  ELSE
    -- UPDATE path: any transition into a terminal state (stage / status /
    -- license_status) trips the enqueue, matching the pre-fix behavior.
    should_fire := (
         (OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage AND NEW.onboarding_stage = 'live')
      OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' AND COALESCE(OLD.status::text, '') NOT IN ('active', 'live'))
      OR (OLD.license_status IS DISTINCT FROM NEW.license_status AND NEW.license_status = 'licensed')
    );
  END IF;

  IF NOT should_fire THEN
    RETURN NEW;
  END IF;

  -- Flip has_training_course = true so ProducerProfile + CourseProgressPanel
  -- + DashboardCRM treat this agent as enrolled without waiting for their
  -- first /course-catalog visit. Guarded by pg_trigger_depth to prevent
  -- self-recursion when the flip re-fires the UPDATE trigger.
  IF pg_trigger_depth() = 1
     AND COALESCE(NEW.has_training_course, false) = false THEN
    UPDATE public.agents
    SET has_training_course = true,
        updated_at = now()
    WHERE id = NEW.id
      AND COALESCE(has_training_course, false) = false;
  END IF;

  -- Enqueue the hired chain. We do NOT gate on profile-email presence at
  -- enqueue time — the drainer skips no-email rows and the guardrail view
  -- surfaces them. This preserves the routing receipt (row exists) even
  -- when the profile is not yet linked.
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
  'MP231-verify: INSERT+UPDATE aware. Enqueues course + discord + hired_whatsapp for every hired+licensed agent, regardless of whether they landed via INSERT direct or an UPDATE transition. Flips has_training_course=true (MP-224 gap close). Guardrail: v_hired_licensed_missing_course.';

-- 2. Recreate the trigger with INSERT coverage.
DROP TRIGGER IF EXISTS trg_agents_hired_licensed_enqueue ON public.agents;
CREATE TRIGGER trg_agents_hired_licensed_enqueue
AFTER INSERT OR UPDATE OF onboarding_stage, status, license_status
ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_hired_licensed_onboarding();

-- 3. Backfill: the MP231 verify probe + any other currently-hired+licensed
--    agent with 0 rows in agent_onboarding_queue.
INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
SELECT a.id, k.kind, now()
FROM public.agents a
CROSS JOIN (VALUES ('course'), ('discord'), ('hired_whatsapp')) AS k(kind)
WHERE COALESCE(a.is_deactivated, false) = false
  AND a.license_status = 'licensed'
  AND (a.onboarding_stage = 'live' OR a.status = 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM public.agent_onboarding_queue q
    WHERE q.agent_id = a.id
      AND q.email_kind = k.kind
  )
ON CONFLICT (agent_id, email_kind) DO NOTHING;

-- 4. Broaden guardrail view: also flag hired+licensed agents missing any of
--    the 3 expected queue rows. Apex-doctor reads this view as a red alert.
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
  a.created_at,
  -- Which routing rows are missing (NULL means present).
  (
    SELECT count(*)::int
    FROM (VALUES ('course'), ('discord'), ('hired_whatsapp')) AS k(kind)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.agent_onboarding_queue q
      WHERE q.agent_id = a.id AND q.email_kind = k.kind
    )
  ) AS missing_queue_row_count,
  (
    COALESCE(a.has_training_course, false) = false
    OR EXISTS (
      SELECT 1
      FROM (VALUES ('course'), ('discord'), ('hired_whatsapp')) AS k(kind)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.agent_onboarding_queue q
        WHERE q.agent_id = a.id AND q.email_kind = k.kind
      )
    )
  ) AS is_routing_gap
FROM public.agents a
LEFT JOIN public.profiles p ON p.user_id = a.user_id
WHERE COALESCE(a.is_deactivated, false) = false
  AND a.license_status = 'licensed'
  AND (a.onboarding_stage = 'live' OR a.status = 'active')
  AND (
    COALESCE(a.has_training_course, false) = false
    OR EXISTS (
      SELECT 1
      FROM (VALUES ('course'), ('discord'), ('hired_whatsapp')) AS k(kind)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.agent_onboarding_queue q
        WHERE q.agent_id = a.id AND q.email_kind = k.kind
      )
    )
  );

COMMENT ON VIEW public.v_hired_licensed_missing_course IS
  'MP231-verify: guardrail — every hired+licensed agent should (a) have has_training_course=true and (b) have course + discord + hired_whatsapp rows in agent_onboarding_queue. Empty = healthy. Non-empty rows = cohort routing did not enqueue the LICENSED-hired emails (apex-doctor red alert).';
