-- MP-ETHOS-CALLSHEET part 3 (2026-11-19)
-- Sam: "every single agent who's been onboarded, we need their info ... pull all the agent data from
-- AgentLink as well ... every single agent needs to be on these portals" and, minutes later,
-- "it has to prioritize Ethos ... agents who already have contracts, and then from there, licensed agents."
--
-- The sheet was the 89 people on the Ethos export. It now also carries every agent record in this app and
-- everyone on the AgentLink downline roster, each tagged so the page can order them:
--   1  holds the Ethos contract          (on_ethos)
--   2  holds active carrier contracts    (contracts_active > 0, from AgentLink)
--   3  licensed                          (license)
--   4  everyone else who was onboarded
-- Access is unchanged: same two tables (RLS on, no policies), same scoping function, no role granted.

alter table public.ethos_callsheet_people
  add column if not exists on_ethos boolean not null default true,
  add column if not exists al_user_id bigint,
  add column if not exists license text,
  add column if not exists contracts_total integer,
  add column if not exists contracts_active integer,
  add column if not exists carriers jsonb,
  add column if not exists al_last_active_at timestamptz;

create index if not exists ethos_callsheet_people_al_idx on public.ethos_callsheet_people (al_user_id);

-- Put every onboarded agent on the sheet and refresh what AgentLink knows about each person.
-- Internal: called by the import and by an hourly job. Adds and fills; never removes a person.
create or replace function public.ethos_callsheet_sync_roster()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app int := 0;
  v_al int := 0;
begin
  -- Link the people already on the sheet to their agent record first, so nobody is added twice.
  perform public.ethos_callsheet_resolve();

  -- 1. Every agent record in this app that is not on the sheet yet (one per person: aliases are skipped).
  insert into public.ethos_callsheet_people (
    person_key, npn, full_name, name_key, phone, email, agent_id, agent_match, on_ethos, snapshot_on, in_latest_snapshot
  )
  select 'agent:' || a.id::text,
         nullif(btrim(a.nipr_number), ''),
         n.full_name,
         n.name_key,
         nullif(btrim(pr.phone), ''),
         case when pr.email like '%@placeholder.apex' then null else nullif(lower(btrim(pr.email)), '') end,
         a.id,
         'agent_record',
         false,
         current_date,
         true
    from public.agents a
    left join public.profiles pr on pr.id = a.profile_id
    cross join lateral (
      select btrim(coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(a.display_name), ''))) as full_name
    ) n0
    cross join lateral (
      select n0.full_name, lower(regexp_replace(coalesce(n0.full_name, ''), '[^a-zA-Z]', '', 'g')) as name_key
    ) n
   where a.canonical_agent_id is null
     and n.full_name is not null
     and n.full_name !~ '@'
     and length(n.name_key) >= 3
     and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id)
     and not exists (
       select 1 from public.ethos_callsheet_people x
        where x.npn is not null and x.npn = nullif(btrim(a.nipr_number), '')
     )
     and not exists (
       select 1 from public.ethos_callsheet_people x
        where x.agent_id is null and x.name_key = n.name_key
          and (x.npn is null or nullif(btrim(a.nipr_number), '') is null)
     )
  on conflict (person_key) do nothing;
  get diagnostics v_app = row_count;

  -- A row added from an agent record stays tied to that record, whatever the name-matching step found.
  update public.ethos_callsheet_people p
     set agent_id = substring(p.person_key from 7)::uuid,
         agent_match = 'agent_record'
   where p.person_key like 'agent:%'
     and p.agent_id is distinct from substring(p.person_key from 7)::uuid;

  -- 2. Tie people to their AgentLink record: through the agent record, then NPN, then a name that
  --    appears exactly once on the roster.
  update public.ethos_callsheet_people p
     set al_user_id = r.al_user_id, updated_at = now()
    from public.agentlink_roster r
   where p.al_user_id is null
     and (
       exists (
         select 1 from public.agents a
          where a.al_user_id = r.al_user_id and coalesce(a.canonical_agent_id, a.id) = p.agent_id
       )
       or (nullif(btrim(r.npn), '') is not null and btrim(r.npn) = p.npn)
     )
     and not exists (select 1 from public.ethos_callsheet_people x where x.al_user_id = r.al_user_id);

  with keyed as (
    select r.al_user_id,
           lower(regexp_replace(coalesce(r.first_name, '') || coalesce(r.last_name, ''), '[^a-zA-Z]', '', 'g')) as k
      from public.agentlink_roster r
  ), once as (
    select k, min(al_user_id) as al_user_id from keyed group by k having count(*) = 1
  )
  update public.ethos_callsheet_people p
     set al_user_id = o.al_user_id, updated_at = now()
    from once o
   where p.al_user_id is null
     and length(o.k) >= 8
     and p.name_key = o.k
     and not exists (select 1 from public.ethos_callsheet_people x where x.al_user_id = o.al_user_id);

  -- 3. Everyone on the AgentLink roster who is still not on the sheet.
  insert into public.ethos_callsheet_people (
    person_key, npn, full_name, name_key, phone, email, al_user_id, on_ethos, snapshot_on, in_latest_snapshot
  )
  select 'al:' || r.al_user_id::text,
         nullif(btrim(r.npn), ''),
         btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')),
         lower(regexp_replace(coalesce(r.first_name, '') || coalesce(r.last_name, ''), '[^a-zA-Z]', '', 'g')),
         nullif(btrim(r.phone), ''),
         nullif(lower(btrim(r.email)), ''),
         r.al_user_id,
         false,
         current_date,
         true
    from public.agentlink_roster r
   where length(regexp_replace(coalesce(r.first_name, '') || coalesce(r.last_name, ''), '[^a-zA-Z]', '', 'g')) >= 3
     and not exists (select 1 from public.ethos_callsheet_people x where x.al_user_id = r.al_user_id)
  on conflict (person_key) do nothing;
  get diagnostics v_al = row_count;

  -- 4. What AgentLink knows: contracts, carriers, last activity, and contact details the sheet lacks.
  update public.ethos_callsheet_people p
     set contracts_total = r.total_contracts,
         contracts_active = r.active_contracts,
         carriers = r.carriers,
         al_last_active_at = r.last_active_at,
         phone = coalesce(p.phone, nullif(btrim(r.phone), '')),
         email = coalesce(p.email, nullif(lower(btrim(r.email)), '')),
         npn = coalesce(p.npn, nullif(btrim(r.npn), '')),
         updated_at = now()
    from public.agentlink_roster r
   where r.al_user_id = p.al_user_id;

  -- 5. License: the agent record says so, or the person holds an NPN (issued only to the licensed).
  update public.ethos_callsheet_people p
     set license = a.license_status::text
    from public.agents a
   where a.id = p.agent_id
     and p.license is distinct from a.license_status::text;

  update public.ethos_callsheet_people p
     set license = 'licensed'
   where p.agent_id is null
     and p.license is null
     and (p.npn is not null or p.on_ethos);

  -- 6. A leader for people with no agent record here: the nearest AgentLink upline who has one.
  with recursive up as (
    select r.al_user_id as leaf, r.upline_al_id as up_id, 1 as hop
      from public.agentlink_roster r
     where r.upline_al_id is not null
    union all
    select u.leaf, r.upline_al_id, u.hop + 1
      from up u
      join public.agentlink_roster r on r.al_user_id = u.up_id
     where r.upline_al_id is not null and u.hop < 6
  ), hit as (
    select distinct on (u.leaf) u.leaf, coalesce(a.canonical_agent_id, a.id) as agent_id
      from up u
      join public.agents a on a.al_user_id = u.up_id
     order by u.leaf, u.hop asc, (a.canonical_agent_id is null) desc
  )
  update public.ethos_callsheet_people p
     set sub_agency_agent_id = h.agent_id, updated_at = now()
    from hit h
   where p.al_user_id = h.leaf
     and p.agent_id is null
     and p.sub_agency_agent_id is null
     and h.agent_id is not null;

  return jsonb_build_object(
    'ok', true,
    'added_from_app', v_app,
    'added_from_agentlink', v_al,
    'people', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot),
    'with_phone', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot and phone is not null)
  );
end;
$$;

revoke all on function public.ethos_callsheet_sync_roster() from public, anon, authenticated;

-- The import, restated: a person who leaves the Ethos export stays on the sheet as a non-Ethos agent when
-- they have an agent or AgentLink record, and a person already on the sheet is adopted, not duplicated.
create or replace function public.ethos_call_sheet_import(p_rows jsonb, p_snapshot_on date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_new int;
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::app_role) then
    raise exception 'only the owner can load an Ethos export' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'expected a list of rows' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 5000 then
    raise exception 'expected between 1 and 5000 rows, got %', v_count using errcode = '22023';
  end if;

  drop table if exists pg_temp._ethos_in;
  create temporary table _ethos_in on commit drop as
  select distinct on (person_key) *
    from (
      select
        case when nullif(btrim(r->>'npn'), '') is not null
             then 'npn:' || btrim(r->>'npn')
             else 'name:' || lower(regexp_replace(coalesce(r->>'name', ''), '[^a-zA-Z]', '', 'g'))
        end as person_key,
        nullif(btrim(r->>'npn'), '') as npn,
        btrim(r->>'name') as full_name,
        lower(regexp_replace(coalesce(r->>'name', ''), '[^a-zA-Z]', '', 'g')) as name_key,
        coalesce(nullif(r->>'issued', '')::numeric, 0) as issued_premium,
        coalesce(nullif(r->>'inforce', '')::numeric, 0) as inforce_premium,
        nullif(r->>'p4', '')::numeric as persistency_4m,
        nullif(r->>'p7', '')::numeric as persistency_7m,
        nullif(r->>'p13', '')::numeric as persistency_13m,
        nullif(r->>'cb_total', '')::numeric as chargeback_total,
        nullif(r->>'cb_personal', '')::numeric as chargeback_personal
      from jsonb_array_elements(p_rows) r
     where nullif(btrim(r->>'name'), '') is not null
    ) q
   order by person_key;

  select count(*) into v_count from _ethos_in;
  if v_count < 1 then
    raise exception 'no usable rows: every row needs a name' using errcode = '22023';
  end if;

  -- Someone already on the sheet as a non-Ethos agent takes the Ethos key instead of getting a second row.
  update public.ethos_callsheet_people p
     set person_key = pick.person_key, npn = coalesce(pick.npn, p.npn), updated_at = now()
    from (
      select distinct on (i.person_key) i.person_key, i.npn, x.id
        from _ethos_in i
        join public.ethos_callsheet_people x
          on not x.on_ethos
         and ((i.npn is not null and x.npn = i.npn) or (x.npn is null and x.name_key = i.name_key))
       where not exists (select 1 from public.ethos_callsheet_people e where e.person_key = i.person_key)
       order by i.person_key, (x.npn is not null) desc, x.created_at asc
    ) pick
   where p.id = pick.id;

  select count(*) into v_new
    from _ethos_in i
   where not exists (select 1 from public.ethos_callsheet_people p where p.person_key = i.person_key);

  update public.ethos_callsheet_people p
     set on_ethos = false,
         in_latest_snapshot = (p.agent_id is not null or p.al_user_id is not null),
         issued_premium = 0,
         inforce_premium = 0,
         chargeback_total = null,
         chargeback_personal = null,
         updated_at = now()
   where p.on_ethos
     and not exists (select 1 from _ethos_in i where i.person_key = p.person_key);

  insert into public.ethos_callsheet_people as p (
    person_key, npn, full_name, name_key, issued_premium, inforce_premium,
    persistency_4m, persistency_7m, persistency_13m, chargeback_total, chargeback_personal,
    snapshot_on, in_latest_snapshot, on_ethos
  )
  select i.person_key, i.npn, i.full_name, i.name_key, i.issued_premium, i.inforce_premium,
         i.persistency_4m, i.persistency_7m, i.persistency_13m, i.chargeback_total, i.chargeback_personal,
         p_snapshot_on, true, true
    from _ethos_in i
  on conflict (person_key) do update
     set npn = coalesce(excluded.npn, p.npn),
         full_name = excluded.full_name,
         name_key = excluded.name_key,
         issued_premium = excluded.issued_premium,
         inforce_premium = excluded.inforce_premium,
         persistency_4m = excluded.persistency_4m,
         persistency_7m = excluded.persistency_7m,
         persistency_13m = excluded.persistency_13m,
         chargeback_total = excluded.chargeback_total,
         chargeback_personal = excluded.chargeback_personal,
         snapshot_on = excluded.snapshot_on,
         in_latest_snapshot = true,
         on_ethos = true,
         updated_at = now();

  perform public.ethos_callsheet_sync_roster();

  return jsonb_build_object(
    'ok', true,
    'people', v_count,
    'new_people', v_new,
    'with_phone', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot and on_ethos and phone is not null),
    'snapshot_on', p_snapshot_on
  );
end;
$$;

revoke all on function public.ethos_call_sheet_import(jsonb, date) from public, anon;
grant execute on function public.ethos_call_sheet_import(jsonb, date) to authenticated;

-- The sheet, restated with the fields the page orders and labels by.
create or replace function public.ethos_call_sheet()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb)
    into v_rows
    from (
      select p.id,
             p.full_name,
             p.npn,
             p.phone,
             p.email,
             p.comp_level,
             p.sub_agency,
             coalesce(
               nullif(p.sub_agency, 'Apex Financial Empire'),
               nullif(m.display_name, ''), mp.full_name,
               nullif(sa.display_name, ''), sap.full_name
             ) as manager_name,
             p.first_seen_on,
             p.first_seen_source,
             p.on_ethos,
             p.issued_premium,
             p.inforce_premium,
             p.persistency_4m,
             p.persistency_7m,
             p.persistency_13m,
             p.chargeback_total,
             p.chargeback_personal,
             p.snapshot_on,
             coalesce(p.contracts_total, 0) as contracts_total,
             coalesce(p.contracts_active, 0) as contracts_active,
             (
               select jsonb_agg(distinct c->>'name')
                 from jsonb_array_elements(case when jsonb_typeof(p.carriers) = 'array' then p.carriers else '[]'::jsonb end) c
                where c->>'status' = 'active' or (c->>'active') ~ '^[1-9]'
             ) as active_carriers,
             p.al_last_active_at,
             (a.id is not null) as in_app,
             a.status::text as standing,
             coalesce(a.license_status::text, p.license) as license,
             a.onboarding_stage::text as stage,
             (a.user_id is not null) as has_login,
             u.last_sign_in_at,
             prod.lifetime_ap,
             prod.last_deal_on,
             prod.deals_30d,
             lc.outcome as last_outcome,
             lc.reason as last_reason,
             lc.note as last_note,
             lc.follow_up_on,
             lc.created_at as last_called_at,
             lc.logged_by_name as last_called_by,
             coalesce(cc.calls, 0) as calls
        from public.ethos_callsheet_people p
        join public.ethos_callsheet_visible_ids() v on v.person_id = p.id
        left join public.agents a on a.id = p.agent_id
        left join public.agents m on m.id = a.manager_id and m.id <> a.id
        left join public.profiles mp on mp.id = m.profile_id
        left join public.agents sa on sa.id = p.sub_agency_agent_id
        left join public.profiles sap on sap.id = sa.profile_id
        left join auth.users u on u.id = a.user_id
        left join lateral (
          select round(sum(mu.annual_premium), 2) as lifetime_ap,
                 max(mu.posted_date) as last_deal_on,
                 count(*) filter (where mu.posted_date > current_date - 30) as deals_30d
            from public.mat_production_unified mu
           where p.agent_id is not null
             and mu.agent_id in (
               select x.id from public.agents x where x.id = p.agent_id or x.canonical_agent_id = p.agent_id
             )
        ) prod on true
        left join lateral (
          select c.outcome, c.reason, c.note, c.follow_up_on, c.created_at, c.logged_by_name
            from public.ethos_callsheet_calls c
           where c.person_id = p.id
           order by c.created_at desc
           limit 1
        ) lc on true
        left join lateral (
          select count(*)::int as calls from public.ethos_callsheet_calls c where c.person_id = p.id
        ) cc on true
    ) r;

  return jsonb_build_object(
    'sees_all', public.has_role(v_uid, 'admin'::app_role),
    'snapshot_on', (select max(p.snapshot_on) from public.ethos_callsheet_people p where p.in_latest_snapshot and p.on_ethos),
    'rows', v_rows
  );
end;
$$;

revoke all on function public.ethos_call_sheet() from public, anon;
grant execute on function public.ethos_call_sheet() to authenticated;

-- Who the caller may see, restated: a leader's hierarchy is the app's manager chain, the Ethos sub-agency
-- they head, and now their AgentLink downline as well (most agents sit under the owner in this app while
-- AgentLink holds the real upline, so the app chain alone showed a leader a fraction of their people).
create or replace function public.ethos_callsheet_visible_ids()
returns table(person_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_self uuid;
  v_active boolean;
  v_al bigint;
begin
  if v_uid is null then
    return;
  end if;

  select coalesce(a.canonical_agent_id, a.id),
         (a.status = 'active' and not coalesce(a.is_deactivated, false) and not coalesce(a.is_inactive, false))
    into v_self, v_active
    from public.agents a
   where a.user_id = v_uid
   order by (a.status = 'active') desc, (a.canonical_agent_id is null) desc, a.created_at desc
   limit 1;

  if public.has_role(v_uid, 'admin'::app_role) then
    return query
      select p.id
        from public.ethos_callsheet_people p
       where p.in_latest_snapshot
         and (v_self is null or p.agent_id is distinct from v_self);
    return;
  end if;

  if v_self is null or not coalesce(v_active, false) then
    return;
  end if;

  select a.al_user_id into v_al
    from public.agents a
   where (a.id = v_self or a.canonical_agent_id = v_self) and a.al_user_id is not null
   order by (a.id = v_self) desc
   limit 1;

  return query
    with recursive team as (
      select a.id, 1 as depth
        from public.agents a
       where a.manager_id = v_self and a.id <> v_self
      union
      select a.id, t.depth + 1
        from public.agents a
        join team t on a.manager_id = t.id
       where t.depth < 12 and a.id <> v_self
    ), al_team as (
      select r.al_user_id, 1 as depth
        from public.agentlink_roster r
       where v_al is not null and r.upline_al_id = v_al and r.al_user_id <> v_al
      union
      select r.al_user_id, d.depth + 1
        from public.agentlink_roster r
        join al_team d on r.upline_al_id = d.al_user_id
       where d.depth < 8 and r.al_user_id <> v_al
    )
    select p.id
      from public.ethos_callsheet_people p
     where p.in_latest_snapshot
       and p.agent_id is distinct from v_self
       and (v_al is null or p.al_user_id is distinct from v_al)
       and (
         p.agent_id in (select t.id from team t)
         or p.sub_agency_agent_id = v_self
         or p.sub_agency_agent_id in (select t.id from team t)
         or p.al_user_id in (select d.al_user_id from al_team d)
       );
end;
$$;

revoke all on function public.ethos_callsheet_visible_ids() from public, anon, authenticated;

-- New agent records and roster changes reach the sheet within the hour.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('callsheet-roster-sync', '17 * * * *', 'select public.ethos_callsheet_sync_roster()');
  end if;
end;
$$;
