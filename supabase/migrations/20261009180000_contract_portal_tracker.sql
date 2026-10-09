-- The manual portal tracker: four carrier circles, a placement level and five intake fields per agent (2026-10-09)
--
-- Sam, 2026-10-09: contracting no longer goes through John Way, Discord or spreadsheets. Carrier contracting happens in
-- external portals. The website holds the essential profile fields and a manual checkoff for four carriers, in this
-- order: Combine, AFLAC, GTO, Ethos. This replaces the earlier First Contract / AFLAC / Ethos / AgentLink checklist and
-- its day-three / four / five overdue rules (migration 20261009140000). Those tables stay as history, untouched.
--
-- MEASURED BEFORE DESIGNING (2026-10-09, live schema):
--   * The identifier the intake already stores is `npn` (contracting_intakes.npn) and `agents.nipr_number`. "MPN" is read
--     as the owner's wording for NPN: one identifier, written to the existing column, never a second one.
--   * Placement level: the manually maintained level is AGENT-WIDE (agent_contract_levels, primary key agent_id, written
--     by set_agent_contract_pct with admin and downline rules). agent_carrier_comp is a per-carrier AgentLink import and
--     holds nothing for these four carriers. So the level here is one agent-wide value and is never copied per carrier.
--   * Carrier catalog: it has Aflac, Combined and Ethos. It has no GTO. "Combine" and "GTO" are therefore stored as
--     their own keys with carrier_id left NULL (unresolved); Combined and Guarantee Trust Life are candidates, not
--     assumptions. An unresolved mapping never blocks the tracker.
--   * The only portal address in trusted configuration is Aflac's login page (apex_carrier_contracts.carrier_portal_url).
--     Ethos has only an invite-link prefix, not a portal. So only Aflac shows "Open portal".
--
-- WHAT THIS DOES (additive; idempotent; no existing row is rewritten or deleted):
--   1. contract_review_carriers: the four circles, in order, with an optional catalog mapping and a verified portal link.
--   2. contract_review_config: the review VERSION. Version 1 is this process.
--   3. contract_review_marks: one row per (agent, version, carrier) the owner confirmed by hand. NO ROW MEANS UNMARKED.
--      That is how every active agent starts Unmarked regardless of legacy checkoffs, and why re-running this migration
--      or deploying again can never reset a mark: nothing here creates, updates or deletes a mark row.
--   4. contract_review_events: append-only audit of every mark, clear, level change and intake save, with who and when.
--   5. agent_contract_profile: first name, last name, email, resident state (NPN stays in agents.nipr_number).
--   6. fn_contract_review_population(): the active-agent definition (matches the roster: active, not deactivated or
--      inactive, not a sync-only placeholder, not a merged duplicate, not roster-excluded).
--   7. contract_review_roster(): ONE jsonb read (no 1,000-row cap), scoped by role; explicit ok flag so a failed or
--      truncated read can never look like "everyone is unmarked".
--   8. set_contract_review_mark(), set_review_placement_level(), save_contract_review_profile(), my-profile read/save,
--      contract_review_history(): the writes, each scoped, compare-and-set where a stale screen could clobber.

begin;

-- ── 1. the four circles ────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.contract_review_carriers (
  carrier_key text primary key check (carrier_key ~ '^[a-z]{2,16}$'),
  label text not null check (char_length(label) between 1 and 40),
  position smallint not null unique check (position between 1 and 12),
  carrier_id uuid references public.carriers(id),
  portal_url text check (portal_url is null or portal_url ~ '^https://[^\s]+$'),
  portal_verified boolean not null default false,
  mapping_note text
);

insert into public.contract_review_carriers (carrier_key, label, position, carrier_id, portal_url, portal_verified, mapping_note)
values
  ('combine', 'Combine', 1, null, null, false,
   'Owner wording. The carrier catalog has "Combined"; that is a likely match but is NOT assumed. Set carrier_id once confirmed.'),
  ('aflac', 'AFLAC', 2, (select id from public.carriers where name = 'Aflac' limit 1), 'https://login.aflac.com/', true,
   'Exact catalog name "Aflac". Portal address from apex_carrier_contracts.carrier_portal_url.'),
  ('gto', 'GTO', 3, null, null, false,
   'Owner wording. No catalog entry is named GTO; "Guarantee Trust Life" is a candidate, NOT assumed. Set carrier_id once confirmed.'),
  ('ethos', 'Ethos', 4, (select id from public.carriers where name = 'Ethos' limit 1), null, false,
   'Exact catalog name "Ethos". No portal login address in trusted configuration, so no Open portal link.')
on conflict (carrier_key) do nothing;

-- ── 2. the review version ─────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.contract_review_config (
  singleton boolean primary key default true check (singleton),
  version integer not null default 1 check (version >= 1),
  started_at timestamptz not null default now(),
  started_by uuid
);
insert into public.contract_review_config (singleton, version) values (true, 1) on conflict (singleton) do nothing;

-- ── 3. marks: a row means "confirmed by hand"; no row means Unmarked ───────────────────────────────────────────

create table if not exists public.contract_review_marks (
  agent_id uuid not null references public.agents(id) on delete cascade,
  version integer not null,
  carrier_key text not null references public.contract_review_carriers(carrier_key),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid,
  primary key (agent_id, version, carrier_key)
);

-- ── 4. audit ───────────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.contract_review_events (
  id bigint generated always as identity primary key,
  agent_id uuid not null,
  version integer not null,
  event_type text not null check (event_type in ('marked', 'cleared', 'level_set', 'level_cleared', 'intake_saved')),
  carrier_key text,
  detail jsonb not null default '{}'::jsonb,
  acted_by uuid,
  acted_at timestamptz not null default now()
);
-- History must outlive the person's row: no foreign key, so deleting an agent can never be blocked by (or erase) the audit.
alter table public.contract_review_events drop constraint if exists contract_review_events_agent_id_fkey;
create index if not exists contract_review_events_agent_idx on public.contract_review_events (agent_id, acted_at desc);

create or replace function public.fn_contract_review_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'contract_review_events is append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_contract_review_events_append_only on public.contract_review_events;
create trigger trg_contract_review_events_append_only before update or delete on public.contract_review_events
  for each row execute function public.fn_contract_review_events_append_only();

-- ── 5. the five intake fields ──────────────────────────────────────────────────────────────────────────────────
-- The NPN is NOT here: it stays in agents.nipr_number, so there is exactly one identifier.

create table if not exists public.agent_contract_profile (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  first_name text check (first_name is null or char_length(btrim(first_name)) between 1 and 80),
  last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 80),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  resident_state text check (resident_state is null or resident_state in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
    'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
    'PR','GU','VI','AS','MP')),
  source text not null default 'staff' check (source in ('staff', 'self')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ── access: tables are read and written only through the functions below ───────────────────────────────────────

alter table public.contract_review_carriers enable row level security;
alter table public.contract_review_config enable row level security;
alter table public.contract_review_marks enable row level security;
alter table public.contract_review_events enable row level security;
alter table public.agent_contract_profile enable row level security;
revoke all on table public.contract_review_carriers, public.contract_review_config, public.contract_review_marks,
  public.contract_review_events, public.agent_contract_profile from public, anon, authenticated;
grant all on table public.contract_review_carriers, public.contract_review_config, public.contract_review_marks,
  public.contract_review_events, public.agent_contract_profile to service_role;

-- A tick made in another session reaches this one as an INSERT on the audit table (scoped by row security).
grant select on table public.contract_review_events to authenticated;
drop policy if exists contract_review_events_scoped_read on public.contract_review_events;
create policy contract_review_events_scoped_read on public.contract_review_events for select to authenticated
  using (public.apex_is_admin()
         or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')
         or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(agent_id)));
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contract_review_events') then
    alter publication supabase_realtime add table public.contract_review_events;
  end if;
end $$;

-- ── 6. who is an active agent ──────────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_contract_review_population()
returns table (agent_id uuid)
language sql stable security definer
set search_path = public
as $$
  select a.id
  from public.agents a
  where a.status::text = 'active'
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.is_inactive, false) = false
    and not (a.agent_code like 'GHOST\_%' and a.user_id is null)           -- sync-only placeholder seats are not people
    and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)       -- a merged duplicate is its canonical row's
    and not public.fn_agent_is_roster_excluded(a.id)
$$;

-- ── 7. the one read ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.contract_review_roster()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_all boolean;
  v_version integer;
  v_carriers jsonb;
  v_agents jsonb;
  v_counts jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;

  select c.version into v_version from public.contract_review_config c where c.singleton;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', k.carrier_key, 'label', k.label, 'position', k.position,
           'mapped', k.carrier_id is not null,
           'portal_url', case when k.portal_verified then k.portal_url end) order by k.position), '[]'::jsonb)
    into v_carriers from public.contract_review_carriers k;

  with pop as (
    select a.id from public.agents a
    join public.fn_contract_review_population() p on p.agent_id = a.id
    where v_all or public.apex_can_read_agent(a.id)
  ), r as (
    select
      a.id as agent_id,
      coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as display_name,
      coalesce(pu.email, pp.email) as email,
      coalesce(a.manager_id, a.invited_by_manager_id) as manager_id,
      (select coalesce(m2.display_name, '') from public.agents m2 where m2.id = coalesce(a.manager_id, a.invited_by_manager_id)) as manager_name,
      a.nipr_number as npn,
      cp.first_name, cp.last_name, cp.email as contract_email, cp.resident_state,
      case when length(btrim(coalesce(pu.state, pp.state, ''))) = 2 then upper(btrim(coalesce(pu.state, pp.state))) end as state_hint,
      (select count(*) from public.contract_review_marks m where m.agent_id = a.id and m.version = v_version)::int as marked_count,
      (select jsonb_object_agg(k.carrier_key,
                case when m.agent_id is null then null
                     else jsonb_build_object('at', m.confirmed_at, 'by', m.confirmed_by,
                            'by_name', coalesce((select mb.display_name from public.agents mb where mb.user_id = m.confirmed_by
                                                  order by mb.created_at limit 1), 'a team member')) end
                order by k.position)
         from public.contract_review_carriers k
         left join public.contract_review_marks m on m.agent_id = a.id and m.version = v_version and m.carrier_key = k.carrier_key) as marks,
      case when l.agent_id is null then null
           else jsonb_build_object('pct', l.contract_pct, 'source', l.source, 'effective_from', l.effective_from, 'updated_at', l.updated_at) end as level
    from pop
    join public.agents a on a.id = pop.id
    left join public.profiles pu on pu.user_id = a.user_id
    left join public.profiles pp on pp.id = a.profile_id
    left join public.agent_contract_profile cp on cp.agent_id = a.id
    left join public.agent_contract_levels l on l.agent_id = a.id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', r.agent_id, 'display_name', r.display_name, 'email', r.email,
      'manager_id', r.manager_id, 'manager_name', nullif(r.manager_name, ''),
      'profile', jsonb_build_object(
        'npn', r.npn, 'first_name', r.first_name, 'last_name', r.last_name, 'email', r.contract_email, 'resident_state', r.resident_state,
        'state_hint', r.state_hint,
        'complete', (nullif(btrim(coalesce(r.npn, '')), '') is not null and r.first_name is not null and r.last_name is not null
                     and r.contract_email is not null and r.resident_state is not null)),
      'marks', r.marks, 'marked_count', r.marked_count, 'level', r.level
    ) order by r.display_name, r.agent_id), '[]'::jsonb),
    jsonb_build_object(
      'agents', count(*),
      'needs_review', count(*) filter (where r.marked_count < 4),
      'unmarked_all', count(*) filter (where r.marked_count = 0),
      'partial', count(*) filter (where r.marked_count between 1 and 3),
      'all_four', count(*) filter (where r.marked_count = 4),
      'level_unset', count(*) filter (where r.level is null),
      'intake_incomplete', count(*) filter (where not (nullif(btrim(coalesce(r.npn, '')), '') is not null and r.first_name is not null
                                                       and r.last_name is not null and r.contract_email is not null and r.resident_state is not null)))
  into v_agents, v_counts
  from r;

  return jsonb_build_object('ok', true, 'version', v_version, 'as_of', (now() at time zone 'America/Phoenix')::date,
                            'carriers', v_carriers, 'counts', v_counts, 'agents', v_agents);
end;
$$;

-- ── 8. one carrier mark ────────────────────────────────────────────────────────────────────────────────────────
-- Manual confirmation only. It is not proof from a carrier and never claims to be. Clearing returns to Unmarked.

create or replace function public.set_contract_review_mark(
  p_agent_id uuid, p_carrier_key text, p_confirmed boolean, p_expected boolean default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_carrier_key, ''));
  v_canon uuid;
  v_version integer;
  v_cur public.contract_review_marks%rowtype;
  v_was boolean;
  v_changed boolean := false;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_agent_id is null or p_confirmed is null then raise exception 'agent and state are required' using errcode = '22023'; end if;
  if not exists (select 1 from public.contract_review_carriers k where k.carrier_key = v_key) then
    raise exception 'unknown carrier' using errcode = '22023';
  end if;
  -- A merged duplicate row is its canonical row's person: the mark lands on the canonical row, like every other writer.
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not (public.apex_is_admin()
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id) and public.apex_can_read_agent(v_canon))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fn_contract_review_population() p where p.agent_id = v_canon) then
    raise exception 'That person is not an active agent in the contracting review' using errcode = 'P0002';
  end if;

  select c.version into v_version from public.contract_review_config c where c.singleton;
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':' || v_key, 7));
  select * into v_cur from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;
  v_was := found;

  -- Compare-and-set: the caller says what it believes the state is. If another session changed it, report the truth.
  if p_expected is not null and p_expected is distinct from v_was then
    return jsonb_build_object('ok', false, 'conflict', true, 'confirmed', v_was, 'confirmed_at', v_cur.confirmed_at);
  end if;

  if p_confirmed and not v_was then
    insert into public.contract_review_marks (agent_id, version, carrier_key, confirmed_by) values (v_canon, v_version, v_key, v_uid)
      returning * into v_cur;
    insert into public.contract_review_events (agent_id, version, event_type, carrier_key, acted_by) values (v_canon, v_version, 'marked', v_key, v_uid);
    v_changed := true;
  elsif (not p_confirmed) and v_was then
    delete from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;
    insert into public.contract_review_events (agent_id, version, event_type, carrier_key, detail, acted_by)
      values (v_canon, v_version, 'cleared', v_key, jsonb_build_object('was_confirmed_at', v_cur.confirmed_at, 'was_confirmed_by', v_cur.confirmed_by), v_uid);
    v_changed := true;
  end if;
  -- A repeat confirm keeps the ORIGINAL who and when. Nothing is overwritten and nothing is logged twice.

  return jsonb_build_object('ok', true, 'confirmed', p_confirmed, 'changed', v_changed,
                            'confirmed_at', case when p_confirmed then v_cur.confirmed_at end);
end;
$$;

-- ── 9. the placement level: ONE agent-wide value, through the existing setter ──────────────────────────────────
-- set_agent_contract_pct already enforces admin / downline / own-level rules. This wrapper adds compare-and-set and the
-- audit event, and never writes a level of its own. An agent with no level row reads back as unset, never zero.

create or replace function public.set_review_placement_level(
  p_agent_id uuid, p_pct numeric, p_expected numeric default null, p_expect_unset boolean default false, p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_canon uuid;
  v_version integer;
  v_cur numeric;
  v_has boolean;
  r jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_agent_id is null then raise exception 'agent required' using errcode = '22023'; end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not exists (select 1 from public.fn_contract_review_population() p where p.agent_id = v_canon) then
    raise exception 'That person is not an active agent in the contracting review' using errcode = 'P0002';
  end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;

  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':level', 7));
  select l.contract_pct, true into v_cur, v_has from public.agent_contract_levels l where l.agent_id = v_canon;
  v_has := coalesce(v_has, false);

  if (p_expected is not null and v_has and p_expected is distinct from v_cur)
     or (p_expected is not null and not v_has)
     or (p_expected is null and p_expect_unset and v_has) then
    return jsonb_build_object('ok', false, 'conflict', true, 'pct', v_cur);
  end if;

  if p_pct is null then
    -- Clearing a level (used by Undo of a first set) is admin-only: it removes the value other screens read.
    if not public.apex_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
    delete from public.agent_contract_levels where agent_id = v_canon;
    insert into public.contract_review_events (agent_id, version, event_type, detail, acted_by)
      values (v_canon, v_version, 'level_cleared', jsonb_build_object('from', v_cur), v_uid);
    return jsonb_build_object('ok', true, 'pct', null, 'changed', v_has);
  end if;

  if v_has and v_cur = p_pct then
    return jsonb_build_object('ok', true, 'pct', p_pct, 'changed', false);
  end if;
  r := public.set_agent_contract_pct(v_canon, p_pct, coalesce(p_note, 'contracting review'));
  insert into public.contract_review_events (agent_id, version, event_type, detail, acted_by)
    values (v_canon, v_version, 'level_set', jsonb_build_object('from', v_cur, 'to', p_pct), v_uid);
  return jsonb_build_object('ok', true, 'pct', p_pct, 'changed', true);
end;
$$;

-- ── 10. the five intake fields ─────────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_contract_review_save_profile(
  p_agent_id uuid, p_npn text, p_first text, p_last text, p_email text, p_state text, p_source text, p_require_all boolean
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_canon uuid := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  v_version integer;
  v_npn text := nullif(btrim(coalesce(p_npn, '')), '');
  v_first text := nullif(btrim(coalesce(p_first, '')), '');
  v_last text := nullif(btrim(coalesce(p_last, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_before jsonb;
  v_digits text;
  v_other record;
  v_old_npn text;
begin
  if v_npn is not null and v_npn !~ '^[0-9]{5,10}$' then
    return jsonb_build_object('ok', false, 'field', 'npn', 'error', 'The NPN is 5 to 10 digits.');
  end if;
  if v_first is not null and char_length(v_first) > 80 then return jsonb_build_object('ok', false, 'field', 'first_name', 'error', 'First name is too long.'); end if;
  if v_last is not null and char_length(v_last) > 80 then return jsonb_build_object('ok', false, 'field', 'last_name', 'error', 'Last name is too long.'); end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('ok', false, 'field', 'email', 'error', 'That email address does not look right.');
  end if;
  if v_state is not null and v_state not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
      'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','GU','VI','AS','MP') then
    return jsonb_build_object('ok', false, 'field', 'resident_state', 'error', 'Pick a state from the list.');
  end if;
  if p_require_all and (v_npn is null or v_first is null or v_last is null or v_email is null or v_state is null) then
    return jsonb_build_object('ok', false, 'field', 'all', 'error', 'All five fields are needed: NPN, first name, last name, email and resident state.');
  end if;

  if not exists (select 1 from public.fn_contract_review_population() p where p.agent_id = v_canon) then
    return jsonb_build_object('ok', false, 'field', 'agent', 'error', 'That person is not an active agent.');
  end if;

  -- The NPN identifies a person. Another active agent already holding it is an ambiguity to surface, never a merge.
  if v_npn is not null then
    v_digits := regexp_replace(v_npn, '\D', '', 'g');
    select a.id, coalesce(a.display_name, '(unnamed agent)') as name into v_other
      from public.agents a
     where a.id <> v_canon and coalesce(a.canonical_agent_id, a.id) <> v_canon
       and regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g') = v_digits
     limit 1;
    if found then
      return jsonb_build_object('ok', false, 'conflict', 'npn_in_use', 'field', 'npn',
        'other_agent_id', v_other.id, 'other_name', v_other.name,
        'error', 'That NPN is already on another profile (' || v_other.name || '). Nothing was saved. Staff must resolve it.');
    end if;
  end if;
  -- The same email on two different people is also surfaced, not merged. (Compared case-insensitively.)
  if v_email is not null then
    select cp.agent_id, coalesce(a.display_name, '(unnamed agent)') as name into v_other
      from public.agent_contract_profile cp join public.agents a on a.id = cp.agent_id
     where cp.agent_id <> v_canon and lower(btrim(cp.email)) = lower(v_email) limit 1;
    if found then
      return jsonb_build_object('ok', false, 'conflict', 'email_in_use', 'field', 'email',
        'other_agent_id', v_other.agent_id, 'other_name', v_other.name,
        'error', 'That email is already on another profile (' || v_other.name || '). Nothing was saved.');
    end if;
  end if;

  select c.version into v_version from public.contract_review_config c where c.singleton;
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':profile', 7));
  select jsonb_build_object('npn', a.nipr_number, 'first_name', cp.first_name, 'last_name', cp.last_name, 'email', cp.email, 'resident_state', cp.resident_state)
    into v_before from public.agents a left join public.agent_contract_profile cp on cp.agent_id = a.id where a.id = v_canon;
  select a.nipr_number into v_old_npn from public.agents a where a.id = v_canon;

  insert into public.agent_contract_profile (agent_id, first_name, last_name, email, resident_state, source, updated_by, updated_at)
    values (v_canon, v_first, v_last, v_email, v_state, p_source, v_uid, now())
    on conflict (agent_id) do update
      set first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
          resident_state = excluded.resident_state, source = excluded.source, updated_by = excluded.updated_by, updated_at = now();
  if v_npn is distinct from v_old_npn then
    update public.agents set nipr_number = v_npn,
           nipr_verified = case when v_old_npn is not null and regexp_replace(v_old_npn, '\D', '', 'g') <> coalesce(v_digits, '') then false else nipr_verified end,
           updated_at = now()
     where id = v_canon;
  end if;
  insert into public.contract_review_events (agent_id, version, event_type, detail, acted_by)
    values (v_canon, v_version, 'intake_saved',
            jsonb_build_object('before', v_before, 'after', jsonb_build_object('npn', v_npn, 'first_name', v_first, 'last_name', v_last, 'email', v_email, 'resident_state', v_state), 'source', p_source), v_uid);
  return jsonb_build_object('ok', true, 'agent_id', v_canon);
end;
$$;

create or replace function public.save_contract_review_profile(
  p_agent_id uuid, p_npn text, p_first text, p_last text, p_email text, p_state text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not (public.apex_is_admin()
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id)
              and public.apex_can_read_agent(coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id)))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;
  return public.fn_contract_review_save_profile(p_agent_id, p_npn, p_first, p_last, p_email, p_state, 'staff', false);
end;
$$;

-- The signed-in person's own profile. It resolves the caller to ONE agent profile by the existing immutable link
-- (agents.user_id); if that is ambiguous it refuses instead of picking. It never signs anyone in or creates an account.
create or replace function public.fn_contract_review_my_agent() returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare v_ids uuid[];
begin
  select array_agg(distinct coalesce(a.canonical_agent_id, a.id)) into v_ids
    from public.agents a where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false;
  if v_ids is null or array_length(v_ids, 1) is null then return null; end if;
  if array_length(v_ids, 1) > 1 then raise exception 'ambiguous_profile' using errcode = '22023'; end if;
  return v_ids[1];
end;
$$;

create or replace function public.get_my_contracting_profile() returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_agent uuid; v jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  begin
    v_agent := public.fn_contract_review_my_agent();
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', 'More than one profile is linked to your login. Ask staff to merge them first.');
  end;
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'No agent profile is linked to your login yet.'); end if;
  select jsonb_build_object('ok', true, 'agent_id', a.id,
           'npn', a.nipr_number,
           'first_name', coalesce(cp.first_name, nullif(split_part(coalesce(pu.full_name, pp.full_name, a.display_name, ''), ' ', 1), '')),
           'last_name', coalesce(cp.last_name, nullif(btrim(substr(coalesce(pu.full_name, pp.full_name, a.display_name, ''), length(split_part(coalesce(pu.full_name, pp.full_name, a.display_name, ''), ' ', 1)) + 1)), '')),
           'email', coalesce(cp.email, pu.email, pp.email),
           'resident_state', coalesce(cp.resident_state, case when length(btrim(coalesce(pu.state, pp.state, ''))) = 2 then upper(btrim(coalesce(pu.state, pp.state))) end),
           'saved', cp.agent_id is not null)
    into v from public.agents a
    left join public.agent_contract_profile cp on cp.agent_id = a.id
    left join public.profiles pu on pu.user_id = a.user_id
    left join public.profiles pp on pp.id = a.profile_id
   where a.id = v_agent;
  return v;
end;
$$;

create or replace function public.save_my_contracting_profile(p_npn text, p_first text, p_last text, p_email text, p_state text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_agent uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  begin
    v_agent := public.fn_contract_review_my_agent();
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'field', 'agent', 'error', 'More than one profile is linked to your login. Ask staff to merge them first.');
  end;
  if v_agent is null then return jsonb_build_object('ok', false, 'field', 'agent', 'error', 'No agent profile is linked to your login yet.'); end if;
  return public.fn_contract_review_save_profile(v_agent, p_npn, p_first, p_last, p_email, p_state, 'self', true);
end;
$$;

-- ── 11. history for one person ─────────────────────────────────────────────────────────────────────────────────

create or replace function public.contract_review_history(p_agent_id uuid, p_limit integer default 25)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not (public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va')
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'events', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'carrier_key', e.carrier_key, 'detail', e.detail,
             'acted_at', e.acted_at,
             'acted_by_name', coalesce((select b.display_name from public.agents b where b.user_id = e.acted_by order by b.created_at limit 1), 'a team member'))
             order by e.acted_at desc, e.id desc)
    from (select * from public.contract_review_events x
           where x.agent_id = coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id)
           order by x.acted_at desc, x.id desc limit greatest(1, least(coalesce(p_limit, 25), 100))) e), '[]'::jsonb));
end;
$$;

-- ── grants ─────────────────────────────────────────────────────────────────────────────────────────────────────

revoke all on function public.fn_contract_review_population() from public, anon, authenticated;
revoke all on function public.fn_contract_review_save_profile(uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.fn_contract_review_my_agent() from public, anon, authenticated;
revoke all on function public.contract_review_roster() from public, anon;
revoke all on function public.set_contract_review_mark(uuid, text, boolean, boolean) from public, anon;
revoke all on function public.set_review_placement_level(uuid, numeric, numeric, boolean, text) from public, anon;
revoke all on function public.save_contract_review_profile(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.get_my_contracting_profile() from public, anon;
revoke all on function public.save_my_contracting_profile(text, text, text, text, text) from public, anon;
revoke all on function public.contract_review_history(uuid, integer) from public, anon;
grant execute on function public.contract_review_roster() to authenticated, service_role;
grant execute on function public.set_contract_review_mark(uuid, text, boolean, boolean) to authenticated, service_role;
grant execute on function public.set_review_placement_level(uuid, numeric, numeric, boolean, text) to authenticated, service_role;
grant execute on function public.save_contract_review_profile(uuid, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.get_my_contracting_profile() to authenticated, service_role;
grant execute on function public.save_my_contracting_profile(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.contract_review_history(uuid, integer) to authenticated, service_role;
grant execute on function public.fn_contract_review_population() to service_role;

commit;
