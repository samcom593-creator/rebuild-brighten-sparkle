-- wave-quiz-retakes — cap course tests at 3 retakes.
--
-- Today a failed module quiz can be retaken forever: CourseQuiz renders an
-- unconditional "Try Again" and useOnboardingCourse.submitQuiz just increments
-- `attempts` with nothing reading it back. An agent can brute-force a 4-option
-- multiple-choice test until it passes, which makes the pass threshold
-- decorative and the completion signal meaningless — and course completion is
-- what promotes someone into field training.
--
-- "3 retakes" is read as the first attempt plus three more, so 4 total. The
-- number lives in one function rather than in each of the three call sites
-- (CourseQuiz, useOnboardingCourse, TrainingHubCourse) so the UI copy and the
-- enforcement can never drift into disagreeing about how many tries are left —
-- the same single-source discipline as fn_alert_sms_fix_anchor.
--
-- Enforced in the DATABASE, not only in React. The UI hiding a button is not a
-- limit; the quiz submits through PostgREST and the answers are already in the
-- browser, so anything that only guards the component is advisory. The trigger
-- is the actual cap.
--
-- hub_course_progress had no attempts column at all, so Training Hub quizzes
-- were not merely uncapped, they were uncounted.

begin;

create or replace function public.course_max_attempts()
returns integer
language sql
immutable
as $$ select 4 $$;   -- 1 first attempt + 3 retakes

comment on function public.course_max_attempts() is
  'Total permitted attempts per course quiz (first attempt + 3 retakes). Single '
  'source for both the enforcement triggers and the attempts-remaining the UI '
  'renders, so the copy and the cap cannot disagree.';

grant execute on function public.course_max_attempts() to authenticated, anon, service_role;

alter table public.hub_course_progress
  add column if not exists attempts integer not null default 0;

-- ─── The cap ─────────────────────────────────────────────────────────────────
-- Guards only INCREASES to attempts, and only while the module is not yet
-- passed. A passing row is left alone: re-saving a completed module (the hub
-- writes progress on every item view) must never trip an attempts error, and
-- someone who has already passed has nothing left to brute-force.
create or replace function public.fn_enforce_quiz_attempt_cap()
returns trigger
language plpgsql
as $$
declare
  cap        integer := public.course_max_attempts();
  prior      integer := 0;
  was_passed boolean := false;
begin
  if TG_OP = 'UPDATE' then
    prior      := coalesce(OLD.attempts, 0);
    was_passed := coalesce(OLD.passed, false);
  end if;

  -- Not an increase (or already passed) → nothing to enforce.
  if coalesce(NEW.attempts, 0) <= prior or was_passed then
    return NEW;
  end if;

  if coalesce(NEW.attempts, 0) > cap then
    raise exception
      'quiz_attempts_exhausted: this test allows % attempts (first try plus % retakes)',
      cap, cap - 1
      using errcode = 'P0001',
            hint = 'Ask your manager to reset this module.';
  end if;

  return NEW;
end
$$;

drop trigger if exists trg_onboarding_attempt_cap on public.onboarding_progress;
create trigger trg_onboarding_attempt_cap
  before insert or update on public.onboarding_progress
  for each row execute function public.fn_enforce_quiz_attempt_cap();

drop trigger if exists trg_hub_attempt_cap on public.hub_course_progress;
create trigger trg_hub_attempt_cap
  before insert or update on public.hub_course_progress
  for each row execute function public.fn_enforce_quiz_attempt_cap();

-- ─── Manager reset ───────────────────────────────────────────────────────────
-- A hard cap with no way back is a support ticket for every agent who fails
-- four times, so the escape hatch ships with the cap rather than after the
-- first complaint. Staff only.
create or replace function public.reset_quiz_attempts(p_agent_id uuid, p_module_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_agency_staff() then
    raise exception 'not_authorized: only a manager or admin can reset quiz attempts'
      using errcode = '42501';
  end if;

  update public.onboarding_progress
     set attempts = 0, score = null, answers = null
   where agent_id = p_agent_id
     and module_id = p_module_id
     and coalesce(passed, false) = false;

  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.reset_quiz_attempts(uuid, uuid) from public, anon;
grant execute on function public.reset_quiz_attempts(uuid, uuid) to authenticated, service_role;

commit;
