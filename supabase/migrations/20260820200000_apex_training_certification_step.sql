-- Continue the recruit journey after licensing with an explicit APEX
-- certification receipt. The UI already persists every other milestone through
-- this function; the allowlist must advance with the workflow or Certification
-- would render as clickable while the database rejects it.

create or replace function public.set_apex_journey_step(
  p_subject_type text,
  p_subject_id uuid,
  p_step_key text,
  p_complete boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_subject_type text := lower(btrim(coalesce(p_subject_type, '')));
  v_step_key text := lower(btrim(coalesce(p_step_key, '')));
  v_path text;
  v_journey_id uuid;
  v_allowed_steps constant text[] := array[
    'welcome', 'course_active', 'exam_ready', 'exam_scheduled', 'exam_passed', 'licensed',
    'agentlink', 'signatures', 'contracting', 'community', 'training', 'certification',
    'launch_ready', 'production', 'first_appointment', 'first_application',
    'first_sale', 'first_consistent_month', 'first_leadership_responsibility',
    'day_30_activated', 'day_60_activity', 'day_90_consistency'
  ];
begin
  if v_subject_type = 'application' then
    if not public.apex_toolkit_can_work_application(p_subject_id, v_user_id) then
      raise exception using errcode = '42501', message = 'You do not have access to this agent journey.';
    end if;
    select j.id, j.path into v_journey_id, v_path
      from public.apex_agent_journeys j
     where j.application_id = p_subject_id;
    if v_journey_id is null then
      select case when a.license_status = 'licensed' then 'licensed' else 'unlicensed' end
        into v_path
        from public.applications a
       where a.id = p_subject_id;
      if v_path is null then
        raise exception using errcode = 'P0002', message = 'Agent record not found.';
      end if;
      insert into public.apex_agent_journeys (application_id, path, updated_by)
      values (p_subject_id, v_path, v_user_id)
      returning id into v_journey_id;
    end if;
  elsif v_subject_type = 'toolkit_agent' then
    if not public.apex_toolkit_is_staff(v_user_id)
       or not exists (select 1 from public.apex_toolkit_agents where id = p_subject_id) then
      raise exception using errcode = '42501', message = 'You do not have access to this agent journey.';
    end if;
    select j.id, j.path into v_journey_id, v_path
      from public.apex_agent_journeys j
     where j.toolkit_agent_id = p_subject_id;
    if v_journey_id is null then
      v_path := 'licensed';
      insert into public.apex_agent_journeys (toolkit_agent_id, path, updated_by)
      values (p_subject_id, v_path, v_user_id)
      returning id into v_journey_id;
    end if;
  else
    raise exception using errcode = '22023', message = 'Unknown APEX journey subject.';
  end if;

  if not (v_step_key = any(v_allowed_steps)) then
    raise exception using errcode = '22023', message = 'Unknown APEX journey step.';
  end if;
  if v_path = 'licensed' and v_step_key = any(array[
    'course_active', 'exam_ready', 'exam_scheduled', 'exam_passed', 'licensed'
  ]) then
    raise exception using errcode = '22023', message = 'That licensing step belongs to the unlicensed journey.';
  end if;

  if p_complete then
    insert into public.apex_agent_journey_steps (
      journey_id,
      step_key,
      completed_by
    ) values (
      v_journey_id,
      v_step_key,
      v_user_id
    )
    on conflict (journey_id, step_key) do update
      set completed_at = now(), completed_by = excluded.completed_by;
  else
    delete from public.apex_agent_journey_steps
     where journey_id = v_journey_id
       and step_key = v_step_key;
  end if;

  update public.apex_agent_journeys
     set updated_at = now(), updated_by = v_user_id
   where id = v_journey_id;

  return jsonb_build_object(
    'subjectType', v_subject_type,
    'subjectId', p_subject_id,
    'stepKey', v_step_key,
    'complete', p_complete,
    'path', v_path
  );
end;
$fn$;

revoke all on function public.set_apex_journey_step(text, uuid, text, boolean) from public;
grant execute on function public.set_apex_journey_step(text, uuid, text, boolean) to authenticated;
