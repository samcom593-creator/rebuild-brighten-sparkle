-- Recruiting + contracting truth (2026-10-07).
--
-- 1) has_agent(applications): PostgREST computed column. "Likely to join" ranked people
--    who had already joined first (Tyler Krejcha, Jaivon Carr, Brittney Stockton have
--    agent rows). An applicant with an agent row (by source_application_id or the same
--    email) is no longer a recruiting lead. SECURITY DEFINER so staff without agents/
--    profiles read access still get the right answer; it returns only a boolean.
create or replace function public.has_agent(app public.applications)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.agents a
      left join public.profiles p on p.id = a.profile_id
     where a.canonical_agent_id is null
       and (a.source_application_id = app.id
            or (nullif(btrim(app.email), '') is not null and lower(p.email) = lower(btrim(app.email))))
  )
$fn$;
comment on function public.has_agent(public.applications) is
  'True when this application already has an agent row (source_application_id or same email). Read as a computed column: applications?select=...,has_agent';
revoke all on function public.has_agent(public.applications) from public, anon;
grant execute on function public.has_agent(public.applications) to authenticated, service_role;

-- 2) contracting_checkin_list(): people Sam locked out (agent_access_suspensions with
--    lifted_at null, e.g. the KJ Vaughn team on 2026-09-07) kept agents.status 'active'
--    on purpose, so the call list still showed all seven as active. They now read
--    'suspended', which the panel treats as gone.
CREATE OR REPLACE FUNCTION public.contracting_checkin_list()
 RETURNS TABLE(checkin_id uuid, agent_id uuid, display_name text, manager_name text, phone text, email text, agent_status text, license_status text, npn text, is_agent boolean, source text, intake_received boolean, deals_30d integer, producing boolean, flagged boolean, contracts_sent_at timestamp with time zone, contracts_confirmed_at timestamp with time zone, training_ready_at timestamp with time zone, last_call_at timestamp with time zone, last_call_outcome text, call_count integer, last_checkin_at timestamp with time zone, note text, stage text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with scope as (select * from public.fn_contracting_checkin_scope()),
  prod as (
    select coalesce(m.canonical_agent_id, p.agent_id) aid, count(*)::int n
    from public.v_production_canonical p
    left join public.v_agent_canonical_map m on m.agent_id = p.agent_id
    where p.posted_date >= (now() at time zone 'America/Phoenix')::date - 30
    group by 1
  ),
  agent_rows as (
    select a.id aid, c.*
    from public.agents a
    join scope s on s.agent_id = a.id
    left join public.contracting_checkins c on c.agent_id = a.id
    where a.canonical_agent_id is null
      and coalesce(a.agent_code,'') not like 'GHOST_%'
      and ( (a.status = 'active' and not coalesce(a.is_deactivated,false) and not coalesce(a.is_inactive,false))
            or coalesce(c.flagged_no_contracts,false) )
  )
  select r.id, a.id, a.display_name, mg.display_name,
         coalesce(nullif(pr.phone,''), nullif(ci.phone_e164,''), nullif(ap.phone,'')),
         coalesce(pr.email, ci.email, ap.email),
         case when exists (select 1 from public.agent_access_suspensions s
                           where s.user_id = a.user_id and s.lifted_at is null) then 'suspended'
              when coalesce(a.is_deactivated,false) or a.status='terminated' then 'terminated'
              when coalesce(a.is_inactive,false) or a.status='inactive' then 'inactive' else 'active' end,
         a.license_status::text, coalesce(nullif(a.nipr_number,''), ci.npn), true, 'agent',
         (ci.id is not null or a.contracted_at is not null),
         coalesce(pd.n,0), coalesce(pd.n,0) > 0, coalesce(r.flagged_no_contracts,false),
         r.contracts_sent_at, r.contracts_confirmed_at, r.training_ready_at,
         r.last_call_at, r.last_call_outcome, coalesce(r.call_count,0), r.last_checkin_at, r.note,
         case
           when r.training_ready_at is not null then 'ready_for_training'
           when r.contracts_confirmed_at is not null then 'contracts_confirmed'
           when r.contracts_sent_at is not null then 'contracts_sent'
           when coalesce(pd.n,0) > 0 and not coalesce(r.flagged_no_contracts,false) then 'producing'
           else 'needs_contracts'
         end
  from agent_rows r
  join public.agents a on a.id = r.aid
  left join public.agents mg on mg.id = a.manager_id
  left join public.profiles pr on pr.id = a.profile_id
  left join public.applications ap on ap.id = a.source_application_id
  left join lateral (select * from public.contracting_intakes x where x.agent_id = a.id
                     order by x.created_at desc limit 1) ci on true
  left join prod pd on pd.aid = a.id
  union all
  -- people on the list who are not agents yet (applicants, portal-only, name-only)
  select c.id, null, c.display_name, null,
         coalesce(nullif(c.phone,''), nullif(ap.phone,''), nullif(pr.phone,'')),
         coalesce(c.email, ap.email, pr.email),
         'not_an_agent', ap.license_status::text, ap.nipr_number, false,
         case when c.application_id is not null then 'applicant'
              when c.profile_id is not null then 'portal account' else 'name only' end,
         false, 0, false, c.flagged_no_contracts,
         c.contracts_sent_at, c.contracts_confirmed_at, c.training_ready_at,
         c.last_call_at, c.last_call_outcome, c.call_count, c.last_checkin_at, c.note,
         case
           when c.training_ready_at is not null then 'ready_for_training'
           when c.contracts_confirmed_at is not null then 'contracts_confirmed'
           when c.contracts_sent_at is not null then 'contracts_sent'
           else 'needs_contracts'
         end
  from public.contracting_checkins c
  left join public.applications ap on ap.id = c.application_id
  left join public.profiles pr on pr.id = c.profile_id
  where c.agent_id is null and c.left_at is null and public.fn_contracting_is_staff();
$function$;
