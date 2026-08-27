-- MP-330 — get_just_hired_30d: the RPC the home JustHiredPanel calls first.
-- It did not exist, so the panel always fell to its two-query fallback. The
-- panel now renders on the admin/manager home so Sam can see recent hires
-- (name + who they route to + when) and follow up directly.
--
-- Independent of AgentLink/InsuraCloud by construction: reads agents + the
-- inviting manager only. Canonical rows only (a merged duplicate twin must not
-- show as a second hire). Staff-gated: a non-staff caller gets zero rows rather
-- than the routing map. SECURITY DEFINER so the staff gate is the boundary, not
-- table RLS.

create or replace function public.get_just_hired_30d()
returns table (
  id uuid,
  display_name text,
  start_date date,
  routed_to text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    a.id,
    a.display_name,
    a.start_date,
    coalesce(mgr.display_name, '(direct to Sam)') as routed_to,
    a.created_at
  from public.agents a
  left join public.agents mgr on mgr.id = a.invited_by_manager_id
  where public.is_agency_staff()
    and a.created_at >= now() - interval '30 days'
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.canonical_agent_id, a.id) = a.id
  order by a.created_at desc
  limit 25;
$$;

revoke all on function public.get_just_hired_30d() from public, anon;
grant execute on function public.get_just_hired_30d() to authenticated, service_role;
