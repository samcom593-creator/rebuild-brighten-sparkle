-- MP-TEAM-RECOVERY (2026-11-27). Sam: "combine team recovery and call sheet ... make it easy to filter
-- states, or agents by states." Both surfaces need a state per person. Measured: ethos_call_sheet() rows
-- carried no state (0 of 22 rows for the owner); agents.license_states is empty for all 39 open recovery
-- cases while fn_agent_lead_states() (strongest record first: agents, contracting intake, application,
-- contract profile, AgentLink, profile) resolves 13 of them.
--
-- 1. ethos_call_sheet(): kept byte-for-byte as ethos_call_sheet_base(); the new ethos_call_sheet() wraps it
--    and adds `states` (text[] or null) per row from fn_agent_lead_states(agent_id). Same grants as before.
-- 2. fn_agent_states_bulk(uuid[]): states for a set of agents, for the recovery queue page; admins and
--    leaders (manager, agency_owner) only, matching the inactive_agent_queue RLS audience.
--
-- Applied live via MCP apply_migration at 2026-11-27 17:35:38Z (this version number is the one the platform
-- recorded); this file is the repo's record.
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'ethos_call_sheet')
     and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'ethos_call_sheet_base') then
    alter function public.ethos_call_sheet() rename to ethos_call_sheet_base;
  end if;
end $$;
revoke all on function public.ethos_call_sheet_base() from public, anon, authenticated;

create or replace function public.ethos_call_sheet()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select public.ethos_call_sheet_base() as j
  ), rows_with_states as (
    select coalesce(jsonb_agg(
             r || jsonb_build_object('states',
               (select to_jsonb(st.states) from public.fn_agent_lead_states(p.agent_id) st))
             order by r->>'full_name'), '[]'::jsonb) as rows
      from base b
      cross join lateral jsonb_array_elements(b.j->'rows') r
      left join public.ethos_callsheet_people p on p.id = (r->>'id')::uuid
  )
  select jsonb_set(b.j, '{rows}', w.rows) from base b, rows_with_states w;
$function$;
revoke all on function public.ethos_call_sheet() from public, anon;
grant execute on function public.ethos_call_sheet() to authenticated;

create or replace function public.fn_agent_states_bulk(p_agent_ids uuid[])
returns table(agent_id uuid, states text[], source text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id, st.states, st.source
    from unnest(coalesce(p_agent_ids, '{}'::uuid[])) ids(id)
    join public.agents a on a.id = ids.id
    cross join lateral public.fn_agent_lead_states(a.id) st
   where auth.uid() is not null
     and (public.apex_is_admin() or public.apex_has_any_role(array['manager', 'agency_owner']))
$function$;
revoke all on function public.fn_agent_states_bulk(uuid[]) from public, anon;
grant execute on function public.fn_agent_states_bulk(uuid[]) to authenticated;
