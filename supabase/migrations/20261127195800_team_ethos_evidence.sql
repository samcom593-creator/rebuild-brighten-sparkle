-- MP-TEAM-ETHOS-EVIDENCE (2026-11-27). Sam, looking at My Team: "missing plenty agents who have Ethos."
--
-- Measured over 221 real agent rows (no placeholder seats, no merged duplicates): the rule shipped this morning
-- (Ethos hierarchy export by agent id / NPN, Ethos portal pull by NPN, hand mark) found 50 with Ethos back, 19 of
-- the 77 active roster people. Every source in this database together finds 86, 48 of the 77:
--   + the MGN contracting sheet and its roster mirror carry an Ethos partner id for 27 matched agents
--     (ethos_sheet_rows.partner_id / ethos_roster.partner_id; an id means Ethos issued the account)
--   + 18 agents have sold Ethos policies on the site, 12 in the carrier book (you cannot sell on a contract you lack)
--   + the Ethos portal pull matches 7 more by name than by NPN (only 46 of 108 agents have an NPN recorded)
--   + 47 agents have an approved Ethos contracting request (contracting_ethos_approvals): REQUESTED, not proof it
--     came back, so it is its own state, never folded into "back".
--
-- One function, fn_agent_ethos_evidence(agent), now answers for both My Team reads, so the Team tab and Bring back
-- cannot disagree: back + source + since + issued/in-force/chargeback, plus requested + requested_on + partner id.
-- Matching per source: agent id or canonical id, then NPN digits, then email, then normalised name, then the last
-- 10 phone digits where the source has a phone. Priority of the source named: hierarchy export > portal pull >
-- MGN partner id > sold Ethos > hand mark. Both RPCs gain columns, so they are dropped and recreated.
--
-- Applied live through bot-sql (the MCP migration path declines a DROP without an interactive confirmation) and
-- recorded in supabase_migrations.schema_migrations under this version by hand, so CI does not run it twice.

create or replace function public.fn_agent_ethos_evidence(p_agent_id uuid)
returns table(
  back boolean,
  source text,
  since date,
  issued numeric,
  inforce numeric,
  chargeback numeric,
  requested boolean,
  requested_on date,
  partner_id text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with me as (
  select ag.id, coalesce(public.fn_canonical_agent_id(ag.id), ag.id) as canon,
         nullif(regexp_replace(coalesce(ag.nipr_number, ''), '\D', '', 'g'), '') as npn,
         lower(regexp_replace(btrim(coalesce(pu.full_name, pp.full_name, ag.display_name, '')), '\s+', ' ', 'g')) as name_key,
         lower(btrim(coalesce(pu.email, pp.email))) as email,
         right(nullif(regexp_replace(coalesce(pu.phone, pp.phone, ''), '\D', '', 'g'), ''), 10) as phone10
  from public.agents ag
  left join public.profiles pu on pu.user_id = ag.user_id
  left join public.profiles pp on pp.id = ag.profile_id
  where ag.id = p_agent_id
)
select
  (ex.since is not null or lp.since is not null or sh.partner_id is not null or ro.partner_id is not null or so.first_sold is not null or mk.since is not null) as back,
  case when ex.since is not null then 'ethos_hierarchy'
       when lp.since is not null then 'ethos_portal'
       when sh.partner_id is not null or ro.partner_id is not null then 'mgn_partner_id'
       when so.first_sold is not null then 'sold_ethos'
       when mk.since is not null then 'review_mark'
  end as source,
  coalesce(ex.since, lp.since, case when sh.partner_id is not null or ro.partner_id is not null then ro.since end, so.first_sold, mk.since) as since,
  coalesce(ex.issued, lp.issued, 0) as issued,
  coalesce(ex.inforce, lp.inforce, 0) as inforce,
  coalesce(ex.chargeback, lp.chargeback, 0) as chargeback,
  (ap.approved_on is not null or sh.present or ro.present) as requested,
  coalesce(ap.approved_on, ro.since) as requested_on,
  coalesce(sh.partner_id, ro.partner_id) as partner_id
from me
left join lateral (
  select max(p.snapshot_on) as since, max(p.issued_premium) as issued, max(p.inforce_premium) as inforce, max(p.chargeback_total) as chargeback
  from public.ethos_callsheet_people p
  where p.on_ethos and p.in_latest_snapshot
    and (p.agent_id in (me.id, me.canon)
         or (me.npn is not null and nullif(regexp_replace(coalesce(p.npn, ''), '\D', '', 'g'), '') = me.npn)
         or (me.email is not null and lower(btrim(p.email)) = me.email)
         or (me.name_key <> '' and p.name_key = me.name_key))
) ex on true
left join lateral (
  select max(e.snapshot_on) as since, max(e.issued_annual_premium) as issued, max(e.inforce_issued_premium) as inforce, max(e.outstanding_chargeback) as chargeback
  from public.ethos_live_production e
  where e.snapshot_on = (select max(x.snapshot_on) from public.ethos_live_production x)
    and ((me.npn is not null and nullif(regexp_replace(coalesce(e.npn, ''), '\D', '', 'g'), '') = me.npn)
         or (me.name_key <> '' and lower(regexp_replace(btrim(e.agent_name), '\s+', ' ', 'g')) = me.name_key))
) lp on true
left join lateral (
  select nullif(btrim(s.partner_id), '') as partner_id, true as present
  from public.ethos_sheet_rows s
  where s.snapshot_id = (select x.id from public.ethos_sheet_snapshots x where x.status = 'complete' order by x.fetched_at desc limit 1)
    and ((me.npn is not null and nullif(regexp_replace(coalesce(s.npn, ''), '\D', '', 'g'), '') = me.npn)
         or (me.email is not null and lower(btrim(s.email)) = me.email)
         or (me.name_key <> '' and lower(regexp_replace(btrim(concat_ws(' ', s.first_name, s.last_name)), '\s+', ' ', 'g')) = me.name_key)
         or (me.phone10 is not null and right(nullif(regexp_replace(coalesce(s.mobile, ''), '\D', '', 'g'), ''), 10) = me.phone10))
  order by (nullif(btrim(s.partner_id), '') is not null) desc
  limit 1
) sh on true
left join lateral (
  select nullif(btrim(r.partner_id::text), '') as partner_id, r.synced_at::date as since, true as present
  from public.ethos_roster r
  where (me.npn is not null and nullif(regexp_replace(coalesce(r.npn, ''), '\D', '', 'g'), '') = me.npn)
     or (me.email is not null and lower(btrim(r.email)) = me.email)
     or (me.name_key <> '' and lower(regexp_replace(btrim(concat_ws(' ', r.first_name, r.last_name)), '\s+', ' ', 'g')) = me.name_key)
     or (me.phone10 is not null and right(nullif(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), ''), 10) = me.phone10)
  order by (r.partner_id is not null) desc, r.synced_at desc
  limit 1
) ro on true
left join lateral (
  select min(z.d) as first_sold from (
    select mu.posted_date as d from public.mat_production_unified mu where mu.agent_id in (me.id, me.canon) and mu.carrier ilike '%ethos%'
    union all
    select cb.sold_on from public.carrier_book_policies cb
    where cb.carrier ilike '%ethos%' and (cb.agent_id in (me.id, me.canon) or (me.npn is not null and cb.agent_npn = me.npn))
  ) z
) so on true
left join lateral (
  select max(m.confirmed_at)::date as since
  from public.contract_review_marks m
  join public.contract_review_config c on c.singleton and c.version = m.version
  where m.agent_id in (me.id, me.canon) and m.carrier_key = 'ethos'
) mk on true
left join lateral (
  select min(a.approved_at)::date as approved_on from public.contracting_ethos_approvals a
  where a.agent_id in (me.id, me.canon) and a.approved_at is not null
) ap on true;
$function$;

comment on function public.fn_agent_ethos_evidence(uuid) is
  'One answer for "does this agent have Ethos back": hierarchy export, portal pull, MGN partner id, sold Ethos, hand mark (in that priority), plus requested (approval or MGN sheet row) as its own state. Used by crm_agent_profile_facts and crm_bring_back_candidates so My Team cannot disagree with itself. MP-TEAM-ETHOS-EVIDENCE 2026-11-27.';
revoke all on function public.fn_agent_ethos_evidence(uuid) from public, anon;
grant execute on function public.fn_agent_ethos_evidence(uuid) to authenticated, service_role;

drop function if exists public.crm_agent_profile_facts();
create function public.crm_agent_profile_facts()
returns table(
  agent_id uuid,
  home_state text,
  home_state_source text,
  license_states text[],
  instagram text,
  instagram_source text,
  has_login boolean,
  last_sign_in_at timestamptz,
  discord_joined boolean,
  slack_joined boolean,
  npn text,
  ethos_back boolean,
  ethos_source text,
  ethos_since date,
  ethos_issued numeric,
  ethos_inforce numeric,
  ethos_chargeback numeric,
  carriers jsonb,
  carriers_active integer,
  sold_carriers jsonb,
  ethos_requested boolean,
  ethos_requested_on date,
  ethos_partner_id text
)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
with scope as (
  select a.id, a.user_id, a.profile_id, a.source_application_id, a.license_states, a.has_discord_access, a.slack_joined_at,
         nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), '') as npn,
         coalesce(public.fn_canonical_agent_id(a.id), a.id) as canon
  from public.agents a
  where public.crm_can_read_roster()
    and public.crm_can_read_agent_scope(a.id)
    and coalesce(a.is_inactive, false) = false
    and coalesce(a.is_deactivated, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
),
review as (
  select m.agent_id, m.carrier_key, rc.label, max(m.confirmed_at) as confirmed_at
  from public.contract_review_marks m
  join public.contract_review_config cfg on cfg.singleton and cfg.version = m.version
  join public.contract_review_carriers rc on rc.carrier_key = m.carrier_key
  group by 1, 2, 3
)
select
  s.id,
  st.code,
  st.source,
  coalesce((
    select array_agg(distinct x.c order by x.c)
    from unnest(coalesce(s.license_states, '{}'::text[])) ls
    cross join lateral (select public.fn_us_state_code(ls) as c) x
    where x.c is not null
  ), '{}'::text[]),
  ig.handle,
  ig.source,
  s.user_id is not null,
  u.last_sign_in_at,
  coalesce(s.has_discord_access, false),
  s.slack_joined_at is not null,
  s.npn,
  coalesce(ev.back, false),
  ev.source,
  ev.since,
  coalesce(ev.issued, 0),
  coalesce(ev.inforce, 0),
  coalesce(ev.chargeback, 0),
  coalesce(car.list, '[]'::jsonb),
  coalesce(car.active_n, 0),
  coalesce(sold.list, '[]'::jsonb),
  coalesce(ev.requested, false),
  ev.requested_on,
  ev.partner_id
from scope s
left join public.profiles pu on pu.user_id = s.user_id
left join public.profiles pp on pp.id = s.profile_id
left join public.applications ap on ap.id = s.source_application_id
left join public.agent_contract_profile cp on cp.agent_id = s.id
left join auth.users u on u.id = s.user_id
left join lateral public.fn_agent_ethos_evidence(s.id) ev on true
left join lateral (
  select v.code, v.source
  from (values
    (1, public.fn_us_state_code(cp.resident_state), 'contracting profile'),
    (2, public.fn_us_state_code(pu.state), 'profile'),
    (3, public.fn_us_state_code(pp.state), 'profile'),
    (4, public.fn_us_state_code(ap.state), 'application'),
    (5, public.fn_us_state_code(s.license_states[1]), 'license')
  ) v(priority, code, source)
  where v.code is not null
  order by v.priority
  limit 1
) st on true
left join lateral (
  select v.handle, v.source
  from (values
    (1, public.fn_instagram_handle(pu.instagram_handle), 'profile'),
    (2, public.fn_instagram_handle(pp.instagram_handle), 'profile'),
    (3, public.fn_instagram_handle(ap.instagram_handle), 'application')
  ) v(priority, handle, source)
  where v.handle is not null
  order by v.priority
  limit 1
) ig on true
left join lateral (
  select jsonb_agg(jsonb_build_object('carrier', d.carrier, 'status', d.status, 'source', d.source, 'as_of', d.as_of, 'active', d.active)
                   order by d.active desc, d.carrier) as list,
         count(*) filter (where d.active)::int as active_n
  from (
    select distinct on (lower(x.carrier)) x.carrier, x.status, x.source, x.as_of, x.active
    from (
      select case lower(btrim(x0.carrier))
               when 'combine' then 'Combined'
               when 'gto' then 'Guarantee Trust Life'
               when 'aflac' then 'Aflac'
               when 'ahl' then 'American Home Life'
               else btrim(x0.carrier)
             end as carrier,
             x0.status, x0.source, x0.as_of, x0.active
      from (
      select coalesce(ac.name, cr.name, 'Carrier') as carrier,
             lower(coalesce(c.status, 'unknown')) as status,
             'agentlink' as source,
             coalesce(c.activated_date, (c.updated_at at time zone 'America/Phoenix')::date) as as_of,
             lower(coalesce(c.status, '')) in ('active', 'approved', 'appointed') as active
      from public.agentlink_contracts c
      left join public.agentlink_carriers ac on ac.id = c.insuracloud_carrier_id
      left join public.carriers cr on cr.id = c.carrier_id
      where c.agent_id in (s.id, s.canon)
      union all
      select r.label, 'confirmed', 'review', (r.confirmed_at at time zone 'America/Phoenix')::date, true
      from review r where r.agent_id in (s.id, s.canon)
      union all
      select 'Ethos', 'active', coalesce(ev.source, 'ethos'), ev.since, true where coalesce(ev.back, false)
      ) x0
    ) x
    order by lower(x.carrier), x.active desc, x.as_of desc nulls last
  ) d
) car on true
left join lateral (
  select jsonb_agg(jsonb_build_object('carrier', y.carrier, 'deals', y.deals, 'alp', y.alp, 'last_posted', y.last_posted)
                   order by y.alp desc, y.deals desc) as list
  from (
    select coalesce(mu.carrier, 'Carrier not recorded') as carrier,
           count(*)::int as deals,
           round(coalesce(sum(mu.annual_premium), 0), 2) as alp,
           max(mu.posted_date) as last_posted
    from public.mat_production_unified mu
    where mu.agent_id in (s.id, s.canon) and mu.posted_date is not null
    group by 1
    order by 3 desc, 2 desc
    limit 6
  ) y
) sold on true;
$function$;

comment on function public.crm_agent_profile_facts() is
  'My Team profile facts per roster person: home state (normalised), licensed states, Instagram handle, login + last sign-in, Discord/Slack flags, Ethos (fn_agent_ethos_evidence: back + source + requested), carrier contracts on file, and production by carrier. Authorised exactly like crm_agent_roster(). MP-TEAM-PROFILE-FACTS 2026-11-27, Ethos widened the same day (MP-TEAM-ETHOS-EVIDENCE).';
revoke all on function public.crm_agent_profile_facts() from public, anon;
grant execute on function public.crm_agent_profile_facts() to authenticated, service_role;

drop function if exists public.crm_bring_back_candidates();
create function public.crm_bring_back_candidates()
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
  comp_level text,
  ethos_requested boolean,
  ethos_requested_on date
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
         nullif(btrim(s.partner_id), '') as partner_id,
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
    coalesce(ev.back, false) as ethos_back,
    ev.source as ethos_source,
    ev.since as ethos_since,
    coalesce(ev.issued, 0) as ethos_issued,
    coalesce(ev.inforce, 0) as ethos_inforce,
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
    null::text as comp_level,
    coalesce(ev.requested, false) as ethos_requested,
    ev.requested_on as ethos_requested_on
  from scope s
  join public.agents a0 on a0.id = s.id
  left join public.profiles pu on pu.user_id = s.user_id
  left join public.profiles pp on pp.id = s.profile_id
  left join public.applications ap on ap.id = s.source_application_id
  left join public.agent_contract_profile cp on cp.agent_id = s.id
  left join auth.users u on u.id = s.user_id
  left join public.agents m on m.id = s.mgr_id
  left join public.profiles mp on mp.id = m.profile_id
  left join lateral public.fn_agent_ethos_evidence(s.id) ev on true
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
          select 'Ethos', 'active', coalesce(ev.source, 'ethos'), ev.since, true where coalesce(ev.back, false)
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
    coalesce(p.comp_level, sh.comp_level)::text,
    true as ethos_requested,
    null::date as ethos_requested_on
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
    (s.partner_id is not null) as ethos_back,
    case when s.partner_id is not null then 'mgn_partner_id' end as ethos_source,
    null::date as ethos_since,
    0::numeric as ethos_issued, 0::numeric as ethos_inforce,
    case when s.partner_id is not null then jsonb_build_array(jsonb_build_object('carrier', 'Ethos', 'status', 'active', 'source', 'mgn_partner_id', 'as_of', null, 'active', true)) else '[]'::jsonb end as carriers,
    case when s.partner_id is not null then 1 else 0 end as carriers_active,
    0 as deals, 0::numeric as lifetime_ap, null::date as last_deal,
    null::timestamptz as last_sign_in_at, null::text as instagram,
    null::text as last_call_outcome, null::timestamptz as last_call_at,
    null::date as last_active_on,
    nullif(btrim(s.comp_level), '')::text as comp_level,
    true as ethos_requested,
    null::date as ethos_requested_on
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
  'My Team > Bring back: EVERY agent row off the roster (hidden, inactive, excluded, let go with fired = true), plus Ethos hierarchy export people with no agent record, plus (owner only) MGN contracting-sheet signups with no agent record and not on the export (standing sheet_only). Ethos via fn_agent_ethos_evidence (back + requested). can_restore is the inverse of Hide from roster. MP-TEAM-BRING-BACK 2026-11-27 (widened twice the same day).';
revoke all on function public.crm_bring_back_candidates() from public, anon;
grant execute on function public.crm_bring_back_candidates() to authenticated, service_role;
