-- Contracting as a working operations system: one CASE per (agent, carrier).
--
-- WHY THIS EXISTS
--   The contracting surfaces summarise a producer as one row ("contracted",
--   "carrier contracts in flight", a count of active contracts). A producer with
--   Mutual of Omaha active, American Amicable stuck on incomplete_profile and
--   Transamerica rejected reads as "contracted" there, and nobody owns the two
--   carriers that are not. Measured 2026-10-06 against agentlink_roster: 1,466
--   (person, carrier) pairs across 221 AgentLink people — active 428, incomplete
--   profile 396, submitted 316, rejected 97, requested 80, pending upline 76,
--   ready to contract 29, issue 27, jail 17. Statuses arrive from AgentLink (the
--   carrier contracting system) only as a snapshot: there is no status history,
--   no submission date and no change timestamp anywhere upstream.
--
-- AUTHORITATIVE RECORDS (nothing here is a second contracting database)
--   agentlink_roster.carriers      upstream carrier status per person (sync)
--   agents                          identity + lifecycle (live, canonical, non-placeholder)
--   contracting_checkins.left_at    "no longer with us" — departed people drop out
--   contracting_case_tracking       NEW: only what AgentLink cannot know — the
--                                   internal owner, next action, follow-up date,
--                                   waiting-on override, staff-recorded blocker,
--                                   carrier stage learned by phone, a manual
--                                   close, and a manual verification WITH source
--                                   and evidence. Never a copy of the status.
--   contracting_case_events         NEW: append-only before/after history, plus
--                                   AgentLink status changes seen by the sync.
--   agentlink_carrier_status_observations
--                                   NEW: when each (person, carrier) status was
--                                   first seen, so "days in state" is derivable
--                                   going forward instead of invented.
--
-- LIFECYCLE MAP (AgentLink status -> lifecycle, derived blocker, waiting on).
-- src/lib/contractingCases.ts carries the SAME table and
-- src/tests/lib/contractingCases.test.ts parses the block between the markers
-- below and fails if the two ever disagree.
--   active                    -> Verified Ready to Write  (source "AgentLink sync" + synced_at, nothing else)
--   submitted                 -> Submitted                waiting on carrier
--   ready_to_contract         -> Ready to Submit          waiting on staff
--   requested                 -> Not Started              upline approval dependency, waiting on upline
--   pending_upline_assignment -> Setup / Documents        missing comp/upline, waiting on upline
--   incomplete_profile        -> Setup / Documents        missing documents, waiting on agent
--   issue                     -> Additional Requirements  carrier issue, waiting on staff
--   jail                      -> Additional Requirements  carrier issue, waiting on staff
--   rejected                  -> Declined                 terminal
--   anything else             -> Unknown (needs review)   waiting on staff. NEVER approved.
--   Carrier Review / Approved are reachable only while AgentLink says
--   "submitted" and only by a staff-recorded carrier stage. Closed is a staff
--   action with a reason. A manual Verified Ready to Write requires a source and
--   an evidence reference and is refused while AgentLink shows a negative state.
--
-- NOTIFICATIONS: none. contracting_exception_digest() returns the data a staff
-- digest would carry and system_settings.contracting_digest_enabled is created
-- 'false'. No sender reads it.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.contracting_case_tracking (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  carrier_name text not null,
  owner_user_id uuid,
  owner_name text,
  next_action text,
  follow_up_on date,
  waiting_on text,
  blocker_override text,
  note text,
  carrier_stage text,
  carrier_stage_at timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  closed_reason text,
  verified_ready_at timestamptz,
  verified_by uuid,
  verification_source text,
  evidence_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint contracting_case_tracking_agent_carrier_key unique (agent_id, carrier_name),
  constraint contracting_case_tracking_waiting_on_check
    check (waiting_on is null or waiting_on in ('agent','staff','carrier','upline')),
  constraint contracting_case_tracking_blocker_check
    check (blocker_override is null or blocker_override in (
      'none','login_access','wrong_agency','missing_documents','missing_comp_upline',
      'release_required','existing_carrier_relationship','upline_approval','carrier_issue')),
  constraint contracting_case_tracking_carrier_stage_check
    check (carrier_stage is null or carrier_stage in ('carrier_review','approved')),
  -- A verification without its source and evidence is not a verification.
  constraint contracting_case_tracking_verification_check
    check (verified_ready_at is null
           or (nullif(btrim(verification_source),'') is not null and nullif(btrim(evidence_ref),'') is not null)),
  constraint contracting_case_tracking_closed_check
    check (closed_at is null or nullif(btrim(closed_reason),'') is not null)
);

create table if not exists public.contracting_case_events (
  id bigserial primary key,
  agent_id uuid,
  al_user_id bigint,
  carrier_name text not null,
  action text not null,
  before jsonb,
  after jsonb,
  actor uuid,
  source text not null default 'staff',
  created_at timestamptz not null default now(),
  constraint contracting_case_events_action_check
    check (action in ('update','verify','unverify','close','reopen','agentlink_status_changed')),
  constraint contracting_case_events_source_check
    check (source in ('staff','agentlink_sync'))
);
create index if not exists contracting_case_events_case_idx
  on public.contracting_case_events (agent_id, carrier_name, created_at desc);

create table if not exists public.agentlink_carrier_status_observations (
  al_user_id bigint not null,
  carrier_name text not null,
  status text,
  previous_status text,
  observed_since timestamptz not null,
  -- true when the row was seeded from a snapshot: the status was already in
  -- place at observed_since, so the true age is AT LEAST that long.
  observed_since_is_lower_bound boolean not null default false,
  last_seen_at timestamptz not null default now(),
  primary key (al_user_id, carrier_name)
);

alter table public.contracting_case_tracking enable row level security;
alter table public.contracting_case_events enable row level security;
alter table public.agentlink_carrier_status_observations enable row level security;

-- Reads for contracting staff only; every write goes through the gated
-- functions below (no insert/update/delete policies exist).
drop policy if exists contracting_case_tracking_staff_read on public.contracting_case_tracking;
create policy contracting_case_tracking_staff_read on public.contracting_case_tracking for select
  using (public.fn_contracting_is_staff());
drop policy if exists contracting_case_events_staff_read on public.contracting_case_events;
create policy contracting_case_events_staff_read on public.contracting_case_events for select
  using (public.fn_contracting_is_staff());
drop policy if exists agentlink_carrier_status_observations_staff_read on public.agentlink_carrier_status_observations;
create policy agentlink_carrier_status_observations_staff_read on public.agentlink_carrier_status_observations for select
  using (public.fn_contracting_is_staff());

revoke all on public.contracting_case_tracking, public.contracting_case_events,
  public.agentlink_carrier_status_observations from public, anon, authenticated;
grant select on public.contracting_case_tracking, public.contracting_case_events,
  public.agentlink_carrier_status_observations to authenticated;

-- The history is append-only: a correction is a new event, never an edit.
create or replace function public.fn_contracting_case_events_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  raise exception 'contracting_case_events is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists trg_contracting_case_events_append_only on public.contracting_case_events;
create trigger trg_contracting_case_events_append_only
  before update or delete on public.contracting_case_events
  for each row execute function public.fn_contracting_case_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Status observation: the only honest source of "days in state".
--    Fires on the sync's own writes. EXCEPTION-wrapped so a defect here can
--    never roll back the roster sync it is observing.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_observe_agentlink_carrier_statuses()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agent uuid;
  c jsonb;
  v_name text;
  v_status text;
  v_prev public.agentlink_carrier_status_observations%rowtype;
begin
  begin
    if jsonb_typeof(new.carriers) is distinct from 'array' then
      return new;
    end if;
    select a.id into v_agent
      from public.agents a
     where a.al_user_id = new.al_user_id and a.canonical_agent_id is null
     order by a.created_at
     limit 1;
    for c in select value from jsonb_array_elements(new.carriers) loop
      v_name := nullif(btrim(c->>'name'), '');
      v_status := lower(nullif(btrim(c->>'status'), ''));
      continue when v_name is null;
      select * into v_prev from public.agentlink_carrier_status_observations o
       where o.al_user_id = new.al_user_id and o.carrier_name = v_name;
      if not found then
        insert into public.agentlink_carrier_status_observations
          (al_user_id, carrier_name, status, observed_since, observed_since_is_lower_bound, last_seen_at)
        values (new.al_user_id, v_name, v_status, now(), false, now());
      elsif v_prev.status is distinct from v_status then
        update public.agentlink_carrier_status_observations
           set previous_status = v_prev.status, status = v_status, observed_since = now(),
               observed_since_is_lower_bound = false, last_seen_at = now()
         where al_user_id = new.al_user_id and carrier_name = v_name;
        insert into public.contracting_case_events
          (agent_id, al_user_id, carrier_name, action, before, after, actor, source)
        values (v_agent, new.al_user_id, v_name, 'agentlink_status_changed',
                jsonb_build_object('status', v_prev.status), jsonb_build_object('status', v_status),
                null, 'agentlink_sync');
      else
        update public.agentlink_carrier_status_observations
           set last_seen_at = now()
         where al_user_id = new.al_user_id and carrier_name = v_name;
      end if;
    end loop;
  exception when others then
    raise warning 'fn_observe_agentlink_carrier_statuses: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists trg_observe_agentlink_carrier_statuses on public.agentlink_roster;
create trigger trg_observe_agentlink_carrier_statuses
  after insert or update of carriers on public.agentlink_roster
  for each row execute function public.fn_observe_agentlink_carrier_statuses();

-- Seed from today's snapshot. These statuses were already in place, so the
-- observed age is a LOWER BOUND and is labelled as one everywhere it shows.
insert into public.agentlink_carrier_status_observations
  (al_user_id, carrier_name, status, observed_since, observed_since_is_lower_bound, last_seen_at)
select r.al_user_id, btrim(c->>'name'), lower(nullif(btrim(c->>'status'), '')),
       now(), true, now()
from public.agentlink_roster r
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(r.carriers) = 'array' then r.carriers else '[]'::jsonb end) c
where nullif(btrim(c->>'name'), '') is not null
on conflict (al_user_id, carrier_name) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The case view (security_invoker: it runs as the reader; staff reach it
--    through contracting_carrier_cases() below, which decides scope once).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_contracting_carrier_cases
with (security_invoker = true) as
with live as (
  select a.id as agent_id, a.display_name, a.user_id, a.manager_id, a.al_user_id,
         nullif(btrim(a.nipr_number), '') as npn_db, a.license_status::text as license_status,
         lower(nullif(btrim(p.email), '')) as email
  from public.agents a
  left join public.profiles p on p.id = a.profile_id
  where a.canonical_agent_id is null
    and a.status = 'active'
    and not coalesce(a.is_deactivated, false)
    and not coalesce(a.is_inactive, false)
    and not public.fn_agent_is_placeholder(a.id)
    and not exists (select 1 from public.roster_exclusions x where x.agent_id = a.id)
    and not exists (select 1 from public.contracting_checkins ck where ck.agent_id = a.id and ck.left_at is not null)
),
matched as (
  select l.*, r.al_user_id as roster_al_id, r.npn as npn_al, r.approval_status, r.upline_al_id,
         r.carriers, r.synced_at,
         case when r.al_user_id = l.al_user_id then 'agentlink_id'
              when l.email is not null and lower(r.email) = l.email then 'email'
              else 'name' end as match_basis
  from live l
  join lateral (
    select r1.*
    from public.agentlink_roster r1
    where r1.al_user_id = l.al_user_id
       or ( l.al_user_id is null
            -- never borrow a roster person another agent row is already linked to
            and not exists (select 1 from public.agents a2 where a2.al_user_id = r1.al_user_id)
            and ( (l.email is not null and lower(r1.email) = l.email)
                  or lower(btrim(r1.first_name) || ' ' || btrim(r1.last_name))
                     = lower(regexp_replace(btrim(l.display_name), '\s+', ' ', 'g')) ) )
    order by (r1.al_user_id = l.al_user_id) desc nulls last,
             (lower(r1.email) = l.email) desc nulls last,
             r1.active_contracts desc nulls last
    limit 1
  ) r on true
),
cases as (
  select m.*, btrim(c->>'name') as carrier_name,
         lower(nullif(btrim(c->>'status'), '')) as al_status,
         nullif(btrim(c->>'level'), '') as carrier_level
  from matched m
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(m.carriers) = 'array' then m.carriers else '[]'::jsonb end) c
  where nullif(btrim(c->>'name'), '') is not null
),
lifecycle_map (status, lifecycle, blocker, waiting_on) as (
  values
  -- lifecycle-map:start
  ('active', 'verified_ready_to_write', null, null),
  ('submitted', 'submitted', null, 'carrier'),
  ('ready_to_contract', 'ready_to_submit', null, 'staff'),
  ('requested', 'not_started', 'upline_approval', 'upline'),
  ('pending_upline_assignment', 'setup_documents', 'missing_comp_upline', 'upline'),
  ('incomplete_profile', 'setup_documents', 'missing_documents', 'agent'),
  ('issue', 'additional_requirements', 'carrier_issue', 'staff'),
  ('jail', 'additional_requirements', 'carrier_issue', 'staff'),
  ('rejected', 'declined', null, null)
  -- lifecycle-map:end
),
base as (
  select k.*,
         coalesce(mp.lifecycle, 'unknown') as al_lifecycle,
         case when mp.status is null then 'unknown_status' else mp.blocker end as al_blocker,
         case when mp.status is null then 'staff' else mp.waiting_on end as al_waiting_on,
         t.owner_user_id, t.owner_name as t_owner_name, t.next_action, t.follow_up_on,
         t.waiting_on as t_waiting_on, t.blocker_override, t.note, t.carrier_stage, t.carrier_stage_at,
         t.closed_at, t.closed_reason, t.verified_ready_at, t.verified_by, t.verification_source,
         t.evidence_ref, t.updated_at as tracking_updated_at,
         o.status as obs_status, o.observed_since, o.observed_since_is_lower_bound,
         mg.display_name as manager_name,
         nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') as upline_name
  from cases k
  left join lifecycle_map mp on mp.status = k.al_status
  left join public.contracting_case_tracking t
         on t.agent_id = k.agent_id and t.carrier_name = k.carrier_name
  left join public.agentlink_carrier_status_observations o
         on o.al_user_id = k.roster_al_id and o.carrier_name = k.carrier_name
  left join public.agents mg on mg.id = k.manager_id
  left join public.agentlink_roster u on u.al_user_id = k.upline_al_id
),
decided as (
  select b.*,
         case
           when b.al_status = 'active' then 'verified_ready_to_write'
           when b.closed_at is not null then 'closed'
           when b.verified_ready_at is not null
                and b.al_lifecycle not in ('declined', 'additional_requirements') then 'verified_ready_to_write'
           when b.al_lifecycle = 'submitted' and b.carrier_stage = 'approved' then 'approved'
           when b.al_lifecycle = 'submitted' and b.carrier_stage = 'carrier_review' then 'carrier_review'
           else b.al_lifecycle
         end as lifecycle
  from base b
),
shaped as (
  select d.*,
         d.lifecycle in ('verified_ready_to_write', 'declined', 'closed') as is_terminal,
         case
           when d.lifecycle in ('verified_ready_to_write', 'declined', 'closed') then null
           when d.blocker_override = 'none' then null
           when d.blocker_override is not null then d.blocker_override
           when d.al_blocker = 'unknown_status' then null
           else d.al_blocker
         end as blocker,
         case
           when d.lifecycle in ('verified_ready_to_write', 'declined', 'closed') then null
           when d.blocker_override is not null then 'staff'
           when d.al_blocker is not null and d.al_blocker <> 'unknown_status' then 'agentlink'
           else null
         end as blocker_source,
         case
           when d.lifecycle in ('verified_ready_to_write', 'declined', 'closed') then null
           when d.t_waiting_on is not null then d.t_waiting_on
           when d.lifecycle = 'approved' then 'staff'
           else d.al_waiting_on
         end as waiting_on,
         case
           when d.lifecycle = 'closed' then d.closed_at
           when d.lifecycle = 'verified_ready_to_write' and d.al_status is distinct from 'active' then d.verified_ready_at
           when d.lifecycle in ('carrier_review', 'approved') then d.carrier_stage_at
           when d.obs_status is not distinct from d.al_status then d.observed_since
           else null
         end as state_since,
         case
           when d.lifecycle = 'closed' then false
           when d.lifecycle = 'verified_ready_to_write' and d.al_status is distinct from 'active' then false
           when d.lifecycle in ('carrier_review', 'approved') then false
           when d.obs_status is not distinct from d.al_status then d.observed_since_is_lower_bound
           else null
         end as state_since_is_lower_bound
  from decided d
)
select
  s.agent_id,
  s.display_name as agent_name,
  s.user_id as agent_user_id,
  s.manager_id,
  s.manager_name,
  s.license_status,
  coalesce(s.npn_db, s.npn_al) as npn,
  s.roster_al_id as al_user_id,
  s.match_basis,
  s.approval_status as agency_approval,
  s.upline_al_id,
  s.upline_name,
  s.carrier_name,
  s.carrier_level,
  s.al_status,
  s.synced_at as al_synced_at,
  s.al_lifecycle,
  s.lifecycle,
  s.blocker,
  s.blocker_source,
  s.waiting_on,
  s.t_waiting_on as waiting_on_override,
  s.blocker_override,
  s.owner_user_id,
  coalesce(s.t_owner_name, s.manager_name) as owner_name,
  case when s.t_owner_name is not null or s.owner_user_id is not null then 'assigned'
       when s.manager_name is not null then 'manager'
       else 'unassigned' end as owner_source,
  s.next_action,
  s.follow_up_on,
  s.note,
  s.carrier_stage,
  s.carrier_stage_at,
  s.closed_at,
  s.closed_reason,
  case when s.lifecycle <> 'verified_ready_to_write' then null
       when s.al_status = 'active' then s.synced_at
       else s.verified_ready_at end as verified_at,
  case when s.lifecycle <> 'verified_ready_to_write' then null
       when s.al_status = 'active' then 'AgentLink sync'
       else s.verification_source end as verification_source,
  case when s.lifecycle = 'verified_ready_to_write' and s.al_status is distinct from 'active'
       then s.verified_by end as verified_by,
  case when s.lifecycle = 'verified_ready_to_write' and s.al_status is distinct from 'active'
       then s.evidence_ref end as evidence_ref,
  (s.verified_ready_at is not null and s.al_lifecycle in ('declined', 'additional_requirements'))
    as manual_verification_conflict,
  s.state_since,
  s.state_since_is_lower_bound,
  case when s.state_since is null then null
       else floor(extract(epoch from (now() - s.state_since)) / 86400)::int end as days_in_state,
  array_remove(array[
    case when s.match_basis <> 'agentlink_id' then 'identity' end,
    case when coalesce(s.npn_db, s.npn_al) is null then 'npn' end,
    case when s.npn_db is not null and s.npn_al is not null
              and regexp_replace(s.npn_db, '\D', '', 'g') <> regexp_replace(s.npn_al, '\D', '', 'g')
         then 'npn_mismatch' end,
    case when s.approval_status is distinct from 'approved' then 'agency' end,
    case when s.upline_al_id is null then 'hierarchy' end,
    case when s.carrier_level is null then 'comp' end
  ], null) as presubmit_missing,
  s.tracking_updated_at,
  (not s.is_terminal and s.waiting_on = 'agent') as q_agent_action,
  (not s.is_terminal and s.waiting_on in ('staff', 'upline')) as q_staff_action,
  (not s.is_terminal and (s.lifecycle = 'unknown'
     or s.blocker in ('login_access', 'wrong_agency', 'release_required',
                      'existing_carrier_relationship', 'carrier_issue'))) as q_support,
  (s.lifecycle in ('submitted', 'carrier_review')) as q_carrier_review,
  (not s.is_terminal and s.follow_up_on is not null
     and s.follow_up_on <= (now() at time zone 'America/Phoenix')::date) as q_follow_up_due,
  (s.lifecycle = 'ready_to_submit') as q_ready_to_submit,
  (s.lifecycle = 'verified_ready_to_write') as q_verified
from shaped s;

revoke all on public.v_contracting_carrier_cases from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Read: staff/manager scope, or a single agent the caller may read
--    (their own profile included).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contracting_carrier_cases(p_agent_id uuid default null)
returns setof public.v_contracting_carrier_cases
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_agent_id is null then
    return query
      select v.* from public.v_contracting_carrier_cases v
      where v.agent_id in (select s.agent_id from public.fn_contracting_checkin_scope() s)
      order by v.agent_name, v.agent_id, v.carrier_name;
  else
    if not (exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id)
            or public.apex_can_read_agent(p_agent_id)) then
      raise exception 'not allowed to view this agent' using errcode = '42501';
    end if;
    return query
      select v.* from public.v_contracting_carrier_cases v
      where v.agent_id = p_agent_id
      order by v.carrier_name;
  end if;
end;
$$;

-- People the caller may assign as a case owner: internal staff accounts.
create or replace function public.contracting_case_owner_options()
returns table(user_id uuid, name text, roles text[])
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.fn_contracting_is_staff() or public.has_role(auth.uid(), 'manager')) then
    raise exception 'contracting staff only' using errcode = '42501';
  end if;
  return query
    select ur.user_id,
           coalesce(
             (select nullif(btrim(p.full_name), '') from public.profiles p
               where p.user_id = ur.user_id order by p.updated_at desc nulls last limit 1),
             (select nullif(btrim(a.display_name), '') from public.agents a
               where a.user_id = ur.user_id and a.canonical_agent_id is null order by a.created_at limit 1),
             'Unnamed account') as name,
           array_agg(distinct ur.role::text order by ur.role::text) as roles
    from public.user_roles ur
    where ur.role::text in ('admin', 'va_manager', 'va', 'manager')
    group by ur.user_id
    order by 2;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Write: one gated function, every change logged before/after.
--    Managers (for their own people) may set owner / next action / follow-up /
--    waiting-on / blocker / note. Verification, carrier stage and closing are
--    contracting-staff calls (admin, va_manager, va).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contracting_update_case(
  p_agent_id uuid, p_carrier text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean := public.fn_contracting_is_staff();
  v_carrier text := btrim(coalesce(p_carrier, ''));
  v_case public.v_contracting_carrier_cases%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_row public.contracting_case_tracking%rowtype;
  v_key text;
  v_action text := 'update';
  v_txt text;
  v_allowed text[] := array['owner_user_id','owner_name','next_action','follow_up_on','waiting_on',
                            'blocker_override','note','carrier_stage','close','closed_reason','verify','unverify'];
  v_staff_only text[] := array['carrier_stage','close','closed_reason','verify','unverify'];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id) then
    raise exception 'not allowed to update this agent' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'patch must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any (v_allowed) then
      raise exception 'unknown field %', v_key using errcode = '22023';
    end if;
    if v_key = any (v_staff_only) and not v_staff then
      raise exception '% is a contracting-staff action', v_key using errcode = '42501';
    end if;
  end loop;

  select * into v_case from public.v_contracting_carrier_cases v
   where v.agent_id = p_agent_id and v.carrier_name = v_carrier;
  if not found then
    raise exception 'no carrier case % for this agent in AgentLink', v_carrier using errcode = 'P0002';
  end if;

  insert into public.contracting_case_tracking (agent_id, carrier_name, updated_by)
  values (p_agent_id, v_carrier, v_uid)
  on conflict (agent_id, carrier_name) do nothing;
  select * into v_row from public.contracting_case_tracking t
   where t.agent_id = p_agent_id and t.carrier_name = v_carrier for update;
  v_before := to_jsonb(v_row);

  if p_patch ? 'owner_user_id' then
    if jsonb_typeof(p_patch->'owner_user_id') = 'null' then
      v_row.owner_user_id := null;
      v_row.owner_name := null;
    else
      v_row.owner_user_id := (p_patch->>'owner_user_id')::uuid;
      if not exists (select 1 from public.user_roles ur where ur.user_id = v_row.owner_user_id
                       and ur.role::text in ('admin', 'va_manager', 'va', 'manager')) then
        raise exception 'owner must be an internal staff or manager account' using errcode = '22023';
      end if;
      select o.name into v_row.owner_name from public.contracting_case_owner_options() o
       where o.user_id = v_row.owner_user_id;
    end if;
  end if;
  if p_patch ? 'owner_name' and not (p_patch ? 'owner_user_id') then
    v_row.owner_name := nullif(btrim(p_patch->>'owner_name'), '');
  end if;
  if p_patch ? 'next_action' then
    v_row.next_action := left(nullif(btrim(p_patch->>'next_action'), ''), 500);
  end if;
  if p_patch ? 'follow_up_on' then
    v_row.follow_up_on := nullif(p_patch->>'follow_up_on', '')::date;
  end if;
  if p_patch ? 'waiting_on' then
    v_row.waiting_on := nullif(p_patch->>'waiting_on', '');
  end if;
  if p_patch ? 'blocker_override' then
    v_row.blocker_override := nullif(p_patch->>'blocker_override', '');
  end if;
  if p_patch ? 'note' then
    v_row.note := left(nullif(btrim(p_patch->>'note'), ''), 2000);
  end if;
  if p_patch ? 'carrier_stage' then
    v_txt := nullif(p_patch->>'carrier_stage', '');
    if v_txt is not null and v_case.al_status is distinct from 'submitted' then
      raise exception 'a carrier stage can only be recorded while AgentLink shows submitted (it shows %)',
        coalesce(v_case.al_status, 'nothing') using errcode = '22023';
    end if;
    v_row.carrier_stage := v_txt;
    v_row.carrier_stage_at := case when v_txt is null then null
                                   when v_txt is distinct from (v_before->>'carrier_stage') then now()
                                   else v_row.carrier_stage_at end;
  end if;
  if p_patch ? 'close' then
    if (p_patch->>'close')::boolean then
      v_txt := nullif(btrim(coalesce(p_patch->>'closed_reason', '')), '');
      if v_txt is null then
        raise exception 'closing a case needs a reason' using errcode = '22023';
      end if;
      if v_case.al_status = 'active' then
        raise exception 'AgentLink shows this contract active; it cannot be closed here' using errcode = '22023';
      end if;
      v_row.closed_at := coalesce(v_row.closed_at, now());
      v_row.closed_by := v_uid;
      v_row.closed_reason := v_txt;
      v_action := 'close';
    else
      v_row.closed_at := null;
      v_row.closed_by := null;
      v_row.closed_reason := null;
      v_action := 'reopen';
    end if;
  end if;
  if p_patch ? 'verify' then
    if jsonb_typeof(p_patch->'verify') <> 'object' then
      raise exception 'verify must be an object with source and evidence_ref' using errcode = '22023';
    end if;
    if v_case.al_status = 'active' then
      raise exception 'already verified by the AgentLink sync' using errcode = '22023';
    end if;
    if v_case.al_lifecycle in ('declined', 'additional_requirements') then
      raise exception 'AgentLink shows % for this carrier; resolve that before recording a verification',
        v_case.al_status using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_patch->'verify'->>'source', '')), '') is null
       or nullif(btrim(coalesce(p_patch->'verify'->>'evidence_ref', '')), '') is null then
      raise exception 'a verification needs both a source and an evidence reference' using errcode = '22023';
    end if;
    v_row.verified_ready_at := now();
    v_row.verified_by := v_uid;
    v_row.verification_source := left(btrim(p_patch->'verify'->>'source'), 200);
    v_row.evidence_ref := left(btrim(p_patch->'verify'->>'evidence_ref'), 1000);
    v_action := 'verify';
  end if;
  if coalesce((p_patch->>'unverify')::boolean, false) then
    v_row.verified_ready_at := null;
    v_row.verified_by := null;
    v_row.verification_source := null;
    v_row.evidence_ref := null;
    v_action := 'unverify';
  end if;

  update public.contracting_case_tracking t set
    owner_user_id = v_row.owner_user_id, owner_name = v_row.owner_name,
    next_action = v_row.next_action, follow_up_on = v_row.follow_up_on,
    waiting_on = v_row.waiting_on, blocker_override = v_row.blocker_override, note = v_row.note,
    carrier_stage = v_row.carrier_stage, carrier_stage_at = v_row.carrier_stage_at,
    closed_at = v_row.closed_at, closed_by = v_row.closed_by, closed_reason = v_row.closed_reason,
    verified_ready_at = v_row.verified_ready_at, verified_by = v_row.verified_by,
    verification_source = v_row.verification_source, evidence_ref = v_row.evidence_ref,
    updated_at = now(), updated_by = v_uid
  where t.id = v_row.id
  returning to_jsonb(t.*) into v_after;

  insert into public.contracting_case_events
    (agent_id, al_user_id, carrier_name, action, before, after, actor, source)
  values (p_agent_id, v_case.al_user_id, v_carrier, v_action, v_before, v_after, v_uid, 'staff');

  return v_after;
end;
$$;

-- Case history for the update dialog: same scope as the writer.
create or replace function public.contracting_case_history(p_agent_id uuid, p_carrier text)
returns table(id bigint, action text, source text, created_at timestamptz, before jsonb, after jsonb, actor_name text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id) then
    raise exception 'not allowed to view this agent' using errcode = '42501';
  end if;
  return query
    select e.id, e.action, e.source, e.created_at, e.before, e.after,
           case when e.actor is null then null else coalesce(
             (select nullif(btrim(p.full_name), '') from public.profiles p
               where p.user_id = e.actor order by p.updated_at desc nulls last limit 1),
             (select nullif(btrim(a.display_name), '') from public.agents a
               where a.user_id = e.actor and a.canonical_agent_id is null order by a.created_at limit 1)) end
    from public.contracting_case_events e
    where e.agent_id = p_agent_id and e.carrier_name = btrim(coalesce(p_carrier, ''))
    order by e.created_at desc, e.id desc
    limit 50;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Exception digest: the data a staff summary would carry. Counts are CARRIER
--    CASES; people is the distinct agent count beside each. Queues overlap.
--    No sender is wired: system_settings.contracting_digest_enabled stays
--    'false' until someone builds and proves a delivery path.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contracting_exception_digest()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb;
begin
  if not public.fn_contracting_is_staff() then
    raise exception 'contracting staff only' using errcode = '42501';
  end if;
  with c as (select * from public.v_contracting_carrier_cases),
  q (key, label, ord) as (
    values ('agent_action', 'Agent Action', 1), ('staff_action', 'Staff Action', 2),
           ('support', 'Support', 3), ('carrier_review', 'Carrier Review', 4),
           ('follow_up_due', 'Follow-Up Due', 5), ('ready_to_submit', 'Ready to Submit', 6),
           ('verified', 'Verified Ready to Write', 7)
  ),
  member as (
    select q.key, c.*
    from q join c on case q.key
      when 'agent_action' then c.q_agent_action
      when 'staff_action' then c.q_staff_action
      when 'support' then c.q_support
      when 'carrier_review' then c.q_carrier_review
      when 'follow_up_due' then c.q_follow_up_due
      when 'ready_to_submit' then c.q_ready_to_submit
      when 'verified' then c.q_verified
    end
  )
  select jsonb_build_object(
    'generated_at', now(),
    'enabled', coalesce((select s.value from public.system_settings s where s.key = 'contracting_digest_enabled'), 'false'),
    'unit', 'carrier_cases',
    'note', 'Counts are carrier cases (one agent x one carrier). Queues overlap and are not additive.',
    'totals', jsonb_build_object(
      'cases', (select count(*) from c),
      'people', (select count(distinct agent_id) from c),
      'unknown_status_cases', (select count(*) from c where lifecycle = 'unknown'),
      'last_synced_at', (select max(al_synced_at) from c)),
    'queues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', q.key, 'label', q.label,
        'cases', (select count(*) from member m where m.key = q.key),
        'people', (select count(distinct m.agent_id) from member m where m.key = q.key),
        'oldest', coalesce((
          select jsonb_agg(x.j) from (
            select jsonb_build_object(
              'agent_id', m.agent_id, 'agent_name', m.agent_name, 'carrier', m.carrier_name,
              'lifecycle', m.lifecycle, 'blocker', m.blocker, 'waiting_on', m.waiting_on,
              'owner', m.owner_name, 'days_in_state', m.days_in_state,
              'days_in_state_is_lower_bound', m.state_since_is_lower_bound,
              'follow_up_on', m.follow_up_on, 'next_action', m.next_action) as j
            from member m where m.key = q.key
            order by m.follow_up_on asc nulls last, m.days_in_state desc nulls last, m.agent_name
            limit 5) x), '[]'::jsonb)
      ) order by q.ord) from q), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.contracting_carrier_cases(uuid) from public, anon;
revoke all on function public.contracting_case_owner_options() from public, anon;
revoke all on function public.contracting_update_case(uuid, text, jsonb) from public, anon;
revoke all on function public.contracting_exception_digest() from public, anon;
revoke all on function public.contracting_case_history(uuid, text) from public, anon;
revoke all on function public.fn_observe_agentlink_carrier_statuses() from public, anon, authenticated;
grant execute on function public.contracting_carrier_cases(uuid) to authenticated;
grant execute on function public.contracting_case_owner_options() to authenticated;
grant execute on function public.contracting_update_case(uuid, text, jsonb) to authenticated;
grant execute on function public.contracting_exception_digest() to authenticated;
grant execute on function public.contracting_case_history(uuid, text) to authenticated;

insert into public.system_settings (key, value)
values ('contracting_digest_enabled', 'false')
on conflict (key) do nothing;

commit;
