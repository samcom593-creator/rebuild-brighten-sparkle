-- MP-TEAM-BRING-BACK (2) 2026-11-27. Sam, after the first cut: "missing agents."
--
-- Measured against the live tab: 25 agent rows were on NO screen. 10 are unlicensed people hidden with Hide from
-- roster (created March/April 2026, no contract, no sale, so the first cut's "worth a call" filter dropped them)
-- and 15 are people let go with nothing on file. Beyond public.agents, the MGN contracting sheet mirror
-- (ethos_sheet_rows, latest complete snapshot 2026-10-08, 172 rows) holds 60 life-licensed people with a phone and
-- NO agent record here; 48 of them are on the Ethos hierarchy export (already listed as "no account"), 12 are on
-- the sheet only and were nowhere.
--
-- Changes: (1) every off-roster agent row is returned, whatever they hold; the page still keeps fired people
-- behind the toggle. (2) sheet-only people are a new standing 'sheet_only' (owner only: the sheet is agency-wide
-- and has no per-manager scope), keyed by snapshot + row so a re-mirror keeps the key stable within a snapshot.
-- (3) Ethos-export people with no account borrow phone, email and comp level from the sheet when the export has
-- none. Matching across sources is by NPN digits, then email, then normalised name, then the last 10 phone
-- digits; a person matched to ANY agent row (even a hidden one) is never duplicated as a sheet or export row.
--
-- Applied live via MCP apply_migration (this version number is the one the platform recorded); this file is the
-- repo's record. Proven as Sam right after: 173 rows = hidden 16, inactive 10, let_go 96, no_account 39,
-- sheet_only 12; every non-placeholder, non-duplicate agent row is now either on the roster or in this list.

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
agent_keys as (
  select ag.id,
         lower(regexp_replace(btrim(coalesce(pu.full_name, pp.full_name, ag.display_name, '')), '\s+', ' ', 'g')) as name_key,
         nullif(regexp_replace(coalesce(ag.nipr_number, ''), '\D', '', 'g'), '') as npn,
         lower(btrim(coalesce(pu.email, pp.email))) as email,
         right(nullif(regexp_replace(coalesce(pu.phone, pp.phone, ''), '\D', '', 'g'), ''), 10) as phone10
  from public.agents ag
  left join public.profiles pu on pu.user_id = ag.user_id
  left join public.profiles pp on pp.id = ag.profile_id
),
sheet as (
  select s.snapshot_id, s.row_number, s.first_name, s.last_name, s.mobile, s.email, s.comp_level, s.sub_agency, s.sub_agent_head, s.life_licensed, s.portal_created, s.npn,
         nullif(regexp_replace(coalesce(s.npn, ''), '\D', '', 'g'), '') as npn_d,
         lower(regexp_replace(btrim(concat_ws(' ', s.first_name, s.last_name)), '\s+', ' ', 'g')) as name_key,
         lower(btrim(s.email)) as email_l,
         right(nullif(regexp_replace(coalesce(s.mobile, ''), '\D', '', 'g'), ''), 10) as phone10
  from public.ethos_sheet_rows s
  where s.snapshot_id = (select x.id from public.ethos_sheet_snapshots x where x.status = 'complete' order by x.fetched_at desc limit 1)
    and nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') is not null
),
export_keys as (
  select p.id, nullif(regexp_replace(coalesce(p.npn, ''), '\D', '', 'g'), '') as npn, lower(btrim(p.email)) as email, p.name_key
  from public.ethos_callsheet_people p
  where p.on_ethos and p.in_latest_snapshot
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
    coalesce(nullif(btrim(p.phone), ''), nullif(btrim(sh.mobile), '')), coalesce(nullif(btrim(p.email), ''), nullif(btrim(sh.email), '')),
    null::text as home_state,
    p.license::text,
    'no_account'::text as standing,
    false as fired,
    null::text as let_go_reason,
    false as can_restore,
    coalesce(nullif(p.sub_agency, 'Apex Financial Empire'), nullif(sa.display_name, ''), sap.full_name, nullif(sh.sub_agency, 'Apex Financial Empire')) as manager_name,
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
    coalesce(p.comp_level, sh.comp_level)::text
  from public.ethos_callsheet_people p
  join public.ethos_callsheet_visible_ids() v on v.person_id = p.id
  left join public.agents sa on sa.id = p.sub_agency_agent_id
  left join public.profiles sap on sap.id = sa.profile_id
  left join lateral (
    select c.outcome, c.created_at from public.ethos_callsheet_calls c where c.person_id = p.id order by c.created_at desc limit 1
  ) lc on true
  left join lateral (
    select s2.mobile, s2.email, s2.comp_level, s2.sub_agency from sheet s2
    where (p.npn is not null and s2.npn_d = nullif(regexp_replace(p.npn, '\D', '', 'g'), ''))
       or (p.email is not null and s2.email_l = lower(btrim(p.email)))
       or s2.name_key = p.name_key
    limit 1
  ) sh on true
  where p.on_ethos and p.in_latest_snapshot and p.agent_id is null
),
sheet_only as (
  select
    ('sheet:' || s.snapshot_id::text || ':' || s.row_number::text) as person_key,
    'mgn_sheet'::text as source,
    null::uuid as agent_id,
    nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') as full_name,
    nullif(btrim(s.mobile), '') as phone,
    nullif(btrim(s.email), '') as email,
    null::text as home_state,
    case when upper(coalesce(s.life_licensed, '')) in ('TRUE', 'YES', 'Y', '1') then 'licensed' else 'unlicensed' end as license,
    'sheet_only'::text as standing,
    false as fired,
    null::text as let_go_reason,
    false as can_restore,
    coalesce(nullif(s.sub_agency, 'Apex Financial Empire'), nullif(btrim(s.sub_agent_head), '')) as manager_name,
    false as ethos_back,
    null::text as ethos_source,
    null::date as ethos_since,
    0::numeric as ethos_issued, 0::numeric as ethos_inforce,
    '[]'::jsonb as carriers, 0 as carriers_active,
    0 as deals, 0::numeric as lifetime_ap, null::date as last_deal,
    null::timestamptz as last_sign_in_at, null::text as instagram,
    null::text as last_call_outcome, null::timestamptz as last_call_at,
    null::date as last_active_on,
    nullif(btrim(s.comp_level), '')::text as comp_level
  from sheet s
  where public.apex_is_admin()
    and not exists (
      select 1 from agent_keys k
      where (s.npn_d is not null and k.npn = s.npn_d)
         or (s.email_l is not null and k.email = s.email_l)
         or (s.name_key <> '' and k.name_key = s.name_key)
         or (s.phone10 is not null and k.phone10 = s.phone10)
    )
    and not exists (
      select 1 from export_keys e
      where (s.npn_d is not null and e.npn = s.npn_d)
         or (s.email_l is not null and e.email = s.email_l)
         or (s.name_key <> '' and e.name_key = s.name_key)
    )
)
select * from agent_rows
union all
select * from ethos_only
union all
select * from sheet_only;
$function$;

comment on function public.crm_bring_back_candidates() is
  'My Team > Bring back: EVERY agent row off the roster (hidden, inactive, excluded, let go with fired = true so the page keeps them behind a toggle), plus Ethos hierarchy export people with no agent record, plus (owner only) MGN contracting-sheet signups with no agent record and not on the export (standing sheet_only). can_restore is the inverse of Hide from roster (agents.is_inactive). MP-TEAM-BRING-BACK 2026-11-27, widened the same day after 25 agent rows and 12 sheet signups were on no screen.';

revoke all on function public.crm_bring_back_candidates() from public, anon;
grant execute on function public.crm_bring_back_candidates() to authenticated, service_role;
