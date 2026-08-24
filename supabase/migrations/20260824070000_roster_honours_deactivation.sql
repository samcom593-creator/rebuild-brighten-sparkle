-- v_apex_roster must honour an explicit human deactivation.
--
-- Sam, Monday: "clear house... the agents aren't even active anymore, almost
-- nothing in the view is active."
--
-- THE BUG THAT MADE CLEARING HOUSE IMPOSSIBLE: /dashboard/team's deactivate
-- action writes agents.is_inactive = true, but v_apex_roster's membership rule
-- reads only `status = 'active' OR produced in 120d`. Nothing in the roster ever
-- looked at is_inactive, so Sam could deactivate an agent, watch the write
-- succeed, and see them still sitting in the roster. The control worked; the
-- view ignored it.
--
-- PRECEDENCE, deliberately: an explicit human flag BEATS the production
-- heuristic. The 120d rule exists to rescue producers whose status flag went
-- stale on its own (KJ Vaughn et al) — it must not resurrect someone Sam has
-- just deliberately switched off. Recent production still wins over a merely
-- stale `status`, which is the case that rule was written for.
create or replace view public.v_apex_roster
with (security_invoker = on) as
with produced as (
  select b.agent_id, count(*) as deals_120d, sum(b.annual_premium) as ap_120d, max(b.posted_date) as last_deal
  from public.v_agentlink_book_scoped b
  where b.is_dead is not true and b.agent_id is not null
    and b.posted_date > (now() at time zone 'America/Phoenix')::date - 120
  group by b.agent_id
),
lifetime as (
  select b.agent_id, count(*) as deals_lifetime, sum(b.annual_premium) as ap_lifetime
  from public.v_agentlink_book_scoped b
  where b.is_dead is not true and b.agent_id is not null
  group by b.agent_id
)
select
  a.id, a.agent_code, a.display_name, a.status, a.license_status, a.manager_id,
  a.insuracloud_user_id, a.onboarding_stage, a.created_at, a.user_id,
  coalesce(p.deals_120d, 0)      as deals_120d,
  coalesce(p.ap_120d, 0)         as ap_120d,
  p.last_deal,
  coalesce(l.deals_lifetime, 0)  as deals_lifetime,
  coalesce(l.ap_lifetime, 0)     as ap_lifetime,
  (p.agent_id is not null)       as is_producing,
  case
    when p.agent_id is not null and a.status = 'active' then 'producing'
    when p.agent_id is not null then 'producing_flag_stale'
    when a.status = 'active' then 'active_no_production'
    else a.status::text
  end::text as roster_state
from public.agents a
left join produced p on p.agent_id = a.id
left join lifetime l on l.agent_id = a.id
where
  a.display_name is not null
  and btrim(a.display_name) <> ''
  and coalesce(a.agent_code, '') not like 'GHOST^_%' escape '^'
  and coalesce(a.agent_code, '') not like 'XAGENT%'
  and a.display_name not like 'MP%^_HIRED' escape '^'
  and a.display_name not like 'XAGENT%'
  and not exists (select 1 from public.roster_exclusions x where x.agent_id = a.id)
  -- explicit human deactivation is authoritative and outranks the heuristic
  and coalesce(a.is_inactive, false) = false
  and coalesce(a.is_deactivated, false) = false
  and (a.status = 'active' or p.agent_id is not null);

grant select on public.v_apex_roster to authenticated;

-- One call so a leader can clear house without 40 clicks, and so the two flags
-- that govern visibility can never be set out of step with each other again.
create or replace function public.set_agent_active(p_agent_ids uuid[], p_active boolean)
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n int;
begin
  if not (coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
       or coalesce(public.has_role(auth.uid(), 'manager'::app_role), false)) then
    raise exception 'Admins and managers only';
  end if;

  update public.agents a
     set status         = case when p_active then 'active'::agent_status else 'inactive'::agent_status end,
         is_inactive    = not p_active,
         is_deactivated = not p_active,
         updated_at     = now()
   where a.id = any(p_agent_ids);

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

grant execute on function public.set_agent_active(uuid[], boolean) to authenticated;
