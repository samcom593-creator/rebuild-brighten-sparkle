-- AgentCloud-parity client workspace. Keep AgentLink as the imported source,
-- while durable APEX actions live in an overlay that an inbound sync cannot
-- overwrite.

create table if not exists public.client_pipeline_overrides (
  client_id uuid primary key references public.agentlink_clients(id) on delete cascade,
  stage_override text,
  stage_changed_at timestamptz,
  last_contact_date timestamptz,
  next_action_date timestamptz,
  callback_date date,
  callback_time text,
  schedule_overridden boolean not null default false,
  communication_notes text,
  reminder_notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint client_pipeline_stage_check check (
    stage_override is null or stage_override in (
      'NEW_INITIAL','WORKING','PITCHED','ALMOST_THERE','SOLD','FOLLOW_UP','INACTIVE','LOST'
    )
  )
);

create table if not exists public.client_pipeline_activity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.agentlink_clients(id) on delete cascade,
  activity_type text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists client_pipeline_activity_client_created_idx
  on public.client_pipeline_activity(client_id, created_at desc);

alter table public.client_pipeline_overrides enable row level security;
alter table public.client_pipeline_activity enable row level security;

create or replace function public.fn_can_access_pipeline_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select auth.uid() is not null and (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or exists (
      select 1
      from public.agentlink_clients c
      join public.agents a on a.id = c.agent_id
      where c.id = p_client_id
        and (
          a.user_id = auth.uid()
          or a.manager_id = public.get_agent_id(auth.uid())
          or a.invited_by_manager_id = public.get_agent_id(auth.uid())
        )
    )
  );
$$;

drop policy if exists client_pipeline_overrides_read on public.client_pipeline_overrides;
create policy client_pipeline_overrides_read on public.client_pipeline_overrides
  for select using (public.fn_can_access_pipeline_client(client_id));

drop policy if exists client_pipeline_activity_read on public.client_pipeline_activity;
create policy client_pipeline_activity_read on public.client_pipeline_activity
  for select using (public.fn_can_access_pipeline_client(client_id));

grant select on public.client_pipeline_overrides, public.client_pipeline_activity to authenticated;

create or replace function public.fn_client_pipeline_create(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_agent_id uuid;
  v_client_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_first_name), '') is null or nullif(btrim(p_last_name), '') is null then
    raise exception 'First and last name are required';
  end if;
  if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 10 then
    raise exception 'A valid phone number is required';
  end if;

  v_agent_id := public.get_agent_id(auth.uid());
  if v_agent_id is null then raise exception 'No agent record is linked to this account'; end if;

  insert into public.agentlink_clients (
    agent_id, first_name, last_name, phone, email, pipeline_stage,
    external_source, created_at, updated_at
  ) values (
    v_agent_id, left(btrim(p_first_name), 120), left(btrim(p_last_name), 120),
    left(btrim(p_phone), 40), nullif(left(btrim(coalesce(p_email, '')), 254), ''),
    'NEW_INITIAL', 'apex', now(), now()
  ) returning id into v_client_id;

  insert into public.client_pipeline_activity(client_id, activity_type, body, created_by)
  values (v_client_id, 'client_created', 'Client added to pipeline', auth.uid());

  return v_client_id;
end;
$$;

create or replace function public.fn_client_pipeline_action(
  p_client_id uuid,
  p_stage text default null,
  p_callback_date date default null,
  p_callback_time text default null,
  p_next_action_date timestamptz default null,
  p_communication_notes text default null,
  p_reminder_notes text default null,
  p_activity_type text default null,
  p_activity_body text default null,
  p_replace_schedule boolean default false,
  p_replace_notes boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public.fn_can_access_pipeline_client(p_client_id) then
    raise exception 'Client not found or access denied';
  end if;
  if p_stage is not null and p_stage not in (
    'NEW_INITIAL','WORKING','PITCHED','ALMOST_THERE','SOLD','FOLLOW_UP','INACTIVE','LOST'
  ) then raise exception 'Invalid pipeline stage'; end if;

  insert into public.client_pipeline_overrides (
    client_id, stage_override, stage_changed_at, last_contact_date, next_action_date,
    callback_date, callback_time, schedule_overridden, communication_notes, reminder_notes,
    updated_by, updated_at
  ) values (
    p_client_id, p_stage, case when p_stage is not null then now() else null end,
    case when p_activity_type = 'contact_logged' then now() else null end,
    p_next_action_date, p_callback_date, nullif(left(btrim(coalesce(p_callback_time, '')), 40), ''), p_replace_schedule,
    case when p_communication_notes is null then null else left(p_communication_notes, 10000) end,
    case when p_reminder_notes is null then null else left(p_reminder_notes, 10000) end,
    auth.uid(), now()
  )
  on conflict (client_id) do update set
    stage_override = coalesce(excluded.stage_override, client_pipeline_overrides.stage_override),
    stage_changed_at = case when excluded.stage_override is not null then now() else client_pipeline_overrides.stage_changed_at end,
    last_contact_date = coalesce(excluded.last_contact_date, client_pipeline_overrides.last_contact_date),
    next_action_date = case when p_replace_schedule then excluded.next_action_date else client_pipeline_overrides.next_action_date end,
    callback_date = case when p_replace_schedule then excluded.callback_date else client_pipeline_overrides.callback_date end,
    callback_time = case when p_replace_schedule then excluded.callback_time else client_pipeline_overrides.callback_time end,
    schedule_overridden = client_pipeline_overrides.schedule_overridden or p_replace_schedule,
    communication_notes = case when p_replace_notes then excluded.communication_notes else client_pipeline_overrides.communication_notes end,
    reminder_notes = case when p_replace_notes then excluded.reminder_notes else client_pipeline_overrides.reminder_notes end,
    updated_by = auth.uid(),
    updated_at = now();

  if p_stage is not null or p_activity_type is not null or p_activity_body is not null then
    insert into public.client_pipeline_activity(client_id, activity_type, body, metadata, created_by)
    values (
      p_client_id,
      coalesce(nullif(p_activity_type, ''), case when p_stage = 'SOLD' then 'marked_sold' else 'stage_changed' end),
      nullif(left(btrim(coalesce(p_activity_body, '')), 2000), ''),
      case when p_stage is null then '{}'::jsonb else jsonb_build_object('stage', p_stage) end,
      auth.uid()
    );
  end if;
end;
$$;

revoke all on function public.fn_can_access_pipeline_client(uuid) from public;
revoke all on function public.fn_client_pipeline_create(text,text,text,text) from public;
revoke all on function public.fn_client_pipeline_action(uuid,text,date,text,timestamptz,text,text,text,text,boolean,boolean) from public;
grant execute on function public.fn_can_access_pipeline_client(uuid) to authenticated;
grant execute on function public.fn_client_pipeline_create(text,text,text,text) to authenticated;
grant execute on function public.fn_client_pipeline_action(uuid,text,date,text,timestamptz,text,text,text,text,boolean,boolean) to authenticated;
