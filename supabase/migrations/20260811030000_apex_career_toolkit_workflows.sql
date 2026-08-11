-- APEX Welcome Aboard + Career Growth Toolkit: executable, durable workflows.
--
-- Manual agents deliberately live outside public.applications. That table has
-- multiple INSERT triggers for applicant notifications, outreach, provisioning,
-- and application metrics. A staff-entered agent is not a web application and
-- must not send messages or inflate recruiting conversion counts.

create table if not exists public.apex_toolkit_agents (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  pa_number text not null,
  license_status text not null default 'licensed'
    check (license_status in ('licensed', 'unlicensed')),
  status text not null default 'active'
    check (status in ('active', 'hired', 'passed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apex_toolkit_agents_first_name_check
    check (char_length(btrim(first_name)) between 1 and 80 and first_name !~ '[[:cntrl:]]'),
  constraint apex_toolkit_agents_last_name_check
    check (char_length(btrim(last_name)) between 1 and 80 and last_name !~ '[[:cntrl:]]'),
  constraint apex_toolkit_agents_email_check
    check (char_length(btrim(email)) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  constraint apex_toolkit_agents_phone_check
    check (phone ~ '^\+[0-9]{8,15}$'),
  constraint apex_toolkit_agents_pa_number_check
    check (
      char_length(btrim(pa_number)) between 2 and 32
      and btrim(pa_number) ~ '^[A-Za-z0-9][A-Za-z0-9 -]*$'
    )
);

create unique index if not exists apex_toolkit_agents_email_unique
  on public.apex_toolkit_agents (lower(btrim(email)));

create unique index if not exists apex_toolkit_agents_pa_number_unique
  on public.apex_toolkit_agents (lower(btrim(pa_number)));

comment on table public.apex_toolkit_agents is
  'Staff-created APEX agents shown in the licensed inbox. Kept outside applications so no applicant outreach/provisioning trigger fires.';

comment on column public.apex_toolkit_agents.pa_number is
  'APEX PA number. This is not an NPN and must not be presented as NIPR verification.';

create table if not exists public.apex_agent_journeys (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  toolkit_agent_id uuid references public.apex_toolkit_agents(id) on delete cascade,
  path text not null check (path in ('licensed', 'unlicensed')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint apex_agent_journeys_one_subject_check
    check (num_nonnulls(application_id, toolkit_agent_id) = 1)
);

create unique index if not exists apex_agent_journeys_application_unique
  on public.apex_agent_journeys (application_id)
  where application_id is not null;

create unique index if not exists apex_agent_journeys_toolkit_agent_unique
  on public.apex_agent_journeys (toolkit_agent_id)
  where toolkit_agent_id is not null;

create table if not exists public.apex_agent_journey_steps (
  journey_id uuid not null references public.apex_agent_journeys(id) on delete cascade,
  step_key text not null,
  completed_at timestamptz not null default now(),
  completed_by uuid references auth.users(id) on delete set null,
  primary key (journey_id, step_key)
);

create table if not exists public.apex_toolkit_agent_contact_log (
  id uuid primary key default gen_random_uuid(),
  toolkit_agent_id uuid not null references public.apex_toolkit_agents(id) on delete cascade,
  channel text not null check (channel in ('call', 'sms', 'email', 'note')),
  outcome text not null,
  logged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists apex_toolkit_agent_contact_log_agent_created_idx
  on public.apex_toolkit_agent_contact_log (toolkit_agent_id, created_at desc);

comment on table public.apex_agent_journeys is
  'One persisted APEX toolkit path per existing application or staff-created toolkit agent.';

comment on table public.apex_agent_journey_steps is
  'Auditable completion ledger for licensed/unlicensed onboarding and 30/60/90-day milestones.';

create or replace function public.apex_toolkit_is_staff(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $fn$
  select p_user_id is not null and exists (
    select 1
      from public.user_roles ur
     where ur.user_id = p_user_id
       and ur.role::text in ('admin', 'manager', 'va_manager', 'va')
  );
$fn$;

create or replace function public.apex_toolkit_can_work_application(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $fn$
  select
    p_user_id is not null
    and exists (
      select 1
        from public.user_roles ur
       where ur.user_id = p_user_id
         and (
           ur.role::text in ('admin', 'va_manager', 'va')
           or (
             ur.role::text = 'manager'
             and exists (
               select 1
                 from public.applications a
                where a.id = p_application_id
                  and (
                    a.hiring_manager_user_id = p_user_id
                    or exists (
                      select 1
                        from public.agents manager_agent
                       where manager_agent.user_id = p_user_id
                         and manager_agent.id in (
                           a.assigned_agent_id,
                           a.referral_manager_id,
                           a.recruiter_id
                         )
                    )
                  )
             )
           )
         )
    );
$fn$;

alter table public.apex_toolkit_agents enable row level security;
alter table public.apex_agent_journeys enable row level security;
alter table public.apex_agent_journey_steps enable row level security;
alter table public.apex_toolkit_agent_contact_log enable row level security;

drop policy if exists apex_toolkit_agents_staff_access on public.apex_toolkit_agents;
create policy apex_toolkit_agents_staff_access
  on public.apex_toolkit_agents
  for all to authenticated
  using (public.apex_toolkit_is_staff())
  with check (public.apex_toolkit_is_staff());

drop policy if exists apex_agent_journeys_staff_access on public.apex_agent_journeys;
create policy apex_agent_journeys_staff_access
  on public.apex_agent_journeys
  for all to authenticated
  using (
    (toolkit_agent_id is not null and public.apex_toolkit_is_staff())
    or (application_id is not null and public.apex_toolkit_can_work_application(application_id))
  )
  with check (
    (toolkit_agent_id is not null and public.apex_toolkit_is_staff())
    or (application_id is not null and public.apex_toolkit_can_work_application(application_id))
  );

drop policy if exists apex_agent_journey_steps_staff_access on public.apex_agent_journey_steps;
create policy apex_agent_journey_steps_staff_access
  on public.apex_agent_journey_steps
  for all to authenticated
  using (
    exists (
      select 1
        from public.apex_agent_journeys journey
       where journey.id = journey_id
         and (
           (journey.toolkit_agent_id is not null and public.apex_toolkit_is_staff())
           or (
             journey.application_id is not null
             and public.apex_toolkit_can_work_application(journey.application_id)
           )
         )
    )
  )
  with check (
    exists (
      select 1
        from public.apex_agent_journeys journey
       where journey.id = journey_id
         and (
           (journey.toolkit_agent_id is not null and public.apex_toolkit_is_staff())
           or (
             journey.application_id is not null
             and public.apex_toolkit_can_work_application(journey.application_id)
           )
         )
    )
  );

drop policy if exists apex_toolkit_agent_contact_log_staff_access on public.apex_toolkit_agent_contact_log;
create policy apex_toolkit_agent_contact_log_staff_access
  on public.apex_toolkit_agent_contact_log
  for all to authenticated
  using (public.apex_toolkit_is_staff())
  with check (public.apex_toolkit_is_staff());

grant select, insert, update, delete on public.apex_toolkit_agents to authenticated;
grant select, insert, update, delete on public.apex_agent_journeys to authenticated;
grant select, insert, update, delete on public.apex_agent_journey_steps to authenticated;
grant select, insert, update, delete on public.apex_toolkit_agent_contact_log to authenticated;

create or replace function public.create_apex_toolkit_agent(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_pa_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone_input text := btrim(coalesce(p_phone, ''));
  v_phone_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone text;
  v_pa_number text := upper(regexp_replace(btrim(coalesce(p_pa_number, '')), '[[:space:]]+', ' ', 'g'));
  v_toolkit_agent_id uuid;
  v_journey_id uuid;
begin
  if not public.apex_toolkit_is_staff(v_user_id) then
    raise exception using errcode = '42501', message = 'Admin, manager, or recruiting-operations access is required.';
  end if;

  if char_length(v_first_name) not between 1 and 80
     or v_first_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Enter a valid first name.';
  end if;
  if char_length(v_last_name) not between 1 and 80
     or v_last_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Enter a valid last name.';
  end if;
  if char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid email address.';
  end if;

  if char_length(v_phone_digits) = 10 then
    v_phone := '+1' || v_phone_digits;
  elsif char_length(v_phone_digits) = 11 and left(v_phone_digits, 1) = '1' then
    v_phone := '+' || v_phone_digits;
  elsif left(v_phone_input, 1) = '+' and char_length(v_phone_digits) between 8 and 15 then
    v_phone := '+' || v_phone_digits;
  else
    raise exception using errcode = '22023', message = 'Enter a valid US or international phone number.';
  end if;

  if char_length(v_pa_number) not between 2 and 32
     or v_pa_number !~ '^[A-Za-z0-9][A-Za-z0-9 -]*$' then
    raise exception using errcode = '22023', message = 'Enter a valid PA number.';
  end if;

  if exists (select 1 from public.apex_toolkit_agents where lower(email) = v_email) then
    raise exception using errcode = '23505', message = 'An agent with this email already exists.';
  end if;
  if exists (select 1 from public.applications where lower(email) = v_email) then
    raise exception using errcode = '23505', message = 'An applicant with this email already exists.';
  end if;
  if exists (
    select 1 from public.apex_toolkit_agents where lower(btrim(pa_number)) = lower(v_pa_number)
  ) then
    raise exception using errcode = '23505', message = 'An agent with this PA number already exists.';
  end if;

  insert into public.apex_toolkit_agents (
    first_name,
    last_name,
    email,
    phone,
    pa_number,
    created_by
  ) values (
    v_first_name,
    v_last_name,
    v_email,
    v_phone,
    v_pa_number,
    v_user_id
  )
  returning id into v_toolkit_agent_id;

  insert into public.apex_agent_journeys (toolkit_agent_id, path, updated_by)
  values (v_toolkit_agent_id, 'licensed', v_user_id)
  returning id into v_journey_id;

  insert into public.apex_agent_journey_steps (
    journey_id,
    step_key,
    completed_by
  ) values (
    v_journey_id,
    'welcome',
    v_user_id
  );

  return jsonb_build_object(
    'agentId', v_toolkit_agent_id,
    'subjectType', 'toolkit_agent',
    'path', 'licensed',
    'message', format('%s %s was added to the licensed journey.', v_first_name, v_last_name)
  );
end;
$fn$;

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
    'agentlink', 'signatures', 'contracting', 'community', 'training',
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

revoke all on function public.apex_toolkit_is_staff(uuid) from public;
revoke all on function public.apex_toolkit_can_work_application(uuid, uuid) from public;
revoke all on function public.create_apex_toolkit_agent(text, text, text, text, text) from public;
revoke all on function public.set_apex_journey_step(text, uuid, text, boolean) from public;

grant execute on function public.apex_toolkit_is_staff(uuid) to authenticated;
grant execute on function public.apex_toolkit_can_work_application(uuid, uuid) to authenticated;
grant execute on function public.create_apex_toolkit_agent(text, text, text, text, text) to authenticated;
grant execute on function public.set_apex_journey_step(text, uuid, text, boolean) to authenticated;
