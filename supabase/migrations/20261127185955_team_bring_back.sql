-- MP-TEAM-BRING-BACK (2026-11-27). Sam: "make sure all the agents are there and the ones that I can bring back
-- with contracts and all."
--
-- My Team lists the roster: crm_agent_roster() drops anyone flagged is_inactive or is_deactivated, anyone in
-- roster_exclusions, placeholder seats and merged duplicates. Measured 2026-11-27: 253 agent rows, 108 on the
-- roster (81 active, 27 under Not active), 19 merged duplicates, 6 placeholder seats, 96 let go (deactivated,
-- terminated, banned or suspended), 26 hidden or inactive and NOT let go, of whom 12 still hold a contract or
-- wrote business. Separately, 41 people on the latest Ethos hierarchy export hold Sam's Ethos contract and have
-- no agent record here at all (39 with a phone). None of these people can be reached from My Team, and the
-- Ethos call sheet hides 119 of them under its 30-day no-activity rule (Sam, 2026-11-24).
--
-- This read lists everyone OFF the roster who is worth a call: a contract on file (Ethos, AgentLink or the
-- contracting review), posted production, a license, or Sam's Ethos contract with no account. People Sam let go
-- are returned with fired = true so the page can keep them behind a toggle (2026-11-24: "if I fired them,
-- remove them"), never silently mixed in. Authorised like the roster for agent rows (crm_can_read_roster +
-- crm_can_read_agent_scope) and like the call sheet for Ethos-only people (ethos_callsheet_visible_ids).
-- can_restore is the exact inverse of My Team's "Hide from roster" (agents.is_inactive = true): nothing else.

create or replace function public.crm_bring_back_candidates()
returns table(
  person_key text,
  source text,
  agent_id uuid,
  full_name text,
  phone text,
  email text,
  home_state text,
  license text,
  standing text,
  fired boolean,
  let_go_reason text,
  can_restore boolean,
  manager_name text,
  ethos_back boolean,
  ethos_source text,
  ethos_since date,
  ethos_issued numeric,
  ethos_inforce numeric,
  carriers jsonb,
  carriers_active integer,
  deals integer,
  lifetime_ap numeric,
  last_deal date,
  last_sign_in_at timestamptz,
  instagram text,
  last_call_outcome text,
  last_call_at timestamptz,
  last_active_on date,
  comp_level text
)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
with review as (
  select m.agent_id, m.carrier_key, rc.label, max(m.confirmed_at) as confirmed_at
  from public.contract_review_marks m
  join public.contract_review_config cfg on cfg.singleton and cfg.version = m.version
  join public.contract_review_carriers rc on rc.carrier_key = m.carrier_key
  group by 1, 2, 3
),
live_ethos as (
  select nullif(regexp_replace(coalesce(e.npn, ''), '\D', '', 'g'), '') as npn,
         e.snapshot_on, e.issued_annual_premium, e.inforce_issued_premium
  from public.ethos_live_production e
  where e.snapshot_on = (select max(x.snapshot_on) from public.ethos_live_production x)
),
scope as (
  select a.id, a.user_id, a.profile_id, a.source_application_id, a.license_states, a.status::text as status,
         coalesce(a.is_inactive, false) as inact, coalesce(a.is_deactivated, false) as deact,
         a.license_status::text as lic, a.deactivation_reason::text as deactivation_reason,
         nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), '') as npn,
         coalesce(public.fn_canonical_agent_id(a.id), a.id) as canon,
         public.fn_agent_is_roster_excluded(a.id) as excluded,
         coalesce(a.manager_id, a.invited_by_manager_id) as mgr_id
  from public.agents a
  where public.crm_can_read_roster()
    and public.crm_can_read_agent_scope(a.id)
    and (coalesce(a.is_inactive, false) or coalesce(a.is_deactivated, false) or public.fn_agent_is_roster_excluded(a.id))
    and not (a.agent_code like 'GHOST\_%' and a.user_id is null)
    and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
),
agent_rows as (
  select
    s.id::text as person_key,
    'agent'::text as source,
    s.id as agent_id,
    coalesce(nullif(btrim(coalesce(pu.full_name, pp.full_name)), ''), nullif(btrim(a0.display_name), ''), 'Name not on file') as full_name,
    coalesce(nullif(btrim(pu.phone), ''), nullif(btrim(pp.phone), ''), nullif(btrim(ap.phone), '')) as phone,
    coalesce(nullif(btrim(pu.email), ''), nullif(btrim(pp.email), ''), nullif(btrim(u.email::text), ''), nullif(btrim(ap.email), '')) as email,
    st.code as home_state,
    s.lic as license,
    case
      when s.deact or s.status = 'terminated' or coalesce(u.banned_until > now(), false) or sus.suspended then 'let_go'
      when s.inact and s.status = 'inactive' then 'inactive'
      when s.inact then 'hidden'
      when s.excluded then 'excluded'
      else 'inactive'
    end as standing,
    (s.deact or s.status = 'terminated' or coalesce(u.banned_until > now(), false) or sus.suspended) as fired,
    s.deactivation_reason as let_go_reason,
    (s.inact and not s.deact and s.status <> 'terminated' and not s.excluded and not coalesce(u.banned_until > now(), false) and not sus.suspended) as can_restore,
    coalesce(nullif(btrim(mp.full_name), ''), nullif(btrim(m.display_name), '')) as manager_name,
    (eh.snapshot_on is not null or le.npn is not null or rv.confirmed_at is not null) as ethos_back,
    case when eh.snapshot_on is not null then 'ethos_hierarchy' when le.npn is not null then 'ethos_portal' when rv.confirmed_at is not null then 'review_mark' end as ethos_source,
    coalesce(eh.snapshot_on, le.snapshot_on, rv.confirmed_at::date) as ethos_since,
    coalesce(eh.issued, le.issued_annual_premium, 0) as ethos_issued,
    coalesce(eh.inforce, le.inforce_issued_premium, 0) as ethos_inforce,
    coalesce(car.list, '[]'::jsonb) as carriers,
    coalesce(car.active_n, 0) as carriers_active,
    coalesce(prod.deals, 0) as deals,
    coalesce(prod.ap, 0) as lifetime_ap,
    prod.last_deal,
    u.last_sign_in_at,
    ig.handle as instagram,
    lc.outcome::text as last_call_outcome,
    lc.created_at as last_call_at,
    greatest(prod.last_deal, (u.last_sign_in_at at time zone 'America/Phoenix')::date, (lc.created_at at time zone 'America/Phoenix')::date) as last_active_on,
    null::text as comp_level
  from scope s
  join public.agents a0 on a0.id = s.id
  left join public.profiles pu on pu.user_id = s.user_id
  left join public.profiles pp on pp.id = s.profile_id
  left join public.applications ap on ap.id = s.source_application_id
  left join public.agent_contract_profile cp on cp.agent_id = s.id
  left join auth.users u on u.id = s.user_id
  left join public.agents m on m.id = s.mgr_id
  left join public.profiles mp on mp.id = m.profile_id
  left join lateral (
    select exists (select 1 from public.agent_access_suspensions x where x.user_id = s.user_id and x.lifted_at is null) as suspended
  ) sus on true
  left join lateral (
    select v.code from (values
      (1, public.fn_us_state_code(cp.resident_state)), (2, public.fn_us_state_code(pu.state)), (3, public.fn_us_state_code(pp.state)),
      (4, public.fn_us_state_code(ap.state)), (5, public.fn_us_state_code(s.license_states[1]))
    ) v(priority, code) where v.code is not null order by v.priority limit 1
  ) st on true
  left join lateral (
    select v.handle from (values
      (1, public.fn_instagram_handle(pu.instagram_handle)), (2, public.fn_instagram_handle(pp.instagram_handle)), (3, public.fn_instagram_handle(ap.instagram_handle))
    ) v(priority, handle) where v.handle is not null order by v.priority limit 1
  ) ig on true
  left join lateral (
    select max(p.snapshot_on) as snapshot_on, max(p.issued_premium) as issued, max(p.inforce_premium) as inforce
    from public.ethos_callsheet_people p
    where p.on_ethos and p.in_latest_snapshot
      and (p.agent_id in (s.id, s.canon) or (s.npn is not null and nullif(regexp_replace(coalesce(p.npn, ''), '\D', '', 'g'), '') = s.npn))
  ) eh on true
  left join lateral (select le0.* from live_ethos le0 where s.npn is not null and le0.npn = s.npn limit 1) le on true
  left join lateral (
    select r.confirmed_at from review r where r.agent_id in (s.id, s.canon) and r.carrier_key = 'ethos' order by r.confirmed_at desc limit 1
  ) rv on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('carrier', d.carrier, 'status', d.status, 'source', d.source, 'as_of', d.as_of, 'active', d.active)
                     order by d.active desc, d.carrier) as list,
           count(*) filter (where d.active)::int as active_n
    from (
      select distinct on (lower(x.carrier)) x.carrier, x.status, x.source, x.as_of, x.active
      from (
        select case lower(btrim(x0.carrier))
                 when 'combine' then 'Combined' when 'gto' then 'Guarantee Trust Life' when 'aflac' then 'Aflac' when 'ahl' then 'American Home Life'
                 else btrim(x0.carrier) end as carrier,
               x0.status, x0.source, x0.as_of, x0.active
        from (
          select coalesce(ac.name, cr.name, 'Carrier') as carrier, lower(coalesce(c.status, 'unknown')) as status, 'agentlink' as source,
                 coalesce(c.activated_date, (c.updated_at at time zone 'America/Phoenix')::date) as as_of,
                 lower(coalesce(c.status, '')) in ('active', 'approved', 'appointed') as active
          from public.agentlink_contracts c
          left join public.agentlink_carriers ac on ac.id = c.insuracloud_carrier_id
          left join public.carriers cr on cr.id = c.carrier_id
          where c.agent_id in (s.id, s.canon)
          union all
          select r.label, 'confirmed', 'review', (r.confirmed_at at time zone 'America/Phoenix')::date, true from review r where r.agent_id in (s.id, s.canon)
          union all
          select 'Ethos', 'active', 'ethos_hierarchy', eh.snapshot_on, true where eh.snapshot_on is not null
          union all
          select 'Ethos', 'active', 'ethos_portal', le.snapshot_on, true where le.npn is not null
        ) x0
      ) x
      order by lower(x.carrier), x.active desc, x.as_of desc nulls last
    ) d
  ) car on true
  left join lateral (
    select count(*)::int as deals, round(coalesce(sum(mu.annual_premium), 0), 2) as ap, max(mu.posted_date) as last_deal
    from public.mat_production_unified mu where mu.agent_id in (s.id, s.canon) and mu.posted_date is not null
  ) prod on true
  left join lateral (
    select c.outcome, c.created_at
    from public.ethos_callsheet_calls c
    join public.ethos_callsheet_people p on p.id = c.person_id
    where p.agent_id in (s.id, s.canon)
    order by c.created_at desc limit 1
  ) lc on true
),
ethos_only as (
  select
    p.id::text, 'ethos_person'::text, null::uuid,
    coalesce(nullif(btrim(p.full_name), ''), 'Name not on file'),
    nullif(btrim(p.phone), ''), nullif(btrim(p.email), ''),
    null::text as home_state,
    p.license::text,
    'no_account'::text as standing,
    false as fired,
    null::text as let_go_reason,
    false as can_restore,
    coalesce(nullif(p.sub_agency, 'Apex Financial Empire'), nullif(sa.display_name, ''), sap.full_name) as manager_name,
    true as ethos_back,
    'ethos_hierarchy'::text as ethos_source,
    p.snapshot_on as ethos_since,
    coalesce(p.issued_premium, 0), coalesce(p.inforce_premium, 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('carrier', d.carrier, 'status', d.status, 'source', d.source, 'as_of', d.as_of, 'active', d.active) order by d.active desc, d.carrier)
      from (
        select distinct on (lower(x.carrier)) x.carrier, x.status, x.source, x.as_of, x.active from (
          select 'Ethos' as carrier, 'active' as status, 'ethos_hierarchy' as source, p.snapshot_on as as_of, true as active
          union all
          select c->>'name', lower(coalesce(c->>'status', 'unknown')), 'agentlink', p.al_last_active_at::date,
                 (c->>'status' = 'active' or (c->>'active') ~ '^[1-9]')
          from jsonb_array_elements(case when jsonb_typeof(p.carriers) = 'array' then p.carriers else '[]'::jsonb end) c
          where nullif(btrim(c->>'name'), '') is not null
        ) x order by lower(x.carrier), x.active desc
      ) d
    ), '[]'::jsonb) as carriers,
    1 + coalesce(p.contracts_active, 0) as carriers_active,
    0 as deals, 0::numeric as lifetime_ap, null::date as last_deal,
    null::timestamptz as last_sign_in_at, null::text as instagram,
    lc.outcome::text, lc.created_at,
    greatest(p.al_last_active_at::date, (lc.created_at at time zone 'America/Phoenix')::date) as last_active_on,
    p.comp_level::text
  from public.ethos_callsheet_people p
  join public.ethos_callsheet_visible_ids() v on v.person_id = p.id
  left join public.agents sa on sa.id = p.sub_agency_agent_id
  left join public.profiles sap on sap.id = sa.profile_id
  left join lateral (
    select c.outcome, c.created_at from public.ethos_callsheet_calls c where c.person_id = p.id order by c.created_at desc limit 1
  ) lc on true
  where p.on_ethos and p.in_latest_snapshot and p.agent_id is null
)
select * from agent_rows ar
where ar.ethos_back or ar.carriers_active > 0 or ar.deals > 0 or ar.license = 'licensed'
union all
select * from ethos_only;
$function$;

comment on function public.crm_bring_back_candidates() is
  'My Team > Bring back: everyone OFF the roster worth a call (contract on file, production, a license, or Sam''s Ethos contract with no account), with fired = true for people Sam let go so the page keeps them behind a toggle. can_restore is the inverse of Hide from roster (agents.is_inactive). MP-TEAM-BRING-BACK 2026-11-27.';

revoke all on function public.crm_bring_back_candidates() from public, anon;
grant execute on function public.crm_bring_back_candidates() to authenticated, service_role;
