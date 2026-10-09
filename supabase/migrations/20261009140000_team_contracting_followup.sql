-- My Team contracting follow-up: ONE shared calculation, a readable and scoped checklist, real follow-up fields (2026-10-09)
--
-- Sam: open My Team and see, without hunting through checkboxes, who is overdue on the four manual contracting
-- milestones (first_contract, aflac, ethos, agentlink), why, for how long, who owns the next action, and whom to
-- contact first. Missing data must never become false urgency.
--
-- WHAT WAS BROKEN (measured 2026-10-09, see docs/audits/my-team-contracting/):
--   * `authenticated` has no SELECT grant on agent_contract_checkoffs, so the page's direct read has always failed
--     with 42501, the error was swallowed, and every milestone rendered unchecked after any reload.
--   * toggle_agent_contract_checkoff let ANY manager set or clear ANY agent's checkoff.
--   * unchecking DELETEd the row, destroying who checked it and when.
--   * the acc_read policy is `using (true)`: harmless only because the grant is missing.
--
-- WHAT THIS DOES (additive; no historical row touched; the four keys keep their meaning):
--   1. contract_checkoff_keys / contracting_milestone_policy / contracting_followup_config: the single configuration.
--      Thresholds, the clock basis and the tracking window live HERE and nowhere else. The clock basis defaults to
--      'unset': until Sam confirms what starts the clock, every milestone reports policy_pending and nothing is red.
--   2. agent_contract_checkoff_events: append-only history written in the same transaction as every state change.
--   3. set_contract_checkoff(): the one scoped, idempotent, race-safe write (advisory lock + compare-and-set).
--      toggle_agent_contract_checkoff() stays as a thin wrapper so a stale browser bundle keeps working.
--   4. team_contracting_status(): the one read. It returns ONE jsonb value, so no 1,000-row cap and no id-list cap can
--      truncate it, and it carries an explicit read result so the UI can say "unavailable" instead of guessing.
--   5. contracting_checkins gains follow-up fields (next follow-up date, next step, owner, waiting-on, blocker) plus
--      set_contracting_followup(). The existing call log (last_call_at / outcome / call_count) is reused unchanged.
--   6. fn_contracting_checkin_scope now follows the same downline rule as the roster, so a manager can log a contact
--      for anyone they can see on My Team.
--   7. The earlier hire-flag functions (guessed clock, system evidence, top-ten cap) are dropped: one calculation only.
--
-- State vocabulary per milestone: done | not_applicable | policy_pending | not_tracked | unknown | not_due_yet |
-- due_soon (amber) | overdue (red). Day 0 is the start date; elapsed = whole Phoenix calendar days since it.
-- due_soon begins on amber_day; overdue begins the day AFTER deadline_day, so Aflac/Ethos (amber 3, deadline 3) turn
-- red on day 4 and first contract/AgentLink (amber 4, deadline 4) turn red on day 5.

begin;

-- ── 1. configuration ────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.contract_checkoff_keys (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,38}$'),
  label text not null,
  sort integer not null default 0,
  active boolean not null default true
);
insert into public.contract_checkoff_keys (key, label, sort) values
  ('first_contract', 'First contract', 1),
  ('aflac', 'Aflac', 2),
  ('ethos', 'Ethos', 3),
  ('agentlink', 'AgentLink', 4)
on conflict (key) do nothing;

create table if not exists public.contracting_milestone_policy (
  key text primary key references public.contract_checkoff_keys(key),
  amber_day integer not null check (amber_day >= 0),
  deadline_day integer not null check (deadline_day >= amber_day)
);
insert into public.contracting_milestone_policy (key, amber_day, deadline_day) values
  ('aflac', 3, 3),
  ('ethos', 3, 3),
  ('first_contract', 4, 4),
  ('agentlink', 4, 4)
on conflict (key) do nothing;

create table if not exists public.contracting_followup_config (
  singleton boolean primary key default true check (singleton),
  clock_basis text not null default 'unset'
    check (clock_basis in ('unset', 'hired', 'hired_or_licensed', 'expected_start', 'contracting_request')),
  window_days integer not null default 60 check (window_days between 7 and 365),
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.contracting_followup_config (singleton) values (true) on conflict (singleton) do nothing;

alter table public.contract_checkoff_keys enable row level security;
alter table public.contracting_milestone_policy enable row level security;
alter table public.contracting_followup_config enable row level security;
revoke all on table public.contract_checkoff_keys from anon, authenticated;
revoke all on table public.contracting_milestone_policy from anon, authenticated;
revoke all on table public.contracting_followup_config from anon, authenticated;
grant all on table public.contract_checkoff_keys to service_role;
grant all on table public.contracting_milestone_policy to service_role;
grant all on table public.contracting_followup_config to service_role;

-- ── 2. append-only history; the current-state table keeps "row exists = checked" ───────────────────────────────

create table if not exists public.agent_contract_checkoff_events (
  id bigserial primary key,
  agent_id uuid not null,
  contract_key text not null,
  action text not null check (action in ('checked', 'unchecked')),
  acted_by uuid,
  acted_at timestamptz not null default now(),
  prev_checked_at timestamptz,
  prev_checked_by uuid
);
create index if not exists agent_contract_checkoff_events_agent_idx on public.agent_contract_checkoff_events (agent_id, acted_at desc);
alter table public.agent_contract_checkoff_events enable row level security;
revoke all on table public.agent_contract_checkoff_events from anon, authenticated;
grant all on table public.agent_contract_checkoff_events to service_role;

-- Realtime needs SELECT through RLS. This is a scoped, INSERT-only invalidation signal: it carries ids and a verb,
-- no names or contact data, and a reader sees only agents inside their own downline.
drop policy if exists agent_contract_checkoff_events_scoped_read on public.agent_contract_checkoff_events;
create policy agent_contract_checkoff_events_scoped_read on public.agent_contract_checkoff_events for select
  using (
    public.apex_is_admin()
    or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')
    or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(agent_id))
  );
grant select on table public.agent_contract_checkoff_events to authenticated;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_contract_checkoff_events') then
    alter publication supabase_realtime add table public.agent_contract_checkoff_events;
  end if;
end $$;

-- The old policy was `using (true)` and was inert only because the table grant is missing. Replace it with a scoped one
-- so that "fixing" the grant later can never expose every agent's contracting status to every login.
drop policy if exists acc_read on public.agent_contract_checkoffs;
drop policy if exists acc_scoped_read on public.agent_contract_checkoffs;
create policy acc_scoped_read on public.agent_contract_checkoffs for select
  using (
    public.apex_is_admin()
    or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')
    or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(agent_id))
  );

-- ── 3. follow-up fields: reuse contracting_checkins, add only what is missing ──────────────────────────────────

alter table public.contracting_checkins add column if not exists follow_up_on date;
alter table public.contracting_checkins add column if not exists next_action text;
alter table public.contracting_checkins add column if not exists owner_user_id uuid;
alter table public.contracting_checkins add column if not exists waiting_on text;
alter table public.contracting_checkins add column if not exists blocker text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contracting_checkins_waiting_on_check') then
    alter table public.contracting_checkins add constraint contracting_checkins_waiting_on_check
      check (waiting_on is null or waiting_on in ('agent', 'staff', 'carrier', 'upline'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracting_checkins_blocker_check') then
    alter table public.contracting_checkins add constraint contracting_checkins_blocker_check
      check (blocker is null or blocker in ('none', 'login_access', 'wrong_agency', 'missing_documents', 'missing_comp_upline',
        'release_required', 'existing_carrier_relationship', 'upline_approval', 'carrier_issue'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracting_checkins_next_action_len') then
    alter table public.contracting_checkins add constraint contracting_checkins_next_action_len
      check (next_action is null or char_length(next_action) <= 500);
  end if;
end $$;

-- Managers now follow the roster's downline rule. Before this, a manager could SEE a sub-manager's hire on My Team but
-- was refused when logging a contact for them.
create or replace function public.fn_contracting_checkin_scope()
returns table(agent_id uuid)
language sql stable security definer
set search_path to 'public'
as $$
  select a.id from public.agents a
  where auth.uid() is not null
    and ( public.apex_is_admin()
       or public.has_role(auth.uid(), 'va_manager')
       or public.has_role(auth.uid(), 'va')
       or (public.has_role(auth.uid(), 'manager') and public.apex_can_read_agent(a.id)) );
$$;

-- ── 4. pure milestone evaluator (provable on synthetic cases) ──────────────────────────────────────────────────

create or replace function public.fn_milestone_state(
  p_applicable boolean,
  p_tracked boolean,
  p_policy_active boolean,
  p_start_ok boolean,
  p_elapsed integer,
  p_done boolean,
  p_amber integer,
  p_deadline integer
) returns jsonb
language sql immutable
set search_path = public
as $$
  select case
    when coalesce(p_done, false) then jsonb_build_object('state', 'done')
    when not coalesce(p_applicable, false) then jsonb_build_object('state', 'not_applicable')
    when not coalesce(p_policy_active, false) then jsonb_build_object('state', 'policy_pending')
    when not coalesce(p_tracked, false) then jsonb_build_object('state', 'not_tracked')
    when not coalesce(p_start_ok, false) or p_elapsed is null then jsonb_build_object('state', 'unknown')
    when p_elapsed > p_deadline then jsonb_build_object('state', 'overdue', 'days_late', p_elapsed - p_deadline)
    when p_elapsed >= p_amber then jsonb_build_object('state', 'due_soon', 'days_until_overdue', p_deadline - p_elapsed + 1)
    else jsonb_build_object('state', 'not_due_yet')
  end
$$;

-- ── 5. the one read ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.team_contracting_status()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_cfg public.contracting_followup_config%rowtype;
  v_basis_label text;
  v_active boolean;
  v_people jsonb;
  v_counts jsonb;
  v_policy jsonb;
  v_events bigint;
  v_all boolean;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not (public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va') or public.has_role(v_uid, 'manager')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  select * into v_cfg from public.contracting_followup_config where singleton;
  v_active := v_cfg.clock_basis <> 'unset';
  v_basis_label := case v_cfg.clock_basis
    when 'hired' then 'Day hired (the agent record was created)'
    when 'hired_or_licensed' then 'Day hired, or the day they got licensed if later'
    when 'expected_start' then 'Expected start date set in Recruit Pipeline'
    when 'contracting_request' then 'Day the contracting request was filed'
    else 'Not confirmed yet' end;

  select coalesce(jsonb_object_agg(p.key, jsonb_build_object('label', k.label, 'amber_day', p.amber_day, 'deadline_day', p.deadline_day, 'red_day', p.deadline_day + 1)), '{}'::jsonb)
    into v_policy
  from public.contracting_milestone_policy p join public.contract_checkoff_keys k on k.key = p.key and k.active;

  select count(*) into v_events from public.agent_contract_checkoff_events;

  with recursive vis(id, path) as (
    -- Same rule as apex_can_read_agent / crm_can_read_agent_scope, computed ONCE for the whole set instead of once per
    -- person: from every agent row this login owns, walk down manager_id / invited_by_manager_id with a cycle guard.
    select a.id, array[a.id] from public.agents a where a.user_id = v_uid and not v_all
    union all
    select c.id, vis.path || c.id from vis join public.agents c on c.manager_id = vis.id or c.invited_by_manager_id = vis.id
    where not c.id = any(vis.path)
  ), scope as (
    select distinct id from vis
  ), alias as (
    select t.canonical_agent_id as canon, t.id as alias_id from public.agents t where t.canonical_agent_id is not null
  ), pop as (
    select a.id as agent_id, a.display_name, a.created_at, a.licensed_at, a.license_status::text as license_status,
           a.nipr_number, a.user_id, a.profile_id, a.manager_id, a.invited_by_manager_id,
           coalesce(a.manager_id, a.invited_by_manager_id) as mgr_id
    from public.agents a
    where a.status = 'active'
      and coalesce(a.is_inactive, false) = false
      and coalesce(a.is_deactivated, false) = false
      and a.canonical_agent_id is null
      and not (a.agent_code like 'GHOST\_%' and a.user_id is null)
      and not public.fn_agent_is_roster_excluded(a.id)
      and not exists (select 1 from auth.users u where u.id = a.user_id and u.banned_until > now())
      and not exists (select 1 from public.agent_access_suspensions s where s.user_id = a.user_id and s.lifted_at is null)
      and (v_all or a.id in (select id from scope))
  ), elig as (
    select p.*,
      (select pr.email from public.profiles pr where pr.user_id = p.user_id or pr.id = p.profile_id limit 1) as em,
      (select m.display_name from public.agents m where m.id = p.mgr_id) as manager_name
    from pop p
  ), cls as (
    select e.*,
      case
        when e.license_status is null then 'license_unknown'
        when e.license_status = 'licensed' then 'eligible'
        when (e.licensed_at is not null or nullif(btrim(e.nipr_number), '') is not null
              or exists (select 1 from public.mat_production_unified m where m.agent_id = e.agent_id)
              or exists (select 1 from public.contracting_intakes i where i.agent_id = e.agent_id and i.license_status = 'licensed')
              or exists (select 1 from public.applications ap where lower(btrim(ap.email)) = lower(btrim(e.em)) and ap.license_progress::text = 'licensed'))
          then 'license_conflict'
        else 'not_applicable'
      end as eligibility
    from elig e
  ), st as (
    select c.*,
      case v_cfg.clock_basis
        when 'hired' then (c.created_at at time zone 'America/Phoenix')::date
        when 'hired_or_licensed' then (greatest(c.created_at, c.licensed_at) at time zone 'America/Phoenix')::date
        when 'expected_start' then (select sp.expected_start_on from public.agent_start_plans sp where sp.agent_id = c.agent_id)
        when 'contracting_request' then (select (min(i.created_at) at time zone 'America/Phoenix')::date from public.contracting_intakes i where i.agent_id = c.agent_id)
        else null
      end as start_date
    from cls c
  ), val as (
    select s.*,
      case
        when not v_active then 'policy_pending'
        when s.start_date is null then 'missing'
        when s.start_date > v_today then 'future'
        when s.start_date < date '2020-01-01' then 'invalid'
        else 'ok'
      end as start_validity,
      (v_today - s.start_date) as elapsed
    from st s
  ), ck as (
    -- earliest tick per canonical person and key; a legacy row keyed on a twin id folds onto its canonical
    select distinct on (coalesce(al.canon, c.agent_id), c.contract_key)
           coalesce(al.canon, c.agent_id) as agent_id, c.contract_key, c.checked_at, c.checked_by
    from public.agent_contract_checkoffs c left join alias al on al.alias_id = c.agent_id
    order by coalesce(al.canon, c.agent_id), c.contract_key, c.checked_at
  ), ms as (
    select v.agent_id, k.key, k.label, k.sort, ck.checked_at, ck.checked_by, pol.amber_day, pol.deadline_day
    from val v
    cross join public.contract_checkoff_keys k
    join public.contracting_milestone_policy pol on pol.key = k.key
    left join ck on ck.agent_id = v.agent_id and ck.contract_key = k.key
    where k.active
  ), mj as (
    select m.agent_id, m.key, m.label, m.sort, m.checked_at, m.checked_by, m.amber_day, m.deadline_day,
      public.fn_milestone_state(
        v.eligibility = 'eligible', (v.start_validity = 'ok' and v.elapsed <= v_cfg.window_days) or v.start_validity <> 'ok',
        v_active, v.start_validity = 'ok', v.elapsed::int, m.checked_at is not null, m.amber_day, m.deadline_day) as ev
    from ms m join val v on v.agent_id = m.agent_id
  ), mrows as (
    select mj.agent_id,
      jsonb_agg(jsonb_build_object(
        'key', mj.key, 'label', mj.label, 'state', mj.ev->>'state',
        'done', mj.checked_at is not null, 'checked_at', mj.checked_at,
        'checked_by_name', (select coalesce(nullif(btrim(p.full_name), ''), 'Unnamed account') from public.profiles p where p.user_id = mj.checked_by limit 1),
        'days_late', (mj.ev->>'days_late')::int, 'days_until_overdue', (mj.ev->>'days_until_overdue')::int,
        'amber_day', mj.amber_day, 'deadline_day', mj.deadline_day, 'red_day', mj.deadline_day + 1
      ) order by mj.sort) as milestones,
      bool_or(mj.ev->>'state' = 'overdue') as any_overdue,
      bool_or(mj.ev->>'state' = 'due_soon') as any_due_soon,
      coalesce(max((mj.ev->>'days_late')::int), 0) as max_late,
      min((mj.ev->>'days_until_overdue')::int) filter (where mj.ev->>'state' = 'due_soon') as min_until,
      string_agg(mj.label, ' and ' order by mj.sort) filter (where mj.ev->>'state' = 'overdue') as overdue_labels,
      array_agg(mj.key order by mj.sort) filter (where mj.ev->>'state' = 'overdue') as overdue_keys,
      array_agg(mj.key order by mj.sort) filter (where mj.ev->>'state' = 'due_soon') as due_soon_keys
    from mj group by mj.agent_id
  ), fu as (
    select v.agent_id,
      ci.last_call_at, ci.last_call_outcome, ci.call_count, ci.follow_up_on, ci.next_action, ci.owner_user_id, ci.waiting_on, ci.blocker,
      case when ci.owner_user_id is null then null else coalesce(
        (select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = ci.owner_user_id limit 1),
        (select nullif(btrim(a2.display_name), '') from public.agents a2 where a2.user_id = ci.owner_user_id and a2.canonical_agent_id is null limit 1),
        'Unnamed account') end as owner_name
    from val v left join public.contracting_checkins ci on ci.agent_id = v.agent_id
  ), full_rows as (
    select v.*, mr.milestones, coalesce(mr.any_overdue, false) as p1, coalesce(mr.any_due_soon, false) as due_soon_any,
      coalesce(mr.max_late, 0) as max_late, mr.min_until, mr.overdue_labels, mr.overdue_keys, mr.due_soon_keys,
      f.last_call_at, f.last_call_outcome, f.call_count, f.follow_up_on, f.next_action, f.owner_user_id, f.waiting_on, f.blocker, f.owner_name,
      (f.follow_up_on is null or f.follow_up_on <= v_today) as followup_due_now,
      (v.eligibility = 'eligible' and v_active and v.start_validity in ('missing', 'future', 'invalid')) as needs_review,
      (v.eligibility in ('license_conflict', 'license_unknown')) as license_review
    from val v
    left join mrows mr on mr.agent_id = v.agent_id
    left join fu f on f.agent_id = v.agent_id
    where v.eligibility <> 'not_applicable'
  ), ranked as (
    select r.*,
      case when r.p1 then (row_number() over (partition by r.p1 order by r.followup_due_now desc, r.max_late desc, r.display_name, r.agent_id))::int end as p1_rank
    from full_rows r
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', r.agent_id,
      'alias_ids', coalesce((select jsonb_agg(al.alias_id) from alias al where al.canon = r.agent_id), '[]'::jsonb),
      'display_name', r.display_name,
      'manager_id', r.mgr_id,
      'manager_name', r.manager_name,
      'license_status', r.license_status,
      'eligibility', r.eligibility,
      'needs_review', r.needs_review,
      'license_review', r.license_review,
      'review_reason', case
          when r.eligibility = 'license_conflict' then 'Licence status conflicts with licence records'
          when r.eligibility = 'license_unknown' then 'Licence status is missing'
          when r.needs_review and r.start_validity = 'missing' then 'No start date for the chosen clock rule'
          when r.needs_review and r.start_validity = 'future' then 'Start date is in the future'
          when r.needs_review and r.start_validity = 'invalid' then 'Start date is not valid'
        end,
      'start', jsonb_build_object('date', r.start_date, 'validity', r.start_validity, 'elapsed_days', r.elapsed),
      'milestones', coalesce(r.milestones, '[]'::jsonb),
      'p1', r.p1, 'p1_rank', r.p1_rank,
      'due_soon', r.due_soon_any and not r.p1,
      'max_days_late', r.max_late,
      'overdue_keys', coalesce(to_jsonb(r.overdue_keys), '[]'::jsonb),
      'due_soon_keys', coalesce(to_jsonb(r.due_soon_keys), '[]'::jsonb),
      'overdue_labels', r.overdue_labels,
      'followup', jsonb_build_object(
        'last_at', r.last_call_at, 'last_outcome', r.last_call_outcome, 'call_count', coalesce(r.call_count, 0),
        'next_on', r.follow_up_on, 'next_action', r.next_action, 'waiting_on', r.waiting_on, 'blocker', r.blocker,
        'due_now', r.followup_due_now),
      'owner', jsonb_build_object(
        'user_id', r.owner_user_id,
        'name', coalesce(r.owner_name, r.manager_name, 'Unassigned'),
        'source', case when r.owner_user_id is not null then 'follow_up_owner' when r.mgr_id is not null then 'manager' else 'unassigned' end)
    ) order by (r.p1_rank is null), r.p1_rank, r.due_soon_any desc, r.min_until nulls last, r.display_name, r.agent_id), '[]'::jsonb),
    jsonb_build_object(
      'p1_people', count(*) filter (where r.p1),
      'due_soon_people', count(*) filter (where r.due_soon_any and not r.p1),
      'eligible_people', count(*) filter (where r.eligibility = 'eligible'),
      'timing_review_people', count(*) filter (where r.needs_review),
      'license_review_people', count(*) filter (where r.license_review),
      'followup_due_people', count(*) filter (where r.p1 and r.followup_due_now),
      'total_people', count(*)
    )
  into v_people, v_counts
  from ranked r;

  return jsonb_build_object(
    'ok', true,
    'as_of', v_today,
    'timezone', 'America/Phoenix',
    'basis', jsonb_build_object('key', v_cfg.clock_basis, 'label', v_basis_label, 'confirmed', v_active, 'confirmed_at', v_cfg.confirmed_at, 'window_days', v_cfg.window_days),
    'policy', v_policy,
    'checkoff_events_ever', v_events,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'people', coalesce(v_people, '[]'::jsonb)
  );
end;
$$;

-- ── 6. confirming the clock rule (admin only; this is the "activate" switch) ──────────────────────────────────

create or replace function public.set_contracting_followup_config(p_basis text, p_window_days integer default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_basis not in ('unset', 'hired', 'hired_or_licensed', 'expected_start', 'contracting_request') then
    raise exception 'unknown clock basis %', p_basis using errcode = '22023';
  end if;
  update public.contracting_followup_config
     set clock_basis = p_basis,
         window_days = coalesce(p_window_days, window_days),
         confirmed_by = case when p_basis = 'unset' then null else auth.uid() end,
         confirmed_at = case when p_basis = 'unset' then null else now() end,
         updated_at = now()
   where singleton;
  return jsonb_build_object('ok', true, 'basis', p_basis);
end;
$$;

-- ── 7. the one write for a checkoff ───────────────────────────────────────────────────────────────────────────

create or replace function public.set_contract_checkoff(
  p_agent_id uuid, p_contract_key text, p_checked boolean, p_expected boolean default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_contract_key, ''));
  v_canon uuid;
  v_cur public.agent_contract_checkoffs%rowtype;
  v_was boolean;
  v_changed boolean := false;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_agent_id is null or p_checked is null then raise exception 'agent and state are required' using errcode = '22023'; end if;
  if not exists (select 1 from public.contract_checkoff_keys k where k.key = v_key and k.active) then
    raise exception 'unknown contract key' using errcode = '22023';
  end if;
  select coalesce(a.canonical_agent_id, a.id) into v_canon from public.agents a where a.id = p_agent_id;
  if v_canon is null then raise exception 'unknown agent' using errcode = 'P0002'; end if;
  if not (public.apex_is_admin()
          or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id) and public.apex_can_read_agent(v_canon))) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':' || v_key, 0));
  select * into v_cur from public.agent_contract_checkoffs where agent_id = v_canon and contract_key = v_key;
  v_was := found;

  -- Compare-and-set: the caller says what it believes the state is; if another session changed it, report the truth.
  if p_expected is not null and p_expected is distinct from v_was then
    return jsonb_build_object('ok', false, 'conflict', true, 'checked', v_was, 'checked_at', v_cur.checked_at);
  end if;

  if p_checked and not v_was then
    insert into public.agent_contract_checkoffs (agent_id, contract_key, checked_by) values (v_canon, v_key, v_uid)
      returning * into v_cur;
    insert into public.agent_contract_checkoff_events (agent_id, contract_key, action, acted_by) values (v_canon, v_key, 'checked', v_uid);
    v_changed := true;
  elsif (not p_checked) and v_was then
    insert into public.agent_contract_checkoff_events (agent_id, contract_key, action, acted_by, prev_checked_at, prev_checked_by)
      values (v_canon, v_key, 'unchecked', v_uid, v_cur.checked_at, v_cur.checked_by);
    delete from public.agent_contract_checkoffs where agent_id = v_canon and contract_key = v_key;
    v_changed := true;
  end if;
  -- A repeat check keeps the ORIGINAL who and when. Nothing is overwritten, nothing is double-logged.

  return jsonb_build_object('ok', true, 'checked', p_checked, 'changed', v_changed, 'checked_at', case when p_checked then v_cur.checked_at end);
end;
$$;

-- Old signature, kept so a browser tab still running the previous bundle keeps working. Same gate, same writes.
create or replace function public.toggle_agent_contract_checkoff(p_agent_id uuid, p_contract_key text, p_checked boolean)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare r jsonb;
begin
  r := public.set_contract_checkoff(p_agent_id, p_contract_key, p_checked, null);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'could not save the checkoff'; end if;
end;
$$;

-- ── 8. follow-up plan (reuses the contracting_checkins row and its append-only log) ───────────────────────────

create or replace function public.set_contracting_followup(p_agent_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_id uuid;
  v_canon uuid;
  v_k text;
  v_owner uuid;
  v_date date;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_agent_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'agent and patch are required' using errcode = '22023'; end if;
  for v_k in select jsonb_object_keys(p_patch) loop
    if v_k not in ('follow_up_on', 'next_action', 'owner_user_id', 'waiting_on', 'blocker') then
      raise exception 'unknown field %', v_k using errcode = '22023';
    end if;
  end loop;
  select coalesce(a.canonical_agent_id, a.id) into v_canon from public.agents a where a.id = p_agent_id;
  if v_canon is null then raise exception 'unknown agent' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id in (p_agent_id, v_canon)) then
    raise exception 'Not authorized for this agent' using errcode = '42501';
  end if;

  if p_patch ? 'follow_up_on' and nullif(p_patch->>'follow_up_on', '') is not null then
    v_date := (p_patch->>'follow_up_on')::date;
    if v_date < v_today - 1 or v_date > v_today + 366 then raise exception 'follow-up date out of range' using errcode = '22023'; end if;
  end if;
  if p_patch ? 'owner_user_id' and nullif(p_patch->>'owner_user_id', '') is not null then
    v_owner := (p_patch->>'owner_user_id')::uuid;
    if not exists (select 1 from public.contracting_case_owner_options() o where o.user_id = v_owner) then
      raise exception 'owner is not an eligible staff account' using errcode = '22023';
    end if;
  end if;

  insert into public.contracting_checkins (agent_id) values (v_canon) on conflict (agent_id) do nothing;
  select id into v_id from public.contracting_checkins where agent_id = v_canon;

  update public.contracting_checkins set
    follow_up_on = case when p_patch ? 'follow_up_on' then v_date else follow_up_on end,
    next_action = case when p_patch ? 'next_action' then nullif(btrim(p_patch->>'next_action'), '') else next_action end,
    owner_user_id = case when p_patch ? 'owner_user_id' then v_owner else owner_user_id end,
    waiting_on = case when p_patch ? 'waiting_on' then nullif(p_patch->>'waiting_on', '') else waiting_on end,
    blocker = case when p_patch ? 'blocker' then nullif(p_patch->>'blocker', '') else blocker end,
    last_checkin_at = now(), updated_at = now(), updated_by = v_uid
  where id = v_id;

  insert into public.contracting_checkin_log (checkin_id, step, done, note, changed_by)
  values (v_id, 'plan', true, left(p_patch::text, 900), v_uid);

  return (select jsonb_build_object('follow_up_on', c.follow_up_on, 'next_action', c.next_action, 'owner_user_id', c.owner_user_id,
                                    'waiting_on', c.waiting_on, 'blocker', c.blocker) from public.contracting_checkins c where c.id = v_id);
end;
$$;

-- ── 9. one calculation only: retire the earlier guessed-clock hire flags ───────────────────────────────────────

drop function if exists public.hire_priority_alert(text);
drop function if exists public.hire_priority_list();
drop function if exists public.fn_hire_priority_rows();
drop function if exists public.hire_flag_eval(int, boolean, text, boolean, bigint, int, int, int, int);

-- ── 10. grants ─────────────────────────────────────────────────────────────────────────────────────────────────

revoke all on function public.fn_milestone_state(boolean, boolean, boolean, boolean, integer, boolean, integer, integer) from public, anon;
revoke all on function public.team_contracting_status() from public, anon;
revoke all on function public.set_contracting_followup_config(text, integer) from public, anon;
revoke all on function public.set_contract_checkoff(uuid, text, boolean, boolean) from public, anon;
revoke all on function public.toggle_agent_contract_checkoff(uuid, text, boolean) from public, anon;
revoke all on function public.set_contracting_followup(uuid, jsonb) from public, anon;
grant execute on function public.fn_milestone_state(boolean, boolean, boolean, boolean, integer, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.team_contracting_status() to authenticated, service_role;
grant execute on function public.set_contracting_followup_config(text, integer) to authenticated, service_role;
grant execute on function public.set_contract_checkoff(uuid, text, boolean, boolean) to authenticated, service_role;
grant execute on function public.toggle_agent_contract_checkoff(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.set_contracting_followup(uuid, jsonb) to authenticated, service_role;

commit;
