-- MP-338: training's next-step link points at the canonical /dashboard/training
-- path instead of /dashboard/recruiting/training.
--
-- Sam, twice now: training "should not be hidden away" and agents need it
-- "easier to find". It was mounted under /dashboard/recruiting/* — the section
-- meaning "recruiting other agents" — so an agent hunting for a sales script
-- was looking in the wrong place by construction. The old routes stay mounted,
-- so every link already shared keeps resolving; this just stops the dashboard
-- card from teaching the buried path to everyone who clicks it.

begin;
CREATE OR REPLACE FUNCTION public.my_training_next_step()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agent uuid; v_user uuid := auth.uid(); v_email text;
  v_licensed boolean := false; v_stage text;
  v_total int := 0; v_passed int := 0;
  v_next_id uuid; v_next_title text;
  v_xcel_pct numeric;
  v_has_book boolean; v_recent boolean; v_dead int;
  v_rec_title text; v_rec_id uuid; v_rec_reason text;
begin
  if v_user is null then return jsonb_build_object('state','anonymous'); end if;

  select a.id into v_agent from public.agents a where a.user_id = v_user limit 1;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = v_user;
  if v_agent is null then return jsonb_build_object('state','no_agent_record'); end if;

  select coalesce(a.license_status::text,'') = 'licensed' into v_licensed
  from public.agents a where a.id = v_agent;

  if not v_licensed then
    select ap.license_progress::text into v_stage
    from public.applications ap
    where lower(trim(ap.email)) = v_email and ap.terminated_at is null
    order by ap.created_at desc limit 1;

    select x.overall_pct_max into v_xcel_pct
    from public.v_xcel_person_progress x
    where lower(trim(x.email)) = v_email limit 1;

    return jsonb_build_object(
      'state','prelicensing',
      'stage', coalesce(v_stage,'unlicensed'),
      'course_pct', v_xcel_pct,
      'next_label', case coalesce(v_stage,'unlicensed')
        when 'unlicensed' then 'Enroll in your prelicensing course'
        when 'course_purchased' then 'Start your course'
        when 'finished_course' then 'Schedule your state exam'
        when 'test_scheduled' then 'Pass your state exam'
        when 'passed_test' then 'Submit your license application'
        when 'waiting_on_license' then 'Waiting on your license number'
        else 'Continue your licensing' end,
      'next_href','/dashboard/getting-started');
  end if;

  select count(*) into v_total from public.onboarding_modules where is_active;
  select count(*) into v_passed
  from public.onboarding_progress p
  join public.onboarding_modules m on m.id = p.module_id and m.is_active
  where p.agent_id = v_agent and coalesce(p.passed,false);

  select m.id, m.title into v_next_id, v_next_title
  from public.onboarding_modules m
  where m.is_active and not exists (
    select 1 from public.onboarding_progress p
    where p.agent_id = v_agent and p.module_id = m.id and coalesce(p.passed,false))
  order by m.order_index limit 1;

  -- ── The recommendation, from signals that actually carry data ───────────
  select exists(select 1 from public.agentlink_book b where b.agent_id = v_agent)
    into v_has_book;
  select exists(select 1 from public.agentlink_book b
                 where b.agent_id = v_agent and b.posted_date > current_date - 30)
    into v_recent;
  select count(*) into v_dead
  from public.agentlink_book b where b.agent_id = v_agent and b.is_dead;

  if not v_has_book then
    v_rec_reason := 'You have not posted a deal yet — this is the workflow for it.';
    select id, title into v_rec_id, v_rec_title from public.onboarding_modules
     where is_active and title ilike '%Pipeline%' order by order_index limit 1;
  elsif v_dead >= 3 then
    v_rec_reason := format('%s of your policies have lapsed or fallen off. Field underwriting is where that gets fixed.', v_dead);
    select id, title into v_rec_id, v_rec_title from public.onboarding_modules
     where is_active and title ilike '%Underwriting%' order by order_index limit 1;
  elsif not v_recent then
    v_rec_reason := 'No posted deal in the last 30 days — worth re-running the script.';
    select id, title into v_rec_id, v_rec_title from public.onboarding_modules
     where is_active and title ilike '%Script Mastery%' order by order_index limit 1;
  end if;

  return jsonb_build_object(
    'state', case when v_next_id is null then 'course_complete' else 'in_course' end,
    'modules_total', v_total,
    'modules_passed', v_passed,
    'next_module_id', v_next_id,
    'next_module_title', v_next_title,
    'next_label', coalesce('Continue: ' || v_next_title, 'Explore the training library'),
    'next_href','/dashboard/training/sales-course',
    -- null when nothing is struggling. A recommendation with no reason is a
    -- guess, so the reason ships with it or neither does.
    'recommended_title', v_rec_title,
    'recommended_reason', v_rec_reason);
end
$function$
;
commit;
