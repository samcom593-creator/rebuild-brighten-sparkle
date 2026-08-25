-- Team is usable by every authenticated agent without exposing unrelated legs.
-- Contacts resolve from the portal profile first, then Auth/application records
-- already owned by APEX. No AgentLink runtime dependency is introduced.

begin;

create or replace function public.apex_can_read_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive visible_agents(id, path) as (
    select a.id, array[a.id]::uuid[]
    from public.agents a
    where a.user_id = auth.uid()

    union all

    select child.id, parent.path || child.id
    from visible_agents parent
    join public.agents child
      on child.manager_id = parent.id
      or child.invited_by_manager_id = parent.id
    where not child.id = any(parent.path)
  )
  select public.apex_is_admin()
    or p_agent_id in (select id from visible_agents);
$$;

revoke all on function public.apex_can_read_agent(uuid) from public, anon;
grant execute on function public.apex_can_read_agent(uuid) to authenticated;

create or replace function public.crm_can_read_roster()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
       public.apex_is_admin()
    or public.has_role(auth.uid(), 'manager')
    or public.has_role(auth.uid(), 'va_manager')
    or public.has_role(auth.uid(), 'va')
    or exists (
      select 1 from public.agents a
      where a.user_id = auth.uid()
        and coalesce(a.is_deactivated, false) = false
    )
  );
$$;

create or replace function public.crm_can_read_agent_scope(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.apex_is_admin()
    or public.has_role(auth.uid(), 'va_manager')
    or public.has_role(auth.uid(), 'va')
    or public.apex_can_read_agent(p_agent_id);
$$;

revoke all on function public.crm_can_read_roster() from public, anon;
revoke all on function public.crm_can_read_agent_scope(uuid) from public, anon;
grant execute on function public.crm_can_read_roster() to authenticated;
grant execute on function public.crm_can_read_agent_scope(uuid) to authenticated;

create or replace function public.crm_agent_contacts()
returns table(agent_id uuid, full_name text, email text, phone text)
language sql
stable
security definer
set search_path = public, auth
as $function$
with base as (
  select
    a.id,
    a.source_application_id,
    a.display_name,
    nullif(btrim(coalesce(pu.full_name, pp.full_name)), '') as profile_name,
    nullif(btrim(coalesce(pu.email, pp.email)), '') as profile_email,
    nullif(btrim(coalesce(pu.phone, pp.phone)), '') as profile_phone,
    nullif(btrim(au.email::text), '') as auth_email,
    nullif(btrim(au.phone::text), '') as auth_phone,
    nullif(btrim(au.raw_user_meta_data ->> 'phone'), '') as auth_meta_phone
  from public.agents a
  left join public.profiles pu on pu.user_id = a.user_id
  left join public.profiles pp on pp.id = a.profile_id
  left join auth.users au on au.id = a.user_id
  where public.crm_can_read_roster()
    and public.crm_can_read_agent_scope(a.id)
    and coalesce(a.is_inactive, false) = false
    and coalesce(a.is_deactivated, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
)
select
  b.id,
  coalesce(
    b.profile_name,
    nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
    nullif(btrim(b.display_name), ''),
    'Name not on file'
  ),
  coalesce(b.profile_email, b.auth_email, nullif(btrim(ap.email), '')),
  coalesce(
    b.profile_phone,
    b.auth_phone,
    b.auth_meta_phone,
    nullif(btrim(ap.phone), '')
  )
from base b
left join lateral (
  select x.first_name, x.last_name, x.email, x.phone
  from public.applications x
  where x.id = b.source_application_id
     or (
       coalesce(b.profile_email, b.auth_email) is not null
       and lower(btrim(x.email)) = lower(coalesce(b.profile_email, b.auth_email))
     )
  order by
    (x.id = b.source_application_id) desc,
    (nullif(btrim(x.phone), '') is not null) desc,
    x.updated_at desc nulls last
  limit 1
) ap on true;
$function$;

comment on function public.crm_agent_contacts() is
  'Role-scoped Team contacts. Profile wins, then Auth and the matching APEX application; unrelated hierarchy rows are never returned.';

revoke all on function public.crm_agent_contacts() from public, anon;
grant execute on function public.crm_agent_contacts() to authenticated;

-- Preserve the existing enum values for compatibility while giving them the
-- actual operating meaning: test=Onboarding, classroom=Training Complete.
create or replace view public.v_agent_training_stage as
with base as (
  select
    a.id as agent_id,
    a.license_status,
    a.onboarding_stage,
    a.first_deal_at,
    a.field_training_started_at,
    a.contracted_at,
    a.onboarding_completed_at,
    a.created_at,
    a.is_deactivated,
    a.is_inactive,
    a.training_stage_override,
    a.training_stage_override_at,
    a.training_stage_override_by
  from public.agents a
)
select
  agent_id,
  coalesce(
    training_stage_override,
    case
      when first_deal_at is not null then 'active'::public.agent_training_stage
      when field_training_started_at is not null or onboarding_stage = 'in_field_training'
        then 'field'::public.agent_training_stage
      when onboarding_completed_at is not null
        then 'classroom'::public.agent_training_stage
      else 'test'::public.agent_training_stage
    end
  ) as stage,
  created_at as test_started_at,
  onboarding_completed_at as classroom_started_at,
  coalesce(
    field_training_started_at,
    case when onboarding_stage = 'in_field_training' then contracted_at end
  ) as field_started_at,
  first_deal_at as active_started_at,
  license_status,
  onboarding_stage,
  training_stage_override,
  training_stage_override_at,
  training_stage_override_by,
  is_deactivated,
  is_inactive
from base;

comment on view public.v_agent_training_stage is
  'Onboarding -> Training Complete -> Field -> Active. Training completion follows agents.onboarding_completed_at; manual override wins.';

create or replace function public.set_agent_training_stage(
  p_agent_id uuid,
  p_stage public.agent_training_stage default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_agent_id uuid;
  v_effective public.agent_training_stage;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.apex_is_admin() and not (
    public.has_role(auth.uid(), 'manager')
    and public.apex_can_read_agent(p_agent_id)
  ) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;

  select a.id into v_actor_agent_id
  from public.agents a
  where a.user_id = auth.uid()
  order by (a.canonical_agent_id is null) desc, a.created_at desc
  limit 1;

  update public.agents
  set
    training_stage_override = p_stage,
    training_stage_override_at = case when p_stage is null then null else now() end,
    training_stage_override_by = case when p_stage is null then null else v_actor_agent_id end,
    onboarding_stage = case p_stage
      when 'test' then 'onboarding'::public.onboarding_stage
      when 'classroom' then 'training_online'::public.onboarding_stage
      when 'field' then 'in_field_training'::public.onboarding_stage
      when 'active' then 'live'::public.onboarding_stage
      else onboarding_stage
    end,
    onboarding_completed_at = case
      when p_stage in ('classroom', 'field', 'active') then coalesce(onboarding_completed_at, now())
      else onboarding_completed_at
    end,
    field_training_started_at = case
      when p_stage in ('field', 'active') then coalesce(field_training_started_at, now())
      else field_training_started_at
    end,
    updated_at = now()
  where id = p_agent_id;

  if not found then
    raise exception 'Agent not found' using errcode = 'P0002';
  end if;

  select s.stage into v_effective
  from public.v_agent_training_stage s
  where s.agent_id = p_agent_id;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'stage', v_effective);
end;
$$;

comment on function public.set_agent_training_stage(uuid, public.agent_training_stage) is
  'Moves an agent through Onboarding, Training Complete, Field, and Active while keeping the operational onboarding fields synchronized.';

revoke all on function public.set_agent_training_stage(uuid, public.agent_training_stage) from public, anon;
grant execute on function public.set_agent_training_stage(uuid, public.agent_training_stage) to authenticated;

commit;
