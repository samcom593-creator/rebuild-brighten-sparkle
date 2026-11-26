-- Personal tasks follow the caller's verified canonical family without changing
-- current_agent_id(), historical task owners, or any existing task RLS policy.
-- The family links and eligibility fields must not be writable by that caller.
begin;

create or replace function public.fn_guard_agent_task_identity_inputs()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
begin
  -- Validated provisioning/merge functions execute as their trusted owner.
  if current_user in ('postgres', 'service_role', 'supabase_admin')
     or coalesce(public.has_role(v_user, 'admin'::app_role), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Preserve an existing same-identity upsert; callers cannot attach a login
    -- or a canonical family when creating a new row.
    if (new.user_id is not null or new.canonical_agent_id is not null)
       and not exists (
         select 1 from public.agents a where a.id = new.id
           and a.user_id is not distinct from new.user_id
           and a.canonical_agent_id is not distinct from new.canonical_agent_id
       ) then
      raise exception 'Agent identity links require an authorized administrator.' using errcode = '42501';
    end if;
    return new;
  end if;

  if row(new.id, new.user_id, new.canonical_agent_id)
     is distinct from row(old.id, old.user_id, old.canonical_agent_id) then
    raise exception 'Agent identity links require an authorized administrator.' using errcode = '42501';
  end if;

  if row(new.status, new.is_inactive, new.is_deactivated)
     is distinct from row(old.status, old.is_inactive, old.is_deactivated) then
    -- Keep the established direct-team manager path, excluding the manager's
    -- own person even when the row uses another login or is a historical alias.
    if coalesce(public.has_role(v_user, 'manager'::app_role), false)
       and old.user_id is distinct from v_user
       and old.invited_by_manager_id = public.current_agent_id()
       and not exists (
         select 1 from public.agents a where a.user_id = v_user
           and coalesce(nullif(a.canonical_agent_id, a.id), a.id)
               = coalesce(nullif(old.canonical_agent_id, old.id), old.id)
       ) then
      return new;
    end if;
    raise exception 'Agent activation changes require authorized team management.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_guard_agent_task_identity_inputs() from public, anon, authenticated;
drop trigger if exists a_guard_agent_task_identity_inputs on public.agents;
create trigger a_guard_agent_task_identity_inputs
before insert or update of id, user_id, canonical_agent_id, status, is_inactive, is_deactivated
on public.agents for each row execute function public.fn_guard_agent_task_identity_inputs();

-- This legacy SECURITY DEFINER writer otherwise bypasses the trigger as its
-- owner. Preserve its signature and ACL, and bound managers to the same direct
-- team as the established table policy. Reject the whole mixed batch before
-- changing any row. Admin behavior and the existing null/empty behavior remain.
create or replace function public.set_agent_active(p_agent_ids uuid[], p_active boolean)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_admin boolean := coalesce(public.has_role(v_user, 'admin'::app_role), false);
  v_manager uuid;
  v_roots uuid[];
  v_n int;
begin
  if not (v_admin or coalesce(public.has_role(v_user, 'manager'::app_role), false)) then
    raise exception 'Admins and managers only' using errcode = '42501';
  end if;

  perform 1 from public.agents a where a.id = any(p_agent_ids) order by a.id for update;
  if not found then return 0; end if;
  if not v_admin then
    select array_agg(distinct coalesce(nullif(a.canonical_agent_id, a.id), a.id))
      into v_roots from public.agents a where a.user_id = v_user;
    v_manager := public.current_agent_id();
    if coalesce(cardinality(v_roots), 0) <> 1 or v_manager is null then
      raise exception 'An unambiguous manager account is required.' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.agents a where a.id = any(p_agent_ids)
        and (coalesce(nullif(a.canonical_agent_id, a.id), a.id) = v_roots[1]
          or a.invited_by_manager_id is distinct from v_manager)
    ) then
      raise exception 'Agent activation changes require authorized team management.' using errcode = '42501';
    end if;
  end if;

  update public.agents a
     set status = case when p_active then 'active'::agent_status else 'inactive'::agent_status end,
         is_inactive = not p_active,
         is_deactivated = not p_active,
         updated_at = now()
   where a.id = any(p_agent_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

create or replace function public.personal_task_identity()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_roots uuid[];
  v_root public.agents%rowtype;
  v_family uuid[];
begin
  if v_user is null or not exists (select 1 from auth.users u where u.id = v_user)
     or public.fn_user_login_blocked(v_user) or public.fn_user_is_suspended(v_user) then
    raise exception 'An active agent account is required to use My Tasks.' using errcode = '42501';
  end if;

  select array_agg(distinct coalesce(nullif(a.canonical_agent_id, a.id), a.id))
    into v_roots from public.agents a where a.user_id = v_user;
  if coalesce(cardinality(v_roots), 0) <> 1 then
    raise exception 'An unambiguous agent account is required to use My Tasks.' using errcode = '42501';
  end if;

  select a.* into v_root from public.agents a where a.id = v_roots[1];
  if not found
     or (v_root.canonical_agent_id is not null and v_root.canonical_agent_id <> v_root.id)
     or coalesce(v_root.status::text, '') not in ('active', 'pending')
     or coalesce(v_root.is_inactive, false) or coalesce(v_root.is_deactivated, false)
     or public.fn_agent_is_suspended(v_root.id) then
    raise exception 'An active agent account is required to use My Tasks.' using errcode = '42501';
  end if;

  select array_agg(a.id order by a.id) into v_family from public.agents a
   where coalesce(nullif(a.canonical_agent_id, a.id), a.id) = v_root.id;
  if coalesce(cardinality(v_family), 0) not between 1 and 200
     or not (v_root.id = any(v_family)) then
    raise exception 'Your task account could not be verified.' using errcode = '42501';
  end if;
  return jsonb_build_object('user_id', v_user, 'agent_id', v_root.id, 'agent_ids', to_jsonb(v_family));
end;
$function$;

create or replace function public.personal_task_list(p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_identity jsonb := public.personal_task_identity();
  v_family uuid[];
  v_tasks jsonb;
begin
  if p_agent_id is distinct from (v_identity->>'agent_id')::uuid then
    raise exception 'Your task account changed. Refresh the list.' using errcode = '42501';
  end if;
  select array_agg(value::uuid) into v_family from jsonb_array_elements_text(v_identity->'agent_ids');
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb)
    into v_tasks from (
      select id, agent_id, title, description, due_date, priority, status, completed_at, created_at, task_type
        from public.agent_tasks where agent_id = any(v_family)
        order by created_at desc, id desc limit 200
    ) t;
  return v_identity || jsonb_build_object('tasks', v_tasks);
end;
$function$;

create or replace function public.personal_task_set_completed(p_agent_id uuid, p_task_id uuid, p_completed boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_identity jsonb := public.personal_task_identity();
  v_family uuid[];
  v_task jsonb;
begin
  if p_agent_id is distinct from (v_identity->>'agent_id')::uuid then
    raise exception 'Your task account changed. Refresh the list.' using errcode = '42501';
  end if;
  if p_task_id is null or p_completed is null then
    raise exception 'A task and completion state are required.' using errcode = '22023';
  end if;
  select array_agg(value::uuid) into v_family from jsonb_array_elements_text(v_identity->'agent_ids');
  update public.agent_tasks t
     set status = case when p_completed then 'completed' else 'pending' end,
         completed_at = case when p_completed then now() else null end
   where t.id = p_task_id and t.agent_id = any(v_family)
   returning jsonb_build_object('id', t.id, 'agent_id', t.agent_id, 'status', t.status) into v_task;
  if not found then
    raise exception 'Task could not be updated.' using errcode = '42501';
  end if;
  return v_identity || jsonb_build_object('task', v_task);
end;
$function$;

create or replace function public.personal_task_create(
  p_agent_id uuid, p_title text, p_description text, p_due_date date, p_priority text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_identity jsonb := public.personal_task_identity();
  v_title text := btrim(p_title, E' \t\n\r\f' || chr(11));
  v_description text := nullif(btrim(p_description, E' \t\n\r\f' || chr(11)), '');
  v_task jsonb;
begin
  if p_agent_id is distinct from (v_identity->>'agent_id')::uuid then
    raise exception 'Your task account changed. Refresh the list.' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) not between 1 and 200
     or char_length(v_description) > 2000
     or p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent')
     or (p_due_date is not null and (not isfinite(p_due_date)
       or p_due_date < date '0001-01-01' or p_due_date > date '9999-12-31')) then
    raise exception 'Enter a valid task title, notes, priority, and due date.' using errcode = '22023';
  end if;

  insert into public.agent_tasks(agent_id, assigned_by, title, description, due_date, priority, task_type, status)
    values (p_agent_id, auth.uid(), v_title, v_description, p_due_date, p_priority, 'general', 'pending')
    returning jsonb_build_object(
      'id', id, 'agent_id', agent_id, 'title', title, 'description', description,
      'due_date', due_date, 'priority', priority, 'status', status,
      'completed_at', completed_at, 'created_at', created_at, 'task_type', task_type
    ) into v_task;
  return v_task;
end;
$function$;

revoke all on function public.personal_task_identity() from public, anon, authenticated;
revoke all on function public.personal_task_list(uuid) from public, anon, authenticated;
revoke all on function public.personal_task_set_completed(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.personal_task_create(uuid, text, text, date, text) from public, anon, authenticated;
grant execute on function public.personal_task_identity() to authenticated;
grant execute on function public.personal_task_list(uuid) to authenticated;
grant execute on function public.personal_task_set_completed(uuid, uuid, boolean) to authenticated;
grant execute on function public.personal_task_create(uuid, text, text, date, text) to authenticated;
notify pgrst, 'reload schema';
commit;
