-- My Team: one training stage per agent, weekday work commitments, and one-tap workday attendance (2026-10-09)
--
-- Sam, 2026-10-09: one agent profile from hire through online training, training, field release and contracting; three exact
-- stage labels ("Online training", "Training", "Released in field") shown as a small badge beside the name; five weekday
-- checkboxes (Mon to Fri) for how many days a week the agent has committed to work; and attendance that starts from today in
-- America/Phoenix, expects only the people scheduled for that day, and keeps every mark and correction.
--
-- THESE ARE SEPARATE FACTS. The stage does not change onboarding_stage, commission, licensing or contracting; a carrier mark does
-- not change the stage; a work commitment does not prove attendance; attendance does not change employment status.
--
-- MEASURED BEFORE DESIGNING (2026-10-09, live):
--   * The existing stage setter (set_agent_training_stage) is a four-value concept (test/classroom/field/active) that also moves
--     onboarding_stage and several timestamps. It is left exactly as it is: the new label is its own audited fact, so retitling
--     someone cannot move their onboarding or comp fields.
--   * agent_attendance already exists (admin / team-manager / self policies, UNIQUE agent+date+type) and holds 1 row, so a new
--     'workday' type reuses it rather than adding a parallel table. Its status enum already is present/absent/excused/unmarked.
--   * agents.start_date is empty on 63 of 100 active agents, so employment starts at start_date, else the day the profile was created.
--
-- WHAT THIS DOES (additive; idempotent; no existing row is rewritten):
--   1. agent_stage + agent_stage_events: the three stages. New agents are placed in Online training by a trigger that cannot fail
--      the agent insert. People whose history is unambiguous are mapped ONCE; everyone else stays visibly "not set" for staff.
--   2. agent_work_commitments + events: Monday to Friday sets, effective-dated and PROSPECTIVE (today or later). Past rows are never
--      edited, so history is never rewritten. No row = "Schedule not set", which is not the same as zero days.
--   3. agent_attendance gains workday snapshots (stage and schedule at the moment of the mark) and agent_attendance_events keeps every
--      mark, change and clear.
--   4. RPCs: team_people_facts, set_agent_stage, set_work_commitment, team_attendance_day, set_workday_attendance, set_workday_attendance_bulk.

begin;

create or replace function public.fn_phoenix_today() returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Phoenix')::date
$$;

-- who is on the team for these purposes: the same active, real, canonical people as the contracting review
create or replace function public.fn_team_population() returns table (agent_id uuid)
language sql stable security definer set search_path = public as $$
  select p.agent_id from public.fn_contract_review_population() p
$$;

-- ── 1. training stage ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.agent_stage (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  stage text not null check (stage in ('online_training', 'training', 'released_in_field')),
  source text not null check (source in ('staff', 'default', 'mapped')),
  set_by uuid,
  set_at timestamptz not null default now()
);

create table if not exists public.agent_stage_events (
  id bigint generated always as identity primary key,
  agent_id uuid not null,
  from_stage text,
  to_stage text not null,
  source text not null,
  acted_by uuid,
  acted_at timestamptz not null default now()
);
create index if not exists agent_stage_events_agent_idx on public.agent_stage_events (agent_id, acted_at desc);

create or replace function public.fn_append_only_guard() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists trg_agent_stage_events_append_only on public.agent_stage_events;
create trigger trg_agent_stage_events_append_only before update or delete on public.agent_stage_events
  for each row execute function public.fn_append_only_guard();

create or replace function public.fn_stage_label(p_stage text) returns text language sql immutable set search_path = public as $$
  select case p_stage when 'online_training' then 'Online training' when 'training' then 'Training' when 'released_in_field' then 'Released in field' end
$$;

-- a new agent starts in Online training. It must never fail the agent insert: a stage badge is not worth a lost hire.
create or replace function public.fn_agents_default_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.agent_code like 'GHOST\_%' and new.user_id is null then return new; end if;     -- sync-only placeholder seats are not people
  if new.canonical_agent_id is not null and new.canonical_agent_id <> new.id then return new; end if;
  begin
    insert into public.agent_stage (agent_id, stage, source) values (new.id, 'online_training', 'default') on conflict (agent_id) do nothing;
    if found then
      insert into public.agent_stage_events (agent_id, from_stage, to_stage, source) values (new.id, null, 'online_training', 'default');
    end if;
  exception when others then
    raise warning 'fn_agents_default_stage: % (agent %)', sqlerrm, new.id;
  end;
  return new;
end $$;
drop trigger if exists trg_agents_default_stage on public.agents;
create trigger trg_agents_default_stage after insert on public.agents for each row execute function public.fn_agents_default_stage();

-- one-time mapping of history that is unambiguous. Everything else is left unset on purpose (a staff review queue).
--   training_online                                   -> Online training
--   a first deal, or live / evaluated / below_10k     -> Released in field
-- in_field_training, onboarding, pre_licensed, transfer, need_followup and a missing stage are NOT guessed.
with mapped as (
  insert into public.agent_stage (agent_id, stage, source)
  select p.agent_id,
         case when a.onboarding_stage::text = 'training_online' then 'online_training' else 'released_in_field' end,
         'mapped'
    from public.fn_team_population() p
    join public.agents a on a.id = p.agent_id
   where not exists (select 1 from public.agent_stage s where s.agent_id = p.agent_id)
     and (a.onboarding_stage::text = 'training_online' or a.first_deal_at is not null or a.onboarding_stage::text in ('live', 'evaluated', 'below_10k'))
  on conflict (agent_id) do nothing
  returning agent_id, stage
)
insert into public.agent_stage_events (agent_id, from_stage, to_stage, source)
select agent_id, null, stage, 'mapped' from mapped;

create or replace function public.set_agent_stage(
  p_agent_id uuid, p_stage text, p_expected text default null, p_expect_unset boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_canon uuid;
  v_cur text;
  v_has boolean;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_stage is null or p_stage not in ('online_training', 'training', 'released_in_field') then
    raise exception 'unknown stage' using errcode = '22023';
  end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not (public.apex_is_admin()
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id) and public.apex_can_read_agent(v_canon))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fn_team_population() p where p.agent_id = v_canon) then
    raise exception 'That person is not an active agent on the team' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':stage', 9));
  select s.stage, true into v_cur, v_has from public.agent_stage s where s.agent_id = v_canon;
  v_has := coalesce(v_has, false);
  if (p_expected is not null and p_expected is distinct from v_cur) or (p_expected is null and p_expect_unset and v_has) then
    return jsonb_build_object('ok', false, 'conflict', true, 'stage', v_cur);
  end if;
  if v_has and v_cur = p_stage then
    return jsonb_build_object('ok', true, 'stage', p_stage, 'changed', false);
  end if;
  insert into public.agent_stage (agent_id, stage, source, set_by, set_at) values (v_canon, p_stage, 'staff', v_uid, now())
    on conflict (agent_id) do update set stage = excluded.stage, source = 'staff', set_by = excluded.set_by, set_at = excluded.set_at;
  insert into public.agent_stage_events (agent_id, from_stage, to_stage, source, acted_by) values (v_canon, v_cur, p_stage, 'staff', v_uid);
  return jsonb_build_object('ok', true, 'stage', p_stage, 'changed', true);
end $$;

-- ── 2. weekday work commitments ──────────────────────────────────────────────────────────────────────────────

-- Monday (1) to Friday (5), each at most once. A CHECK cannot hold a subquery, so the rule lives in an immutable function.
create or replace function public.fn_weekdays_valid(p smallint[]) returns boolean language sql immutable set search_path = public as $$
  select p is not null and p <@ array[1, 2, 3, 4, 5]::smallint[] and cardinality(p) = (select count(distinct x) from unnest(p) x)
$$;

create table if not exists public.agent_work_commitments (
  agent_id uuid not null references public.agents(id) on delete cascade,
  effective_from date not null,
  weekdays smallint[] not null check (public.fn_weekdays_valid(weekdays)),
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (agent_id, effective_from)
);

create table if not exists public.agent_work_commitment_events (
  id bigint generated always as identity primary key,
  agent_id uuid not null,
  effective_from date not null,
  from_weekdays smallint[],
  to_weekdays smallint[] not null,
  acted_by uuid,
  acted_at timestamptz not null default now()
);
create index if not exists agent_work_commitment_events_agent_idx on public.agent_work_commitment_events (agent_id, acted_at desc);
drop trigger if exists trg_agent_work_commitment_events_append_only on public.agent_work_commitment_events;
create trigger trg_agent_work_commitment_events_append_only before update or delete on public.agent_work_commitment_events
  for each row execute function public.fn_append_only_guard();

-- The schedule in force on a date: the newest commitment taking effect on or before it. NULL = never set (not the same as '{}', zero days).
create or replace function public.fn_work_weekdays_on(p_agent_id uuid, p_date date) returns smallint[]
language sql stable security definer set search_path = public as $$
  select c.weekdays from public.agent_work_commitments c where c.agent_id = p_agent_id and c.effective_from <= p_date order by c.effective_from desc limit 1
$$;

create or replace function public.set_work_commitment(
  p_agent_id uuid, p_weekdays smallint[], p_effective_from date default null, p_expected smallint[] default null, p_expect_unset boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_canon uuid;
  v_today date := public.fn_phoenix_today();
  v_eff date := coalesce(p_effective_from, public.fn_phoenix_today());
  v_days smallint[];
  v_cur smallint[];
  v_has boolean;
  v_row_exists boolean;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_weekdays is null then raise exception 'weekdays are required (an empty list means no scheduled days)' using errcode = '22023'; end if;
  select coalesce(array_agg(x order by x), '{}'::smallint[]) into v_days from (select distinct x from unnest(p_weekdays) x) d;
  if exists (select 1 from unnest(v_days) x where x not between 1 and 5) then
    raise exception 'weekdays are Monday (1) to Friday (5)' using errcode = '22023';
  end if;
  -- Prospective only: today or later. A commitment that has already started is history and is never edited.
  if v_eff < v_today then raise exception 'A work commitment takes effect today or later, never in the past' using errcode = '22023'; end if;
  if v_eff > v_today + 365 then raise exception 'That date is too far ahead' using errcode = '22023'; end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not (public.apex_is_admin()
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id) and public.apex_can_read_agent(v_canon))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fn_team_population() p where p.agent_id = v_canon) then
    raise exception 'That person is not an active agent on the team' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':workdays', 9));
  select c.weekdays, true into v_cur, v_has from public.agent_work_commitments c where c.agent_id = v_canon and c.effective_from <= v_eff order by c.effective_from desc limit 1;
  v_has := coalesce(v_has, false);
  if (p_expected is not null and v_has and p_expected is distinct from v_cur) or (p_expected is not null and not v_has) or (p_expected is null and p_expect_unset and v_has) then
    return jsonb_build_object('ok', false, 'conflict', true, 'weekdays', v_cur, 'set', v_has);
  end if;
  select exists (select 1 from public.agent_work_commitments c where c.agent_id = v_canon and c.effective_from = v_eff) into v_row_exists;
  if v_has and v_cur = v_days and not v_row_exists then
    return jsonb_build_object('ok', true, 'weekdays', v_days, 'changed', false);
  end if;
  insert into public.agent_work_commitments (agent_id, effective_from, weekdays, set_by, set_at) values (v_canon, v_eff, v_days, v_uid, now())
    on conflict (agent_id, effective_from) do update set weekdays = excluded.weekdays, set_by = excluded.set_by, set_at = excluded.set_at;
  insert into public.agent_work_commitment_events (agent_id, effective_from, from_weekdays, to_weekdays, acted_by) values (v_canon, v_eff, v_cur, v_days, v_uid);
  return jsonb_build_object('ok', true, 'weekdays', v_days, 'effective_from', v_eff, 'changed', true);
end $$;

-- ── 3. attendance ─────────────────────────────────────────────────────────────────────────────────────────────

alter table public.agent_attendance add column if not exists stage_at_mark text;
alter table public.agent_attendance add column if not exists was_scheduled boolean;
alter table public.agent_attendance add column if not exists schedule_weekdays smallint[];
alter table public.agent_attendance add column if not exists note text;

create table if not exists public.agent_attendance_events (
  id bigint generated always as identity primary key,
  agent_id uuid not null,
  attendance_date date not null,
  from_status text,
  to_status text not null,
  was_scheduled boolean,
  stage_at_mark text,
  note text,
  acted_by uuid,
  acted_at timestamptz not null default now()
);
create index if not exists agent_attendance_events_agent_idx on public.agent_attendance_events (agent_id, attendance_date desc);
drop trigger if exists trg_agent_attendance_events_append_only on public.agent_attendance_events;
create trigger trg_agent_attendance_events_append_only before update or delete on public.agent_attendance_events
  for each row execute function public.fn_append_only_guard();

-- access to the new tables: read through the functions only; the audit tables are readable by scope for realtime
alter table public.agent_stage enable row level security;
alter table public.agent_stage_events enable row level security;
alter table public.agent_work_commitments enable row level security;
alter table public.agent_work_commitment_events enable row level security;
alter table public.agent_attendance_events enable row level security;
revoke all on table public.agent_stage, public.agent_stage_events, public.agent_work_commitments, public.agent_work_commitment_events,
  public.agent_attendance_events from public, anon, authenticated;
grant all on table public.agent_stage, public.agent_stage_events, public.agent_work_commitments, public.agent_work_commitment_events,
  public.agent_attendance_events to service_role;
grant select on table public.agent_stage_events, public.agent_work_commitment_events, public.agent_attendance_events to authenticated;
drop policy if exists agent_stage_events_scoped_read on public.agent_stage_events;
create policy agent_stage_events_scoped_read on public.agent_stage_events for select to authenticated
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')
         or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(agent_id)));
drop policy if exists agent_work_commitment_events_scoped_read on public.agent_work_commitment_events;
create policy agent_work_commitment_events_scoped_read on public.agent_work_commitment_events for select to authenticated
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')
         or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(agent_id)));
drop policy if exists agent_attendance_events_scoped_read on public.agent_attendance_events;
create policy agent_attendance_events_scoped_read on public.agent_attendance_events for select to authenticated
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')
         or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(agent_id)));
do $$
declare t text;
begin
  foreach t in array array['agent_attendance_events', 'agent_stage_events'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── 4. reads ──────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_team_reader() returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va') then return true; end if;
  if public.has_role(v_uid, 'manager') then return false; end if;
  raise exception 'not authorized' using errcode = '42501';
end $$;

create or replace function public.team_people_facts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_all boolean := public.fn_team_reader();
  v_today date := public.fn_phoenix_today();
  v_people jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', a.id,
      'stage', s.stage, 'stage_label', public.fn_stage_label(s.stage), 'stage_source', s.source,
      'schedule_set', cur.weekdays is not null,
      'weekdays', to_jsonb(cur.weekdays),
      'next_schedule', (select jsonb_build_object('effective_from', n.effective_from, 'weekdays', to_jsonb(n.weekdays))
                          from public.agent_work_commitments n where n.agent_id = a.id and n.effective_from > v_today order by n.effective_from limit 1),
      'access', jsonb_build_object(
          'has_login', a.user_id is not null,
          'invitation', coalesce((select public.fn_invitation_status(i.used_at, i.superseded_by, i.is_active, i.revoked_at, i.expires_at)
                                    from public.invite_tokens i
                                   where i.used_by_agent_id = a.id
                                      or (lower(btrim(coalesce(i.recipient_email, ''))) <> '' and lower(btrim(i.recipient_email)) = lower(btrim(coalesce(pr.email, ''))))
                                   order by i.created_at desc limit 1), 'none'))
    ) order by a.id), '[]'::jsonb)
    into v_people
    from public.fn_team_population() p
    join public.agents a on a.id = p.agent_id
    left join public.agent_stage s on s.agent_id = a.id
    left join lateral (select public.fn_work_weekdays_on(a.id, v_today) as weekdays) cur on true
    left join public.profiles pr on pr.user_id = a.user_id
   where v_all or public.apex_can_read_agent(a.id);

  return jsonb_build_object('ok', true, 'as_of', v_today, 'people', v_people,
    'counts', jsonb_build_object('people', jsonb_array_length(v_people),
      'stage_unset', (select count(*) from jsonb_array_elements(v_people) e where e->>'stage' is null),
      'schedule_unset', (select count(*) from jsonb_array_elements(v_people) e where (e->>'schedule_set')::boolean is not true)));
end $$;

-- one day of attendance: who is expected (from the schedule in force that day and employment dates), and what was marked
create or replace function public.team_attendance_day(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_all boolean := public.fn_team_reader();
  v_today date := public.fn_phoenix_today();
  v_date date := coalesce(p_date, public.fn_phoenix_today());
  v_dow int;
  v_people jsonb;
begin
  if v_date > v_today then raise exception 'Attendance can be taken for today or an earlier day' using errcode = '22023'; end if;
  if v_date < v_today - 400 then raise exception 'That date is too far back' using errcode = '22023'; end if;
  v_dow := extract(isodow from v_date)::int;

  with base as (
    select a.id as agent_id,
           coalesce(pr.full_name, a.display_name, 'Name not on file') as display_name,
           coalesce(pr.email, '') as email,
           coalesce(a.start_date, (a.created_at at time zone 'America/Phoenix')::date) as started_on,
           s.stage as stage,
           public.fn_work_weekdays_on(a.id, v_date) as wd,
           (public.fn_work_weekdays_on(a.id, v_date)) is not null as sched_set
      from public.fn_team_population() p
      join public.agents a on a.id = p.agent_id
      left join public.profiles pr on pr.user_id = a.user_id
      left join public.agent_stage s on s.agent_id = a.id
     where (v_all or public.apex_can_read_agent(a.id))
       and coalesce(a.start_date, (a.created_at at time zone 'America/Phoenix')::date) <= v_date
  ), joined as (
    select b.*, at.status::text as mark, at.marked_by, at.updated_at as marked_at, at.note, at.was_scheduled, at.stage_at_mark,
           case when not b.sched_set then 'unknown' when v_dow between 1 and 5 and v_dow = any (b.wd) then 'yes' else 'no' end as expected
      from base b
      left join public.agent_attendance at on at.agent_id = b.agent_id and at.attendance_date = v_date and at.attendance_type = 'workday'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', j.agent_id, 'display_name', j.display_name, 'email', nullif(j.email, ''), 'stage', j.stage, 'stage_label', public.fn_stage_label(j.stage),
      'expected', j.expected, 'weekdays', to_jsonb(j.wd), 'status', coalesce(j.mark, 'unmarked'),
      'marked_by_name', (select coalesce(m.display_name, 'a team member') from public.agents m where m.user_id = j.marked_by order by m.created_at limit 1),
      'marked_at', case when j.mark is not null then j.marked_at end, 'note', j.note
    ) order by case j.expected when 'yes' then 0 when 'unknown' then 1 else 2 end, j.display_name, j.agent_id), '[]'::jsonb)
    into v_people from joined j;

  return jsonb_build_object('ok', true, 'date', v_date, 'is_today', v_date = v_today, 'weekday', v_dow, 'people', v_people,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_people),
      'expected', (select count(*) from jsonb_array_elements(v_people) e where e->>'expected' = 'yes'),
      'present', (select count(*) from jsonb_array_elements(v_people) e where e->>'status' = 'present'),
      'absent', (select count(*) from jsonb_array_elements(v_people) e where e->>'status' = 'absent'),
      'excused', (select count(*) from jsonb_array_elements(v_people) e where e->>'status' = 'excused'),
      'unmarked', (select count(*) from jsonb_array_elements(v_people) e where e->>'expected' = 'yes' and e->>'status' = 'unmarked'),
      'not_scheduled', (select count(*) from jsonb_array_elements(v_people) e where e->>'expected' = 'no'),
      'schedule_not_set', (select count(*) from jsonb_array_elements(v_people) e where e->>'expected' = 'unknown')));
end $$;

-- ── 5. writes ─────────────────────────────────────────────────────────────────────────────────────────────────
-- A mark is one row per person per day. Present, Absent and Excused are marks; 'unmarked' clears the mark. Every change is
-- logged with who, when and what it replaced, and the row keeps a snapshot of the stage and schedule at that moment so a
-- later schedule change can never rewrite what was true then. Compare-and-set: the caller says what it believes the mark is.

create or replace function public.fn_workday_apply(
  p_agent uuid, p_date date, p_status text, p_expected text, p_note text, p_uid uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur text;
  v_wd smallint[];
  v_sched boolean;
  v_stage text;
begin
  select at.status::text into v_cur from public.agent_attendance at where at.agent_id = p_agent and at.attendance_date = p_date and at.attendance_type = 'workday';
  v_cur := coalesce(v_cur, 'unmarked');
  if p_expected is not null and p_expected is distinct from v_cur then
    return jsonb_build_object('ok', false, 'conflict', true, 'status', v_cur);
  end if;
  if v_cur = p_status then
    return jsonb_build_object('ok', true, 'status', v_cur, 'changed', false);
  end if;
  v_wd := public.fn_work_weekdays_on(p_agent, p_date);
  v_sched := case when v_wd is null then null else (extract(isodow from p_date)::int between 1 and 5 and extract(isodow from p_date)::int = any (v_wd)) end;
  select s.stage into v_stage from public.agent_stage s where s.agent_id = p_agent;
  if p_status = 'unmarked' then
    delete from public.agent_attendance where agent_id = p_agent and attendance_date = p_date and attendance_type = 'workday';
  else
    insert into public.agent_attendance (agent_id, attendance_date, attendance_type, status, marked_by, stage_at_mark, was_scheduled, schedule_weekdays, note)
      values (p_agent, p_date, 'workday', p_status::public.attendance_mark, p_uid, v_stage, v_sched, v_wd, nullif(btrim(coalesce(p_note, '')), ''))
      on conflict (agent_id, attendance_date, attendance_type) do update
        set status = excluded.status, marked_by = excluded.marked_by, updated_at = now(), note = excluded.note,
            stage_at_mark = excluded.stage_at_mark, was_scheduled = excluded.was_scheduled, schedule_weekdays = excluded.schedule_weekdays;
  end if;
  insert into public.agent_attendance_events (agent_id, attendance_date, from_status, to_status, was_scheduled, stage_at_mark, note, acted_by)
    values (p_agent, p_date, v_cur, p_status, v_sched, v_stage, nullif(btrim(coalesce(p_note, '')), ''), p_uid);
  return jsonb_build_object('ok', true, 'status', p_status, 'changed', true);
end $$;

create or replace function public.set_workday_attendance(
  p_agent_id uuid, p_date date, p_status text, p_expected text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_canon uuid;
  v_today date := public.fn_phoenix_today();
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('present', 'absent', 'excused', 'unmarked') then raise exception 'unknown status' using errcode = '22023'; end if;
  if p_expected is not null and p_expected not in ('present', 'absent', 'excused', 'unmarked') then raise exception 'unknown expected status' using errcode = '22023'; end if;
  if p_date is null or p_date > v_today then raise exception 'Attendance can be taken for today or an earlier day' using errcode = '22023'; end if;
  if p_date < v_today - 400 then raise exception 'That date is too far back' using errcode = '22023'; end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not (public.apex_is_admin()
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id) and public.apex_can_read_agent(v_canon))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fn_team_population() p where p.agent_id = v_canon) then
    raise exception 'That person is not an active agent on the team' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':att:' || p_date::text, 9));
  return public.fn_workday_apply(v_canon, p_date, p_status, p_expected, p_note, v_uid);
end $$;

-- Several people at once. Never silent and never overwriting: only people who are still unmarked for that day change, the rest
-- are counted as skipped, and anyone the caller may not edit is counted as denied. The screen shows the preview before this runs.
create or replace function public.set_workday_attendance_bulk(p_date date, p_agent_ids uuid[], p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.fn_phoenix_today();
  v_id uuid;
  v_canon uuid;
  v_applied int := 0; v_skipped int := 0; v_denied int := 0;
  v_r jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('present', 'absent', 'excused') then raise exception 'bulk marks are Present, Absent or Excused' using errcode = '22023'; end if;
  if p_date is null or p_date > v_today or p_date < v_today - 400 then raise exception 'Attendance can be taken for today or an earlier day' using errcode = '22023'; end if;
  if p_agent_ids is null or cardinality(p_agent_ids) = 0 then raise exception 'choose the people first' using errcode = '22023'; end if;
  if cardinality(p_agent_ids) > 200 then raise exception 'at most 200 people at once' using errcode = '22023'; end if;
  foreach v_id in array (select array_agg(distinct x) from unnest(p_agent_ids) x) loop
    v_canon := coalesce(public.fn_canonical_agent_id(v_id), v_id);
    if not (public.apex_is_admin() or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(v_id) and public.apex_can_read_agent(v_canon)))
       or not exists (select 1 from public.fn_team_population() p where p.agent_id = v_canon) then
      v_denied := v_denied + 1; continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':att:' || p_date::text, 9));
    v_r := public.fn_workday_apply(v_canon, p_date, p_status, 'unmarked', null, v_uid);
    if (v_r->>'ok')::boolean and (v_r->>'changed')::boolean then v_applied := v_applied + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'applied', v_applied, 'skipped_already_marked', v_skipped, 'denied', v_denied);
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────────────────────────────────────

revoke all on function public.fn_phoenix_today() from public, anon;
revoke all on function public.fn_team_population() from public, anon, authenticated;
revoke all on function public.fn_append_only_guard() from public, anon, authenticated;
revoke all on function public.fn_stage_label(text) from public, anon;
revoke all on function public.fn_weekdays_valid(smallint[]) from public, anon;
grant execute on function public.fn_weekdays_valid(smallint[]) to authenticated, service_role;
revoke all on function public.fn_agents_default_stage() from public, anon, authenticated;
revoke all on function public.fn_work_weekdays_on(uuid, date) from public, anon, authenticated;
revoke all on function public.fn_team_reader() from public, anon, authenticated;
revoke all on function public.fn_workday_apply(uuid, date, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.set_agent_stage(uuid, text, text, boolean) from public, anon;
revoke all on function public.set_work_commitment(uuid, smallint[], date, smallint[], boolean) from public, anon;
revoke all on function public.team_people_facts() from public, anon;
revoke all on function public.team_attendance_day(date) from public, anon;
revoke all on function public.set_workday_attendance(uuid, date, text, text, text) from public, anon;
revoke all on function public.set_workday_attendance_bulk(date, uuid[], text) from public, anon;
grant execute on function public.fn_phoenix_today() to authenticated, service_role;
grant execute on function public.fn_stage_label(text) to authenticated, service_role;
grant execute on function public.set_agent_stage(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.set_work_commitment(uuid, smallint[], date, smallint[], boolean) to authenticated, service_role;
grant execute on function public.team_people_facts() to authenticated, service_role;
grant execute on function public.team_attendance_day(date) to authenticated, service_role;
grant execute on function public.set_workday_attendance(uuid, date, text, text, text) to authenticated, service_role;
grant execute on function public.set_workday_attendance_bulk(date, uuid[], text) to authenticated, service_role;
grant execute on function public.fn_team_population() to service_role;
grant execute on function public.fn_work_weekdays_on(uuid, date) to service_role;
grant execute on function public.fn_team_reader() to service_role;
grant execute on function public.fn_workday_apply(uuid, date, text, text, text, uuid) to service_role;

commit;
