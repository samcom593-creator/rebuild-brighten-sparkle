-- MP-TEAM-PROFILE-FACTS (2026-11-27). Sam, voice note: My Team "needs to be able to see what contracts they
-- have back ... if they have Ethos back already ... if there's an Instagram account ... any production
-- they've done in the past ... what carriers they have, what they sold, their last sign in, carrier contracts
-- active, a clear phone number ... and a filter to see which one of those guys I can filter by state."
--
-- One read for the whole roster, authorised exactly like crm_agent_roster() (same four predicates), so the
-- people it describes are the people the roster lists. Every fact says where it came from, because no single
-- table holds any of them:
--
--   home_state      agent_contract_profile.resident_state, then profiles.state (by user, then by profile id),
--                   then applications.state, then the first licensed state. Measured 2026-11-27 on the 86
--                   active roster people: 45 have a state somewhere, spelled "Az", "wi", "Texas", "New
--                   Jersey" and so on; fn_us_state_code() turns each into a two-letter code.
--   instagram       profiles.instagram_handle (by user, then profile id), then applications.instagram_handle.
--                   25 of 86 on file; "@handle", "handle" and a pasted instagram.com link all read as one.
--   last_sign_in_at auth.users for the agent's login. Null with has_login = false means no login at all.
--   ethos_back      true when the person is on the latest Ethos hierarchy export (ethos_callsheet_people,
--                   matched by agent record or NPN; 16 of 86 on 2026-11-19), else on the latest Ethos portal
--                   pull by NPN (ethos_live_production; 8 of 86 on 2026-11-23), else marked received by hand
--                   in the contracting review (contract_review_marks 'ethos'; 4 marks). ethos_source names
--                   which, ethos_since the export, pull or mark date. false means NOTHING on file says so.
--   carriers        every carrier contract on file, one row per carrier: AgentLink contracts (the sync has
--                   been retired since 2026-10-17, so as_of is the contract's own date), the contracting
--                   review's hand-confirmed carriers, and Ethos from the two sources above. active is the
--                   AgentLink status in (active, approved, appointed), or any confirmed/Ethos row.
--   sold_carriers   what they have sold by carrier, from mat_production_unified (the same source the roster's
--                   production numbers read), most ALP first, up to six carriers.
--
-- Nothing here writes. The frontend (src/lib/teamProfile.ts) owns the words and the state filter.

create or replace function public.fn_us_state_code(p text)
returns text
language sql
immutable
parallel safe
as $$
  with v as (
    select upper(regexp_replace(btrim(coalesce(p, '')), '[^A-Za-z ]', '', 'g')) as s
  )
  select case
    when s = '' then null
    when length(s) = 2 and s in (
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA',
      'MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
      'UT','VT','VA','WA','WV','WI','WY','PR') then s
    else (
      select t.code from (values
        ('ALABAMA','AL'),('ALASKA','AK'),('ARIZONA','AZ'),('ARKANSAS','AR'),('CALIFORNIA','CA'),('COLORADO','CO'),
        ('CONNECTICUT','CT'),('DELAWARE','DE'),('DISTRICT OF COLUMBIA','DC'),('WASHINGTON DC','DC'),('FLORIDA','FL'),
        ('GEORGIA','GA'),('HAWAII','HI'),('IDAHO','ID'),('ILLINOIS','IL'),('INDIANA','IN'),('IOWA','IA'),('KANSAS','KS'),
        ('KENTUCKY','KY'),('LOUISIANA','LA'),('MAINE','ME'),('MARYLAND','MD'),('MASSACHUSETTS','MA'),('MICHIGAN','MI'),
        ('MINNESOTA','MN'),('MISSISSIPPI','MS'),('MISSOURI','MO'),('MONTANA','MT'),('NEBRASKA','NE'),('NEVADA','NV'),
        ('NEW HAMPSHIRE','NH'),('NEW JERSEY','NJ'),('NEW MEXICO','NM'),('NEW YORK','NY'),('NORTH CAROLINA','NC'),
        ('NORTH DAKOTA','ND'),('OHIO','OH'),('OKLAHOMA','OK'),('OREGON','OR'),('PENNSYLVANIA','PA'),('RHODE ISLAND','RI'),
        ('SOUTH CAROLINA','SC'),('SOUTH DAKOTA','SD'),('TENNESSEE','TN'),('TEXAS','TX'),('UTAH','UT'),('VERMONT','VT'),
        ('VIRGINIA','VA'),('WASHINGTON','WA'),('WEST VIRGINIA','WV'),('WISCONSIN','WI'),('WYOMING','WY'),('PUERTO RICO','PR')
      ) t(name, code) where t.name = v.s
    )
  end
  from v;
$$;

comment on function public.fn_us_state_code(text) is
  'Two-letter US state code from a free-text state ("Az", "wi", "Texas", "New Jersey"); null when it is not one. MP-TEAM-PROFILE-FACTS.';

create or replace function public.fn_instagram_handle(p text)
returns text
language sql
immutable
parallel safe
as $$
  with v as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(btrim(coalesce(p, '')), '^(https?://)?(www\.)?instagram\.com/', '', 'i'),
               '[/?#].*$', ''),
             '^@+|\s+', '', 'g') as h
  )
  select case when h ~ '^[A-Za-z0-9._]{1,30}$' then h end from v;
$$;

comment on function public.fn_instagram_handle(text) is
  'A bare Instagram handle from "@handle", "handle" or an instagram.com link; null when what is on file is not a handle. MP-TEAM-PROFILE-FACTS.';

create or replace function public.crm_agent_profile_facts()
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
  sold_carriers jsonb
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
),
live_ethos as (
  select nullif(regexp_replace(coalesce(e.npn, ''), '\D', '', 'g'), '') as npn,
         e.snapshot_on, e.issued_annual_premium, e.inforce_issued_premium, e.outstanding_chargeback
  from public.ethos_live_production e
  where e.snapshot_on = (select max(x.snapshot_on) from public.ethos_live_production x)
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
  (eh.snapshot_on is not null or le.npn is not null or rv.confirmed_at is not null),
  case
    when eh.snapshot_on is not null then 'ethos_hierarchy'
    when le.npn is not null then 'ethos_portal'
    when rv.confirmed_at is not null then 'review_mark'
  end,
  coalesce(eh.snapshot_on, le.snapshot_on, rv.confirmed_at::date),
  coalesce(eh.issued, le.issued_annual_premium, 0),
  coalesce(eh.inforce, le.inforce_issued_premium, 0),
  coalesce(eh.chargeback, le.outstanding_chargeback, 0),
  coalesce(car.list, '[]'::jsonb),
  coalesce(car.active_n, 0),
  coalesce(sold.list, '[]'::jsonb)
from scope s
left join public.profiles pu on pu.user_id = s.user_id
left join public.profiles pp on pp.id = s.profile_id
left join public.applications ap on ap.id = s.source_application_id
left join public.agent_contract_profile cp on cp.agent_id = s.id
left join auth.users u on u.id = s.user_id
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
  select max(p.snapshot_on) as snapshot_on,
         max(p.issued_premium) as issued,
         max(p.inforce_premium) as inforce,
         max(p.chargeback_total) as chargeback
  from public.ethos_callsheet_people p
  where p.on_ethos and p.in_latest_snapshot
    and (p.agent_id in (s.id, s.canon)
         or (s.npn is not null and nullif(regexp_replace(coalesce(p.npn, ''), '\D', '', 'g'), '') = s.npn))
) eh on true
left join lateral (
  select le0.* from live_ethos le0 where s.npn is not null and le0.npn = s.npn limit 1
) le on true
left join lateral (
  select r.confirmed_at from review r
  where r.agent_id in (s.id, s.canon) and r.carrier_key = 'ethos'
  order by r.confirmed_at desc limit 1
) rv on true
left join lateral (
  select jsonb_agg(jsonb_build_object('carrier', d.carrier, 'status', d.status, 'source', d.source, 'as_of', d.as_of, 'active', d.active)
                   order by d.active desc, d.carrier) as list,
         count(*) filter (where d.active)::int as active_n
  from (
    select distinct on (lower(x.carrier)) x.carrier, x.status, x.source, x.as_of, x.active
    from (
      -- One name per carrier: the review's owner wording ("Combine", "GTO", "AFLAC") and AgentLink's catalog name
      -- ("Combined", "Guarantee Trust Life", "Aflac") are the same contract, never two rows.
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
      select 'Ethos', 'active', 'ethos_hierarchy', eh.snapshot_on, true where eh.snapshot_on is not null
      union all
      select 'Ethos', 'active', 'ethos_portal', le.snapshot_on, true where le.npn is not null
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
  'My Team profile facts per roster person: home state (normalised), licensed states, Instagram handle, login + last sign-in, Discord/Slack flags, Ethos contract (hierarchy export, portal pull or hand mark, with source), carrier contracts on file, and production by carrier. Authorised exactly like crm_agent_roster(). MP-TEAM-PROFILE-FACTS 2026-11-27.';

revoke all on function public.fn_us_state_code(text) from public;
revoke all on function public.fn_instagram_handle(text) from public;
revoke all on function public.crm_agent_profile_facts() from public, anon;
grant execute on function public.fn_us_state_code(text) to authenticated, service_role;
grant execute on function public.fn_instagram_handle(text) to authenticated, service_role;
grant execute on function public.crm_agent_profile_facts() to authenticated, service_role;
