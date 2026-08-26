-- Locked licensed/unlicensed one-link hire paths and a single licensing-stage
-- writer shared by applicants, agents, managers, and admins.

create or replace function public.get_invite_token_prefill(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invite_tokens%rowtype;
  v_locked boolean;
  v_license_status text;
begin
  select * into v_row
  from public.invite_tokens
  where token = p_token
    and is_active
    and used_at is null
    and expires_at > now()
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;

  v_locked := case
    when lower(coalesce(v_row.prefill_json->>'license_status_locked', 'false')) in ('true', 't', '1', 'yes') then true
    else false
  end;
  v_license_status := case
    when v_row.prefill_json->>'license_status' in ('licensed', 'unlicensed')
      then v_row.prefill_json->>'license_status'
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'kind', v_row.kind,
    'target_role', v_row.target_role,
    'expires_at', v_row.expires_at,
    'prefill', jsonb_build_object(
      'full_name', v_row.prefill_json->>'full_name',
      'phone', v_row.prefill_json->>'phone',
      'email', v_row.prefill_json->>'email',
      'state', v_row.prefill_json->>'state',
      'license_status', v_license_status,
      'license_status_locked', v_locked
    )
  );
end;
$$;

grant execute on function public.get_invite_token_prefill(text) to anon, authenticated;

create or replace function public.set_agent_license_progress(
  p_agent_id uuid,
  p_progress text,
  p_test_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      and ur.role in ('admin', 'super_admin', 'owner', 'va_manager', 'va')
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
$$;

revoke all on function public.set_agent_license_progress(uuid, text, date) from public, anon;
grant execute on function public.set_agent_license_progress(uuid, text, date) to authenticated, service_role;

comment on function public.set_agent_license_progress(uuid, text, date) is
  'Authorization-checked canonical licensing milestone writer. Keeps agents and every active application sharing the profile email in sync.';
