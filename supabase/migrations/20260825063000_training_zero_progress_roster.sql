-- Training reporting starts from the scoped live roster, so agents with no
-- progress are visible as not-started instead of disappearing.
create or replace function public.apex_training_rollup()
returns table (active_modules integer, enrolled integer, complete integer, in_progress integer, not_started integer, scope text)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_is_admin boolean; v_is_manager boolean;
  v_mgr uuid; v_active integer;
begin
  if v_uid is null then return; end if;
  v_is_admin := has_role(v_uid, 'admin'::app_role) or has_role(v_uid, 'va_manager'::app_role);
  v_is_manager := has_role(v_uid, 'manager'::app_role);
  if not (v_is_admin or v_is_manager) then return; end if;
  select count(*) into v_active from onboarding_modules where is_active;
  if v_active = 0 then return; end if;
  v_mgr := current_agent_id();
  return query
  with recursive tree as (
    select a.id from agents a where a.id = v_mgr
    union
    select a.id from agents a join tree t on a.manager_id = t.id or a.invited_by_manager_id = t.id
  ), scoped as (
    select a.id from agents a
    where exists (select 1 from v_apex_roster r where r.id = a.id)
      and (v_is_admin or (v_is_manager and exists (select 1 from tree t where t.id = a.id)))
  ), per as (
    select s.id as agent_id, count(p.module_id) filter (where p.passed)::int as passed
    from scoped s
    left join onboarding_progress p on p.agent_id = s.id
      and exists (select 1 from onboarding_modules m where m.id = p.module_id and m.is_active)
    group by s.id
  )
  select v_active, count(*)::int,
    count(*) filter (where per.passed >= v_active)::int,
    count(*) filter (where per.passed > 0 and per.passed < v_active)::int,
    count(*) filter (where per.passed = 0)::int,
    case when v_is_admin then 'agency' else 'team' end
  from per;
end; $$;

create or replace function public.apex_training_needs_nudge(_limit integer default 5)
returns table (agent_id uuid, display_name text, modules_passed integer, active_modules integer, last_activity timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_is_admin boolean; v_is_manager boolean;
  v_mgr uuid; v_active integer;
begin
  if v_uid is null then return; end if;
  v_is_admin := has_role(v_uid, 'admin'::app_role) or has_role(v_uid, 'va_manager'::app_role);
  v_is_manager := has_role(v_uid, 'manager'::app_role);
  if not (v_is_admin or v_is_manager) then return; end if;
  select count(*) into v_active from onboarding_modules where is_active;
  if v_active = 0 then return; end if;
  v_mgr := current_agent_id();
  return query
  with recursive tree as (
    select a.id from agents a where a.id = v_mgr
    union
    select a.id from agents a join tree t on a.manager_id = t.id or a.invited_by_manager_id = t.id
  ), scoped as (
    select a.id, a.display_name from agents a
    where exists (select 1 from v_apex_roster r where r.id = a.id)
      and (v_is_admin or (v_is_manager and exists (select 1 from tree t where t.id = a.id)))
  ), per as (
    select s.id as agent_id, s.display_name,
      count(p.module_id) filter (where p.passed)::int as passed,
      max(coalesce(p.completed_at, p.started_at)) as last_at
    from scoped s
    left join onboarding_progress p on p.agent_id = s.id
      and exists (select 1 from onboarding_modules m where m.id = p.module_id and m.is_active)
    group by s.id, s.display_name
  )
  select per.agent_id, per.display_name, per.passed, v_active, per.last_at
  from per where per.passed < v_active
  order by per.last_at asc nulls first, per.passed asc, per.display_name asc
  limit greatest(1, least(coalesce(_limit, 5), 25));
end; $$;

revoke all on function public.apex_training_rollup() from public, anon;
revoke all on function public.apex_training_needs_nudge(integer) from public, anon;
grant execute on function public.apex_training_rollup() to authenticated;
grant execute on function public.apex_training_needs_nudge(integer) to authenticated;
