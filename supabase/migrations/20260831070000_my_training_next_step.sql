-- wave-training-front-and-center — one call that answers "what should I learn next?"
--
-- Sam: "Training should be one of the easiest things... As soon as they log in,
-- the first time, you should see it... it should not be hidden away in
-- resources."
--
-- MEASURED before building:
--   onboarding_modules (active)         8
--   onboarding_progress rows          248 across 92 agents   ← real adoption
--   hub_course_progress rows           24 across  6 users    ← effectively unused
--   active agents                      65
--   v_xcel_person_progress             63 people, avg 44% complete, 29 finished
--   applications.license_progress      584 unlicensed / 54 course_purchased /
--                                      18 finished_course / 4 test_scheduled /
--                                      6 passed_test / 3 waiting_on_license
--
-- The course people actually use has 92 agents in it; the hub has 6. That gap is
-- the complaint — the material exists and nothing points at it.
--
-- ONE RPC rather than the four client queries this card would otherwise need
-- (agent row, modules, progress, licensing stage). It resolves the caller from
-- auth.uid() and takes no arguments, so one agent cannot ask for another's
-- training state.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN: a course-completion percentage for
-- prelicensing unless XCEL actually has one. exam_scheduled_at and licensed_at
-- are NULL on every row in `applications` while license_progress says 4 people
-- are test_scheduled and 135 are licensed, so the timestamp columns are dead and
-- license_progress is the live field. Showing a percentage derived from dead
-- columns would be a number that looks precise and means nothing.

begin;

create or replace function public.my_training_next_step()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agent      uuid;
  v_user       uuid := auth.uid();
  v_email      text;
  v_licensed   boolean := false;
  v_stage      text;
  v_total      int := 0;
  v_passed     int := 0;
  v_next_id    uuid;
  v_next_title text;
  v_xcel_pct   numeric;
begin
  if v_user is null then
    return jsonb_build_object('state', 'anonymous');
  end if;

  select a.id into v_agent from public.agents a where a.user_id = v_user limit 1;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = v_user;

  if v_agent is null then
    return jsonb_build_object('state', 'no_agent_record');
  end if;

  select coalesce(a.license_status::text, '') = 'licensed' into v_licensed
  from public.agents a where a.id = v_agent;

  -- ── Unlicensed: the licensing ladder is the training ────────────────────
  if not v_licensed then
    select ap.license_progress::text into v_stage
    from public.applications ap
    where lower(trim(ap.email)) = v_email
      and ap.terminated_at is null
    order by ap.created_at desc
    limit 1;

    -- Real course progress ONLY if XCEL has it for this person.
    select x.overall_pct_max into v_xcel_pct
    from public.v_xcel_person_progress x
    where lower(trim(x.email)) = v_email
    limit 1;

    return jsonb_build_object(
      'state', 'prelicensing',
      'stage', coalesce(v_stage, 'unlicensed'),
      'course_pct', v_xcel_pct,          -- null when XCEL has nothing; never faked
      'next_label', case coalesce(v_stage, 'unlicensed')
        when 'unlicensed'         then 'Enroll in your prelicensing course'
        when 'course_purchased'   then 'Start your course'
        when 'finished_course'    then 'Schedule your state exam'
        when 'test_scheduled'     then 'Pass your state exam'
        when 'passed_test'        then 'Submit your license application'
        when 'waiting_on_license' then 'Waiting on your license number'
        else 'Continue your licensing'
      end,
      'next_href', '/dashboard/getting-started'
    );
  end if;

  -- ── Licensed: the module course ─────────────────────────────────────────
  select count(*) into v_total from public.onboarding_modules where is_active;

  select count(*) into v_passed
  from public.onboarding_progress p
  join public.onboarding_modules m on m.id = p.module_id and m.is_active
  where p.agent_id = v_agent and coalesce(p.passed, false);

  select m.id, m.title into v_next_id, v_next_title
  from public.onboarding_modules m
  where m.is_active
    and not exists (
      select 1 from public.onboarding_progress p
      where p.agent_id = v_agent and p.module_id = m.id and coalesce(p.passed, false)
    )
  order by m.order_index
  limit 1;

  return jsonb_build_object(
    'state', case when v_next_id is null then 'course_complete' else 'in_course' end,
    'modules_total', v_total,
    'modules_passed', v_passed,
    'next_module_id', v_next_id,
    'next_module_title', v_next_title,
    'next_label', coalesce('Continue: ' || v_next_title, 'Explore the training library'),
    'next_href', '/dashboard/recruiting/training/sales-course'
  );
end
$$;

revoke all on function public.my_training_next_step() from public, anon;
grant execute on function public.my_training_next_step() to authenticated, service_role;

comment on function public.my_training_next_step() is
  'The caller''s single next training action. Takes no arguments and resolves '
  'the agent from auth.uid(), so one agent cannot request another''s state. '
  'Returns course_pct only when XCEL genuinely has one — the applications '
  'timestamp columns (exam_scheduled_at, licensed_at) are dead and would '
  'produce a precise-looking number that means nothing.';

commit;
