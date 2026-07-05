-- =============================================================================
-- MP239 · unified /dashboard/today page
-- 2026-07-05 · Sam directive: "One simple todo list to mark income-producing
-- tasks with auto-populating calendar appointments."
--
-- Adds:
--   1. today_tasks.is_income_producing  — the income-producing marker Sam taps.
--   2. today_tasks.scheduled_call_id     — optional link back to the
--      apex_scheduled_calls row that auto-generated this task (so appointment-
--      backed tasks can round-trip status).
-- =============================================================================

ALTER TABLE public.today_tasks
  ADD COLUMN IF NOT EXISTS is_income_producing boolean NOT NULL DEFAULT false;

ALTER TABLE public.today_tasks
  ADD COLUMN IF NOT EXISTS scheduled_call_id bigint NULL
    REFERENCES public.apex_scheduled_calls(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_today_tasks_income_open
  ON public.today_tasks (owner_agent_id, is_income_producing, due_at)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_today_tasks_scheduled_call
  ON public.today_tasks (scheduled_call_id)
  WHERE scheduled_call_id IS NOT NULL;

COMMENT ON COLUMN public.today_tasks.is_income_producing IS
  'MP239 — Sam-tap marker. TRUE = this task moves money today (calls, closes, follow-ups). Ranked to the top of /dashboard/today.';

COMMENT ON COLUMN public.today_tasks.scheduled_call_id IS
  'MP239 — when a Google Calendar / Calendly event auto-generates a task row, this points back to apex_scheduled_calls.id so completion status round-trips.';
