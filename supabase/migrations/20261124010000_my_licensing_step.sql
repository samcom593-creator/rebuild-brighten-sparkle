-- MP-LICENSING-STEP (2026-11-23, Sam: "be more up to date with where agents are within their steps of
-- licensing ... make it easier to bring them back on board"). Measured: 24 of 28 active unlicensed agents and
-- 93 of 97 unlicensed applicants of the last 90 days are recorded only as "unlicensed"; the course feed last
-- updated 2026-08-07. set_agent_license_progress() already lets an agent set their own step, but the only
-- control for it is a dropdown inside the agent dashboard that nobody is asked to use.
--
-- my_licensing_step(): what the signed-in agent's own record says, for a one-tap check-in on their Home.
-- The owner's call lists drop their cached copy when a step changes.

create or replace function public.my_licensing_step()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object('agent_id', a.id,
                               'licensed', a.license_status::text = 'licensed',
                               'step', a.license_progress::text)
       from public.agents a
      where a.user_id = auth.uid()
        and a.status::text = 'active'
        and coalesce(a.is_deactivated, false) = false
        and coalesce(a.is_inactive, false) = false
        and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
        and coalesce(a.account_mode, 'agent') <> 'admin'
      order by a.created_at
      limit 1),
    jsonb_build_object('agent_id', null))
$function$;
revoke all on function public.my_licensing_step() from public, anon;
grant execute on function public.my_licensing_step() to authenticated;

drop trigger if exists trg_owner_lists_cache_license_step on public.agents;
create trigger trg_owner_lists_cache_license_step after update of license_progress, license_status on public.agents
  for each statement execute function public.fn_owner_lists_cache_clear();

-- set_agent_license_progress() compared the app_role enum to two names that are not in it (super_admin, owner),
-- so every call raised "invalid input value for enum app_role" before doing anything: the step selector on the
-- agent dashboard, the agent drawer and the pipeline could not save for anyone. Restated with the role read as text.
CREATE OR REPLACE FUNCTION public.set_agent_license_progress(p_agent_id uuid, p_progress text, p_test_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_agent_id uuid;
  v_target public.agents%rowtype;
  v_is_staff boolean;
  v_email text;
  v_now timestamptz := now();
begin
  if p_progress not in (
    'unlicensed', 'course_purchased', 'finished_course', 'test_scheduled',
    'failed_test', 'passed_test', 'fingerprints_done', 'waiting_on_license', 'licensed'
  ) then
    raise exception 'invalid_license_progress';
  end if;

  select * into v_target from public.agents where id = p_agent_id;
  if v_target.id is null then raise exception 'agent_not_found'; end if;

  select a.id into v_actor_agent_id
  from public.agents a
  where a.user_id = auth.uid()
  order by a.created_at
  limit 1;

  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text in ('admin', 'super_admin', 'owner', 'va_manager', 'va')
  ) into v_is_staff;

  if auth.role() <> 'service_role'
     and auth.uid() <> v_target.user_id
     and not v_is_staff
     and coalesce(v_target.manager_id, v_target.invited_by_manager_id) <> v_actor_agent_id then
    raise exception 'forbidden';
  end if;

  if p_progress = 'licensed'
     and length(regexp_replace(coalesce(v_target.nipr_number, ''), '[^0-9]', '', 'g')) not between 5 and 10 then
    raise exception 'npn_required_before_licensed';
  end if;

  update public.agents
  set license_progress = p_progress::public.license_progress,
      license_status = (case when p_progress = 'licensed' then 'licensed'
                             when license_status = 'licensed' then 'pending'
                             else license_status::text end)::public.license_status,
      licensed_at = case when p_progress = 'licensed' then coalesce(licensed_at, v_now)
                         when license_status = 'licensed' then null
                         else licensed_at end,
      updated_at = v_now
  where id = p_agent_id;

  select lower(btrim(p.email)) into v_email
  from public.profiles p
  where p.id = v_target.profile_id
  limit 1;

  if v_email is not null then
    update public.applications
    set license_progress = p_progress::public.license_progress,
        license_status = (case when p_progress = 'licensed' then 'licensed'
                               when license_status = 'licensed' then 'pending'
                               else license_status::text end)::public.license_status,
        test_scheduled_date = case when p_progress = 'test_scheduled' then p_test_date
                                   else test_scheduled_date end,
        exam_scheduled_at = case when p_progress = 'test_scheduled' and p_test_date is not null
                                 then p_test_date::timestamptz else exam_scheduled_at end,
        exam_passed_at = case when p_progress in ('passed_test', 'fingerprints_done', 'waiting_on_license', 'licensed')
                              then coalesce(exam_passed_at, v_now) else exam_passed_at end,
        fingerprints_submitted_at = case when p_progress in ('fingerprints_done', 'waiting_on_license', 'licensed')
                                         then coalesce(fingerprints_submitted_at, v_now) else fingerprints_submitted_at end,
        licensed_at = case when p_progress = 'licensed' then coalesce(licensed_at, v_now)
                           when license_status = 'licensed' then null else licensed_at end,
        updated_at = v_now
    where lower(btrim(email)) = v_email
      and terminated_at is null;
  end if;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'progress', p_progress);
end;
$function$;
