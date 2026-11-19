-- MP-ETHOS-CALLSHEET (2026-11-19)
-- Sam: "I need to spike my production up drastically starting tomorrow ... people who already have my
-- Ethos contract ... that I can call on the spot, figure out what made them drop off, and get them
-- rolling. This screen is going to be made for all managers for their own hierarchies, and me
-- overseeing for all ... mark down after I call them what was the end result."
--
-- Source of the list: the Ethos agent portal's hierarchy performance export (name, NPN, issued premium,
-- in-force premium, persistency, chargebacks). Ethos is a separate book from everything else in this
-- database, so those numbers only exist in that export. Phone, email and sub-agency come from the Ethos
-- signup sheet snapshot; time with us comes from the agent record, the application or the portal date.
--
-- Access: both tables have RLS on and no policies. Every read and write goes through the definer
-- functions below, which scope by the caller:
--   admin            -> everyone on the export
--   an active agent  -> people under them (agents.manager_id chain) plus the Ethos sub-agency they head
--   anyone else      -> nothing
-- No app role is granted or changed here (2026-11-09 lockdown: never re-grant `manager` to open a page).

create table if not exists public.ethos_callsheet_people (
  id uuid primary key default gen_random_uuid(),
  person_key text not null unique,
  npn text,
  full_name text not null,
  name_key text not null,
  phone text,
  email text,
  comp_level text,
  sub_agency text,
  agent_id uuid references public.agents(id) on delete set null,
  agent_match text,
  sub_agency_agent_id uuid references public.agents(id) on delete set null,
  first_seen_on date,
  first_seen_source text,
  issued_premium numeric not null default 0,
  inforce_premium numeric not null default 0,
  persistency_4m numeric,
  persistency_7m numeric,
  persistency_13m numeric,
  chargeback_total numeric,
  chargeback_personal numeric,
  snapshot_on date not null,
  in_latest_snapshot boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ethos_callsheet_people_agent_idx on public.ethos_callsheet_people (agent_id);
create index if not exists ethos_callsheet_people_sub_idx on public.ethos_callsheet_people (sub_agency_agent_id);

create table if not exists public.ethos_callsheet_calls (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.ethos_callsheet_people(id) on delete cascade,
  outcome text not null check (outcome in (
    'no_answer', 'voicemail', 'texted', 'callback', 'coming_back', 'needs_help', 'not_interested', 'wrong_number'
  )),
  reason text check (reason is null or reason in (
    'no_leads', 'other_job', 'other_agency', 'portal_or_contracting', 'no_training', 'no_sales', 'life',
    'no_follow_up', 'other'
  )),
  note text,
  follow_up_on date,
  logged_by uuid not null,
  logged_by_agent_id uuid,
  logged_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists ethos_callsheet_calls_person_idx on public.ethos_callsheet_calls (person_id, created_at desc);

alter table public.ethos_callsheet_people enable row level security;
alter table public.ethos_callsheet_calls enable row level security;
revoke all on public.ethos_callsheet_people from anon, authenticated;
revoke all on public.ethos_callsheet_calls from anon, authenticated;

-- Who the caller may see. Internal: only the functions below call it.
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
    )
    select p.id
      from public.ethos_callsheet_people p
     where p.in_latest_snapshot
       and p.agent_id is distinct from v_self
       and (
         p.agent_id in (select t.id from team t)
         or p.sub_agency_agent_id = v_self
         or p.sub_agency_agent_id in (select t.id from team t)
       );
end;
$$;

revoke all on function public.ethos_callsheet_visible_ids() from public, anon, authenticated;

-- Fill phone, email, sub-agency, the agent link and "with us since" from what the database already holds.
-- Internal: called by the import. Never blanks a value it cannot re-derive.
create or replace function public.ethos_callsheet_resolve()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- 1. Ethos signup sheet (latest complete snapshot), keyed by NPN.
  with snap as (
    select s.id
      from public.ethos_sheet_snapshots s
     where s.status = 'complete'
     order by s.fetched_at desc
     limit 1
  ), sr as (
    select distinct on (r.npn) r.npn, r.mobile, r.email, r.comp_level, r.sub_agency, r.portal_date_raw
      from public.ethos_sheet_rows r
      join snap on snap.id = r.snapshot_id
     where nullif(btrim(r.npn), '') is not null
     order by r.npn, r.row_number desc
  )
  update public.ethos_callsheet_people p
     set phone = coalesce(nullif(btrim(sr.mobile), ''), p.phone),
         email = coalesce(nullif(lower(btrim(sr.email)), ''), p.email),
         comp_level = coalesce(nullif(btrim(sr.comp_level), ''), p.comp_level),
         sub_agency = coalesce(nullif(btrim(sr.sub_agency), ''), p.sub_agency),
         first_seen_on = case
           when sr.portal_date_raw ~ '^\d{1,2}/\d{1,2}/\d{4}$'
             then least(coalesce(p.first_seen_on, to_date(sr.portal_date_raw, 'MM/DD/YYYY')), to_date(sr.portal_date_raw, 'MM/DD/YYYY'))
           else p.first_seen_on
         end,
         first_seen_source = case
           when sr.portal_date_raw ~ '^\d{1,2}/\d{1,2}/\d{4}$'
            and (p.first_seen_on is null or to_date(sr.portal_date_raw, 'MM/DD/YYYY') < p.first_seen_on)
             then 'ethos_portal'
           else p.first_seen_source
         end,
         updated_at = now()
    from sr
   where sr.npn = p.npn;

  -- 1b. Older roster pull, for anyone the sheet snapshot does not carry.
  with er as (
    select distinct on (e.npn) e.npn, e.phone, e.email, e.comp_level, e.subagency
      from public.ethos_roster e
     where nullif(btrim(e.npn), '') is not null
     order by e.npn, e.synced_at desc nulls last
  )
  update public.ethos_callsheet_people p
     set phone = coalesce(p.phone, nullif(btrim(er.phone), '')),
         email = coalesce(p.email, nullif(lower(btrim(er.email)), '')),
         comp_level = coalesce(p.comp_level, nullif(btrim(er.comp_level), '')),
         sub_agency = coalesce(p.sub_agency, nullif(btrim(er.subagency), '')),
         updated_at = now()
    from er
   where er.npn = p.npn
     and (p.phone is null or p.email is null or p.comp_level is null or p.sub_agency is null);

  -- 1c. The sheet carries a few mistyped NPNs. For someone still without a phone, accept the sheet row
  --     with the same full name, but only when that name points at exactly one phone number.
  with snap as (
    select s.id
      from public.ethos_sheet_snapshots s
     where s.status = 'complete'
     order by s.fetched_at desc
     limit 1
  ), byname as (
    select lower(regexp_replace(coalesce(r.first_name, '') || coalesce(r.last_name, ''), '[^a-zA-Z]', '', 'g')) as k,
           min(nullif(btrim(r.mobile), '')) as mobile,
           min(nullif(lower(btrim(r.email)), '')) as email,
           min(nullif(btrim(r.sub_agency), '')) as sub_agency,
           min(nullif(btrim(r.comp_level), '')) as comp_level
      from public.ethos_sheet_rows r
      join snap on snap.id = r.snapshot_id
     group by 1
    having count(distinct regexp_replace(coalesce(r.mobile, ''), '\D', '', 'g')) filter (where nullif(btrim(r.mobile), '') is not null) = 1
  )
  update public.ethos_callsheet_people p
     set phone = b.mobile,
         email = coalesce(p.email, b.email),
         sub_agency = coalesce(p.sub_agency, b.sub_agency),
         comp_level = coalesce(p.comp_level, b.comp_level),
         updated_at = now()
    from byname b
   where p.phone is null
     and b.k = p.name_key
     and b.mobile is not null;

  -- 2. The agent record. NPN first, then email, then an exact name whose NPN does not contradict.
  update public.ethos_callsheet_people p
     set agent_id = x.agent_id,
         agent_match = x.how,
         updated_at = now()
    from (
      select p2.id as pid, m.agent_id, m.how
        from public.ethos_callsheet_people p2
        cross join lateral (
          select coalesce(a.canonical_agent_id, a.id) as agent_id,
                 case
                   when p2.npn is not null and a.nipr_number = p2.npn then 'npn'
                   when p2.email is not null and lower(pr.email) = p2.email then 'email'
                   else 'name'
                 end as how
            from public.agents a
            left join public.profiles pr on pr.id = a.profile_id
           where (p2.npn is not null and a.nipr_number = p2.npn)
              or (p2.email is not null and lower(pr.email) = p2.email)
              or (
                (a.nipr_number is null or p2.npn is null or a.nipr_number = p2.npn)
                and p2.name_key in (
                  lower(regexp_replace(coalesce(nullif(a.display_name, ''), pr.full_name, ''), '[^a-zA-Z]', '', 'g')),
                  lower(regexp_replace(coalesce(pr.full_name, ''), '[^a-zA-Z]', '', 'g'))
                )
              )
           order by (p2.npn is not null and a.nipr_number = p2.npn) desc,
                    (p2.email is not null and lower(pr.email) = p2.email) desc,
                    (a.status <> 'terminated') desc,
                    (a.canonical_agent_id is null) desc,
                    a.created_at desc
           limit 1
        ) m
    ) x
   where x.pid = p.id;

  -- 3. Phone and email from the agent's own profile when Ethos had none.
  update public.ethos_callsheet_people p
     set phone = coalesce(p.phone, nullif(btrim(pr.phone), '')),
         email = coalesce(p.email, nullif(lower(btrim(pr.email)), '')),
         updated_at = now()
    from public.agents a
    join public.profiles pr on pr.id = a.profile_id
   where a.id = p.agent_id
     and (p.phone is null or p.email is null)
     and pr.email not like '%@placeholder.apex';

  -- 4. The Ethos sub-agency head, resolved through the head's own row on the export (NPN-matched above).
  update public.ethos_callsheet_people p
     set sub_agency_agent_id = h.agent_id,
         updated_at = now()
    from public.ethos_callsheet_people h
   where p.sub_agency is not null
     and lower(regexp_replace(p.sub_agency, '[^a-zA-Z]', '', 'g')) like h.name_key || '%'
     and length(h.name_key) >= 8
     and h.agent_id is not null
     and h.id <> p.id
     and p.sub_agency_agent_id is distinct from h.agent_id;

  -- 5. "With us since": the earliest of the agent record and the application, when earlier than the portal date.
  update public.ethos_callsheet_people p
     set first_seen_on = s.seen_on,
         first_seen_source = s.src,
         updated_at = now()
    from (
      select p2.id as pid, c.seen_on, c.src
        from public.ethos_callsheet_people p2
        cross join lateral (
          select z.seen_on, z.src
            from (
              select coalesce(a.start_date, a.created_at::date) as seen_on, 'agent_record'::text as src
                from public.agents a
               where a.id = p2.agent_id or a.canonical_agent_id = p2.agent_id
              union all
              select ap.created_at::date, 'application'::text
                from public.applications ap
               where p2.email is not null and lower(ap.email) = p2.email
            ) z
           where z.seen_on is not null
           order by z.seen_on asc
           limit 1
        ) c
    ) s
   where s.pid = p.id
     and (p.first_seen_on is null or s.seen_on < p.first_seen_on);
end;
$$;

revoke all on function public.ethos_callsheet_resolve() from public, anon, authenticated;

-- Admin: load a fresh Ethos hierarchy performance export. p_rows is a JSON array of
-- {name, npn, issued, inforce, p4, p7, p13, cb_total, cb_personal}. People missing from the new export
-- drop off the sheet (their call history stays).
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

  select count(*) into v_new
    from _ethos_in i
   where not exists (select 1 from public.ethos_callsheet_people p where p.person_key = i.person_key);

  update public.ethos_callsheet_people p
     set in_latest_snapshot = false, updated_at = now()
   where p.in_latest_snapshot
     and not exists (select 1 from _ethos_in i where i.person_key = p.person_key);

  insert into public.ethos_callsheet_people as p (
    person_key, npn, full_name, name_key, issued_premium, inforce_premium,
    persistency_4m, persistency_7m, persistency_13m, chargeback_total, chargeback_personal,
    snapshot_on, in_latest_snapshot
  )
  select i.person_key, i.npn, i.full_name, i.name_key, i.issued_premium, i.inforce_premium,
         i.persistency_4m, i.persistency_7m, i.persistency_13m, i.chargeback_total, i.chargeback_personal,
         p_snapshot_on, true
    from _ethos_in i
  on conflict (person_key) do update
     set npn = excluded.npn,
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
         updated_at = now();

  perform public.ethos_callsheet_resolve();

  return jsonb_build_object(
    'ok', true,
    'people', v_count,
    'new_people', v_new,
    'with_phone', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot and phone is not null),
    'snapshot_on', p_snapshot_on
  );
end;
$$;

revoke all on function public.ethos_call_sheet_import(jsonb, date) from public, anon;
grant execute on function public.ethos_call_sheet_import(jsonb, date) to authenticated;

-- The sheet itself: one object per person the caller may see.
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
             coalesce(nullif(p.sub_agency, 'Apex Financial Empire'), nullif(m.display_name, ''), mp.full_name) as manager_name,
             p.first_seen_on,
             p.first_seen_source,
             p.issued_premium,
             p.inforce_premium,
             p.persistency_4m,
             p.persistency_7m,
             p.persistency_13m,
             p.chargeback_total,
             p.chargeback_personal,
             p.snapshot_on,
             (a.id is not null) as in_app,
             a.status::text as standing,
             a.license_status::text as license,
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
    'snapshot_on', (select max(p.snapshot_on) from public.ethos_callsheet_people p where p.in_latest_snapshot),
    'rows', v_rows
  );
end;
$$;

revoke all on function public.ethos_call_sheet() from public, anon;
grant execute on function public.ethos_call_sheet() to authenticated;

-- Log what happened on a call. Only for someone the caller can see on the sheet.
create or replace function public.ethos_call_sheet_log(
  p_person_id uuid,
  p_outcome text,
  p_reason text default null,
  p_note text default null,
  p_follow_up_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_agent uuid;
  v_name text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ethos_callsheet_visible_ids() v where v.person_id = p_person_id) then
    raise exception 'that person is not on your call sheet' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in (
    'no_answer', 'voicemail', 'texted', 'callback', 'coming_back', 'needs_help', 'not_interested', 'wrong_number'
  ) then
    raise exception 'unknown call result' using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in (
    'no_leads', 'other_job', 'other_agency', 'portal_or_contracting', 'no_training', 'no_sales', 'life',
    'no_follow_up', 'other'
  ) then
    raise exception 'unknown reason' using errcode = '22023';
  end if;

  select a.id, coalesce(nullif(a.display_name, ''), pr.full_name)
    into v_agent, v_name
    from public.agents a
    left join public.profiles pr on pr.id = a.profile_id
   where a.user_id = v_uid
   order by (a.canonical_agent_id is null) desc, a.created_at desc
   limit 1;
  if v_name is null then
    select pr.full_name into v_name from public.profiles pr where pr.user_id = v_uid limit 1;
  end if;

  insert into public.ethos_callsheet_calls (person_id, outcome, reason, note, follow_up_on, logged_by, logged_by_agent_id, logged_by_name)
  values (p_person_id, p_outcome, p_reason, nullif(btrim(left(coalesce(p_note, ''), 2000)), ''), p_follow_up_on, v_uid, v_agent, v_name)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.ethos_call_sheet_log(uuid, text, text, text, date) from public, anon;
grant execute on function public.ethos_call_sheet_log(uuid, text, text, text, date) to authenticated;

-- Add or correct a phone number for someone on the caller's sheet (seven people on the first export had
-- no number anywhere in the database).
create or replace function public.ethos_call_sheet_set_phone(p_person_id uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ethos_callsheet_visible_ids() v where v.person_id = p_person_id) then
    raise exception 'that person is not on your call sheet' using errcode = '42501';
  end if;
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := substr(v_digits, 2);
  end if;
  if length(v_digits) <> 10 then
    raise exception 'enter a 10-digit US phone number' using errcode = '22023';
  end if;
  update public.ethos_callsheet_people
     set phone = v_digits, updated_at = now()
   where id = p_person_id;
  return jsonb_build_object('ok', true, 'phone', v_digits);
end;
$$;

revoke all on function public.ethos_call_sheet_set_phone(uuid, text) from public, anon;
grant execute on function public.ethos_call_sheet_set_phone(uuid, text) to authenticated;
