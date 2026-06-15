-- 20260615030443_agent_onboarding_email_queue.sql
--
-- New-agent onboarding email automation. Sam directive (voice transcript
-- 2026-06-15): "Whenever I add new agents, they get the emails of the
-- training courses as well as the email for Discord as well at the time
-- of that 9:30 AM CST to log on with that Discord link."
--
-- Architecture:
--   1. agent_onboarding_queue — durable queue, one row per (agent, email_kind).
--      Unique constraint guarantees idempotency: same agent can never be
--      enqueued for the same email_kind twice. Survives chat death, edge
--      function restarts, and pg_cron skip-firings.
--   2. fn_next_onboarding_window() — computes the next 9:30 AM US/Central.
--      Handles CDT/CST automatically because we pivot via the timezone name,
--      not a hardcoded offset. If now() is before 9:30 CT today, target =
--      today 9:30 CT; otherwise target = tomorrow 9:30 CT.
--   3. fn_enqueue_agent_onboarding_emails() — AFTER INSERT trigger on agents.
--      Inserts 2 queue rows (course + discord) targeted at the next 9:30
--      CT window. Skips quietly if no email is reachable via profiles join
--      (logs a NOTICE — we never block agent creation on missing email).
--      ON CONFLICT DO NOTHING so re-firing the trigger (or replays) is safe.
--   4. send-agent-onboarding-email edge fn drains the queue. pg_cron fires
--      it at 14:30 UTC and 15:30 UTC daily so we always hit 9:30 CT
--      regardless of DST.
--
-- We do NOT touch any existing agents trigger (Discord broadcast, Telegram
-- new-hire flow, getting-started, ref-slug, etc remain intact). This adds
-- one more trigger to the chain.

-- ─── 1. Queue table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_onboarding_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  email_kind text NOT NULL CHECK (email_kind IN ('course', 'discord')),
  target_send_at timestamptz NOT NULL,
  sent_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  resend_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_onboarding_queue_unique UNIQUE (agent_id, email_kind)
);

COMMENT ON TABLE public.agent_onboarding_queue IS
  'Durable queue of onboarding emails (prelicensing course + Discord invite) targeted at 9:30 AM US/Central. Drained by send-agent-onboarding-email edge fn via pg_cron at 14:30 and 15:30 UTC (CDT and CST 9:30 AM).';

CREATE INDEX IF NOT EXISTS agent_onboarding_queue_pending_idx
  ON public.agent_onboarding_queue (target_send_at)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_onboarding_queue_agent_idx
  ON public.agent_onboarding_queue (agent_id);

-- ─── 2. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_onboarding_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_onboarding_queue admin read" ON public.agent_onboarding_queue;
CREATE POLICY "agent_onboarding_queue admin read"
  ON public.agent_onboarding_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'::app_role
    )
  );

DROP POLICY IF EXISTS "agent_onboarding_queue admin write" ON public.agent_onboarding_queue;
CREATE POLICY "agent_onboarding_queue admin write"
  ON public.agent_onboarding_queue
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'::app_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'::app_role
    )
  );

-- service_role bypasses RLS automatically (edge fn auth path).

-- ─── 3. Next 9:30 AM US/Central computation ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_next_onboarding_window()
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- now() projected onto US/Central wall clock
  central_now timestamp := (now() AT TIME ZONE 'US/Central');
  -- Today at 09:30:00 US/Central (local wall time, no tz)
  central_today_target timestamp := date_trunc('day', central_now) + interval '9 hours 30 minutes';
  next_local timestamp;
BEGIN
  IF central_now < central_today_target THEN
    next_local := central_today_target;
  ELSE
    next_local := central_today_target + interval '1 day';
  END IF;

  -- Project the wall-clock target back to UTC using US/Central rules so
  -- CDT/CST shifts are handled automatically.
  RETURN next_local AT TIME ZONE 'US/Central';
END;
$$;

COMMENT ON FUNCTION public.fn_next_onboarding_window() IS
  'Returns the next 9:30 AM US/Central window after now(). Handles CDT/CST automatically.';

-- ─── 4. Enqueue trigger fn ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_enqueue_agent_onboarding_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target timestamptz;
  agent_email text;
BEGIN
  -- Resolve email reachability without blocking the insert. Email lives on
  -- profiles, joined by user_id. If we can't find an email we skip silently
  -- (NOTICE only) — Sam doesn't want a missing email to block hiring.
  SELECT p.email
  INTO agent_email
  FROM public.profiles p
  WHERE p.user_id = NEW.user_id
  LIMIT 1;

  IF agent_email IS NULL OR length(trim(agent_email)) = 0 THEN
    RAISE NOTICE 'fn_enqueue_agent_onboarding_emails: agent % has no reachable email via profiles.user_id=%; skipping enqueue.',
      NEW.id, NEW.user_id;
    RETURN NEW;
  END IF;

  target := public.fn_next_onboarding_window();

  INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  VALUES
    (NEW.id, 'course', target),
    (NEW.id, 'discord', target)
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_enqueue_agent_onboarding_emails() IS
  'AFTER INSERT trigger fn for agents. Enqueues prelicensing course + Discord invite emails targeted at the next 9:30 AM US/Central window. Skips silently when profiles.email is unreachable.';

-- ─── 5. Trigger on agents ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS agents_after_insert_enqueue_onboarding ON public.agents;
CREATE TRIGGER agents_after_insert_enqueue_onboarding
  AFTER INSERT ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_agent_onboarding_emails();

COMMENT ON TRIGGER agents_after_insert_enqueue_onboarding ON public.agents IS
  'Enqueues 2 onboarding emails (prelicensing course + Discord invite) at next 9:30 AM CT for every new agent.';

-- ─── 6. Seed configuration placeholders (NULL-safe) ───────────────────────
-- Insert NULL rows for missing config keys so Sam sees the gap surface in
-- system_settings instead of the edge function silently no-op'ing.
-- Empty string is the "unset" sentinel for this row; edge fn treats empty
-- string the same as NULL and falls back to "reply for invite" body copy.
-- Sam should overwrite this row with the real Discord invite URL when
-- he's ready.
INSERT INTO public.system_settings (key, value)
SELECT 'discord_invite_url', ''
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'discord_invite_url');

INSERT INTO public.system_settings (key, value)
SELECT 'training_course_url', 'https://apex-financial.org/onboarding-course'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'training_course_url');

INSERT INTO public.system_settings (key, value)
SELECT 'onboarding_email_from_address', 'Sam James <sam@apex-financial.org>'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'onboarding_email_from_address');

-- ─── 7. Backfill (commented — DO NOT auto-run) ────────────────────────────
-- Uncomment + run manually if Sam wants the last 7 days of agents enqueued
-- after the fact (idempotent via ON CONFLICT):
--
-- INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
-- SELECT a.id, k.kind, public.fn_next_onboarding_window()
-- FROM public.agents a
-- CROSS JOIN unnest(ARRAY['course', 'discord']) AS k(kind)
-- WHERE a.created_at >= now() - interval '7 days'
--   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = a.user_id AND p.email IS NOT NULL)
-- ON CONFLICT (agent_id, email_kind) DO NOTHING;
