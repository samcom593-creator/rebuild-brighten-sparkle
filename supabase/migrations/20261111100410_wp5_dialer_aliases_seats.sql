-- WP5 (2026-11-10) part 2 of 3: dialer attribution, seats, and the staged activation queues.
--
-- MEASURED LIVE BEFORE WRITING (2026-11-10):
--   * readymode_dialer_calls: 139,813 rows, 74,423 (53%) with agent_id NULL and only agent_raw set, across 31 distinct
--     raw names. The matcher (fn_match_readymode_calls) skips inactive/deactivated agents and requires ONE matching row,
--     so a merged duplicate (Cari Mullen has two rows, one merged into the other) or a departed rep is never attributed.
--     'cari' alone is 5,762 unattributed dials by a 2026-09-04 licensed hire with 0 deals.
--   * Existing attributions are consistent: every attributed raw maps to exactly one agent, except 'alonzo alexander'
--     (45 rows attributed to a DIFFERENT person, Alonzo Johnson, and 2,582 NULL). Those 45 rows are REPORTED, not
--     rewritten; the alias below keeps every future 'alonzo alexander' row unattributed.
--   * agents.has_dialer_login is NOT derived here, on purpose. public.generate_weekly_dialer_invoices() inserts a $100
--     'pending' row into dialer_weekly_payments for every active agent with has_dialer_login=true, and something calls
--     it every week (5 rows per week since 2026-09-28, last 2026-11-09 23:11 UTC). Deriving the column from "a dial in
--     14 days" would start billing agents. That is money and a seat decision (N8), so the derived flag lives in a VIEW
--     (v_agent_dialer_state.dialer_active_derived) and the column stays exactly as it is.
--
-- WHAT THIS DOES:
--   1. readymode_agent_aliases(agent_raw -> agent_id, person_type agent|va|unknown, match_method, note). Seeded from
--      evidence only: existing consistent attributions; a unique canonical full-name or first-name match created before
--      the raw's last call (first names are how this ReadyMode account names users: marcos, edwin, meja, obi, tre);
--      milver = va (has the va_manager role); drake fleet / colby guffey / alonzo alexander = va (named as VAs by the
--      2026-11-10 activation verifier; no agent row exists for any of them; unverified, labelled as such); 'manager' and
--      every ambiguous or unmatched raw = unknown. A name that collides with a sibling raw (cooper vs cooper1) is unknown.
--   2. Backfill agent_id on NULL rows ONLY where the alias is a unique agent. Each backfilled row is stamped
--      agent_alias_backfilled_at, so the backfill is reversible: update ... set agent_id = null where
--      agent_alias_backfilled_at is not null.
--   3. Write-time resolution: a BEFORE INSERT / UPDATE OF agent_raw trigger fills agent_id from the alias (both writers:
--      the readymode-ingest webhook RPC and the readymode-sync pull RPC) and records a never-seen raw as an 'unknown'
--      alias (match_method 'unresolved_auto') so apex-doctor can WARN. It never overwrites an agent_id a writer set.
--   4. agent_dialer_seats + admin RPCs (assign / release). One open seat per agent per provider. Nothing is granted
--      automatically; nothing is billed (the invoice generator reads has_dialer_login, which this never writes).
--   5. v_agent_dialer_state, v_activation_seat_queue (STAGED for Sam: licensed, active, trained or onboarding call held,
--      no open seat, no dial in 7 days, no lead grant), v_activation_dialing_no_close (>= 300 dials in 14 days, 0 deals
--      since hire).
--   6. v_hire_launch_board gains assign_dialer / grant_leads / coach_closing ahead of first_deal, and three appended
--      columns (has_open_seat, has_lead_grant, dials_14d). Existing columns unchanged.

-- ── 0. preimage (once) ──────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.ops_preimage_snapshots') is not null
     and not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp5 preimage: v_hire_launch_board + dialer (part 2)') then
    insert into public.ops_preimage_snapshots (reason, payload)
    select 'wp5 preimage: v_hire_launch_board + dialer (part 2)', jsonb_build_object(
      'v_hire_launch_board', pg_get_viewdef('public.v_hire_launch_board'::regclass),
      'null_agent_rows', (select count(*) from public.readymode_dialer_calls where agent_id is null),
      'has_dialer_login_true', (select jsonb_agg(id) from public.agents where has_dialer_login));
  end if;
end $$;

-- ── 1. aliases ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.readymode_agent_aliases (
  agent_raw text primary key check (agent_raw = lower(btrim(agent_raw)) and agent_raw <> ''),
  agent_id uuid references public.agents(id) on delete set null,
  person_type text not null check (person_type in ('agent', 'va', 'unknown')),
  match_method text not null,
  note text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_by uuid,
  check (person_type = 'agent' or agent_id is null)
);
alter table public.readymode_agent_aliases enable row level security;
revoke all on table public.readymode_agent_aliases from public, anon, authenticated;
grant all on table public.readymode_agent_aliases to service_role;
grant select on table public.readymode_agent_aliases to authenticated;
drop policy if exists readymode_agent_aliases_staff_read on public.readymode_agent_aliases;
create policy readymode_agent_aliases_staff_read on public.readymode_agent_aliases for select to authenticated
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role));

do $$
begin
  if exists (select 1 from public.readymode_agent_aliases) then return; end if;  -- seed once

  with raws as (
    select lower(btrim(agent_raw)) as raw,
           count(*) as n, count(*) filter (where agent_id is null) as n_null,
           min(call_started_at) as first_at, max(call_started_at) as last_at
    from public.readymode_dialer_calls where nullif(btrim(agent_raw), '') is not null group by 1
  ), attributed as (
    select lower(btrim(c.agent_raw)) as raw,
           count(distinct coalesce(case when a.canonical_agent_id <> a.id then a.canonical_agent_id end, a.id)) as n_agents,
           (array_agg(distinct coalesce(case when a.canonical_agent_id <> a.id then a.canonical_agent_id end, a.id)))[1] as agent_id
    from public.readymode_dialer_calls c join public.agents a on a.id = c.agent_id
    where c.agent_id is not null group by 1
  ), base as (
    select r.*, btrim(regexp_replace(regexp_replace(r.raw, '\s*\(deleted\)\s*$', ''), '\s*-\s*old\s*$', '')) as nm
    from raws r
  ), cand as (
    select b.raw, coalesce(case when a.canonical_agent_id <> a.id then a.canonical_agent_id end, a.id) as canon,
           case when lower(btrim(a.display_name)) = b.nm then 'full_name_unique' else 'first_name_unique' end as how,
           a.created_at
    from base b
    join public.agents a on lower(btrim(a.display_name)) = b.nm or split_part(lower(btrim(a.display_name)), ' ', 1) = b.nm
  ), cand_agg as (
    select raw, count(distinct canon) as n_canon, (array_agg(distinct canon))[1] as canon,
           min(how) as how    -- 'first_name_unique' < 'full_name_unique' alphabetically: a full match wins only when every candidate is full
    from cand group by raw
  ), cand_born as (
    -- When the PERSON first existed as an agent: the earliest row of the canonical identity (canonical + merged members).
    select ca.raw, ca.n_canon, ca.canon, ca.how,
           (select min(a.created_at) from public.agents a where a.id = ca.canon or a.canonical_agent_id = ca.canon) as created_at
    from cand_agg ca
  ), sibling as (
    select b.raw from base b
    where exists (select 1 from base b2 where b2.raw <> b.raw and regexp_replace(b2.nm, '[0-9]+$', '') = regexp_replace(b.nm, '[0-9]+$', ''))
  )
  insert into public.readymode_agent_aliases (agent_raw, agent_id, person_type, match_method, note, first_seen_at, last_seen_at)
  select b.raw,
    case
      when b.raw in ('milver', 'drake fleet', 'colby guffey', 'alonzo alexander', 'manager') then null
      when at.raw is not null and b.n_null = 0 and at.n_agents = 1 then at.agent_id
      when at.raw is null and ca.n_canon = 1 and b.raw not in (select raw from sibling) and ca.created_at::date <= b.last_at::date then ca.canon
    end,
    case
      when b.raw in ('milver', 'drake fleet', 'colby guffey', 'alonzo alexander') then 'va'
      when b.raw = 'manager' then 'unknown'
      when at.raw is not null and b.n_null = 0 and at.n_agents = 1 then 'agent'
      when at.raw is null and ca.n_canon = 1 and b.raw not in (select raw from sibling) and ca.created_at::date <= b.last_at::date then 'agent'
      else 'unknown'
    end,
    case
      when b.raw = 'milver' then 'va_role'
      when b.raw in ('drake fleet', 'colby guffey', 'alonzo alexander') then 'audit_named_va'
      when b.raw = 'manager' then 'generic_seat_name'
      when at.raw is not null and b.n_null = 0 and at.n_agents = 1 then 'existing_attribution'
      when at.raw is null and ca.n_canon = 1 and b.raw not in (select raw from sibling) and ca.created_at::date <= b.last_at::date then ca.how
      when at.raw is not null then 'conflicting_attribution'
      when ca.n_canon > 1 then 'ambiguous_name'
      when b.raw in (select raw from sibling) then 'sibling_raw_collision'
      else 'no_agent_match'
    end,
    case
      when b.raw = 'milver' then 'Has the va_manager role. Dials are VA work, never an agent''s.'
      when b.raw in ('drake fleet', 'colby guffey', 'alonzo alexander') then 'Named as a VA by the 2026-11-10 activation verifier; no agent row exists; unverified.'
        || case when b.raw = 'alonzo alexander' then ' 45 historical rows are attributed to Alonzo Johnson (a different person) and were left as found.' else '' end
      when b.raw = 'manager' then 'A shared seat name, not a person.'
      else null
    end,
    b.first_at, b.last_at
  from base b
  left join attributed at on at.raw = b.raw
  left join cand_born ca on ca.raw = b.raw;
end $$;

-- ── 2. backfill (reversible) ────────────────────────────────────────────────────────────────────────────────────
alter table public.readymode_dialer_calls add column if not exists agent_alias_backfilled_at timestamptz;

update public.readymode_dialer_calls c
   set agent_id = al.agent_id, agent_alias_backfilled_at = now()
  from public.readymode_agent_aliases al
 where c.agent_id is null
   and al.agent_raw = lower(btrim(c.agent_raw))
   and al.person_type = 'agent' and al.agent_id is not null;

-- ── 3. write-time resolution ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_rmd_resolve_agent_alias()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_raw text := lower(btrim(coalesce(new.agent_raw, ''))); v_alias public.readymode_agent_aliases%rowtype;
begin
  if v_raw = '' then return new; end if;
  select * into v_alias from public.readymode_agent_aliases where agent_raw = v_raw;
  if found then
    if new.agent_id is null and v_alias.person_type = 'agent' and v_alias.agent_id is not null then
      new.agent_id := v_alias.agent_id;
    end if;
  else
    insert into public.readymode_agent_aliases (agent_raw, person_type, match_method, note, first_seen_at, last_seen_at)
    values (v_raw, 'unknown', 'unresolved_auto', 'First seen by the ingest; a human needs to say who this is.',
            coalesce(new.call_started_at, now()), coalesce(new.call_started_at, now()))
    on conflict (agent_raw) do nothing;
  end if;
  return new;
exception when others then
  raise warning 'fn_rmd_resolve_agent_alias soft-failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_rmd_resolve_agent_alias on public.readymode_dialer_calls;
create trigger trg_rmd_resolve_agent_alias
  before insert or update of agent_raw on public.readymode_dialer_calls
  for each row execute function public.fn_rmd_resolve_agent_alias();

-- ── 4. seats ────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_dialer_seats (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  seat_label text check (seat_label is null or char_length(btrim(seat_label)) between 1 and 80),
  provider text not null default 'readymode' check (provider ~ '^[a-z_]{2,32}$'),
  assigned_at timestamptz not null default now(),
  assigned_by uuid,
  released_at timestamptz,
  released_by uuid,
  note text check (note is null or char_length(note) <= 500)
);
create unique index if not exists agent_dialer_seats_one_open on public.agent_dialer_seats (agent_id, provider) where released_at is null;
alter table public.agent_dialer_seats enable row level security;
revoke all on table public.agent_dialer_seats from public, anon, authenticated;
grant all on table public.agent_dialer_seats to service_role;
grant select on table public.agent_dialer_seats to authenticated;
drop policy if exists agent_dialer_seats_staff_read on public.agent_dialer_seats;
create policy agent_dialer_seats_staff_read on public.agent_dialer_seats for select to authenticated
  using (public.apex_is_admin() or (public.has_role(auth.uid(), 'manager'::app_role) and public.apex_can_read_agent(agent_id)));

create or replace function public.admin_assign_dialer_seat(p_agent_id uuid, p_seat_label text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_canon uuid; v_id uuid;
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Only an admin can assign a dialer seat' using errcode = '42501';
  end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not exists (select 1 from public.agents where id = v_canon) then raise exception 'No agent %', p_agent_id using errcode = '22023'; end if;
  select id into v_id from public.agent_dialer_seats where agent_id = v_canon and provider = 'readymode' and released_at is null;
  if v_id is null then
    insert into public.agent_dialer_seats (agent_id, seat_label, assigned_by, note)
    values (v_canon, nullif(btrim(coalesce(p_seat_label, '')), ''), auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'seat_id', v_id, 'created', true);
  end if;
  return jsonb_build_object('ok', true, 'seat_id', v_id, 'created', false);
end;
$$;

create or replace function public.admin_release_dialer_seat(p_seat_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Only an admin can release a dialer seat' using errcode = '42501';
  end if;
  update public.agent_dialer_seats set released_at = now(), released_by = auth.uid() where id = p_seat_id and released_at is null;
  return jsonb_build_object('ok', true, 'released', found);
end;
$$;
revoke all on function public.admin_assign_dialer_seat(uuid, text, text) from public, anon;
revoke all on function public.admin_release_dialer_seat(uuid) from public, anon;
grant execute on function public.admin_assign_dialer_seat(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_release_dialer_seat(uuid) to authenticated, service_role;

-- ── 5. derived dialer state + staged queues ─────────────────────────────────────────────────────────────────────
create or replace view public.v_agent_dialer_state with (security_barrier = true) as
with ids as (
  select a.id as member_id, coalesce(case when a.canonical_agent_id <> a.id then a.canonical_agent_id end, a.id) as agent_id from public.agents a
), dials as (
  select i.agent_id, min(c.call_started_at) as first_dial_at, max(c.call_started_at) as last_dial_at,
         count(*) as dials_total,
         count(*) filter (where c.call_started_at >= now() - interval '7 days') as dials_7d,
         count(*) filter (where c.call_started_at >= now() - interval '14 days') as dials_14d
  from public.readymode_dialer_calls c join ids i on i.member_id = c.agent_id
  group by i.agent_id
), seats as (
  select s.agent_id, max(s.seat_label) as seat_label, max(s.assigned_at) as seat_assigned_at
  from public.agent_dialer_seats s where s.released_at is null group by s.agent_id
)
select a.id as agent_id,
       (s.agent_id is not null) as has_open_seat, s.seat_label, s.seat_assigned_at,
       d.first_dial_at, d.last_dial_at,
       coalesce(d.dials_total, 0)::int as dials_total, coalesce(d.dials_7d, 0)::int as dials_7d, coalesce(d.dials_14d, 0)::int as dials_14d,
       (s.agent_id is not null or coalesce(d.dials_14d, 0) > 0) as dialer_active_derived,
       coalesce(a.has_dialer_login, false) as has_dialer_login_column
from public.agents a
left join dials d on d.agent_id = a.id
left join seats s on s.agent_id = a.id
where (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
  and (public.apex_is_admin()
       or (public.has_role(auth.uid(), 'manager'::app_role) and public.apex_can_read_agent(a.id))
       or current_user in ('postgres', 'service_role', 'supabase_admin'));
revoke all on public.v_agent_dialer_state from public, anon;
grant select on public.v_agent_dialer_state to authenticated, service_role;

create or replace view public.v_activation_seat_queue with (security_barrier = true) as
select p.agent_id, p.first_name, p.hired_at,
       floor(extract(epoch from (now() - p.hired_at)) / 86400)::int as days_since_hire,
       coalesce(t.required_complete, false) as training_complete,
       exists (select 1 from public.interview_events ie
                where ie.call_track = 'onboarding' and ie.canceled_at is null and ie.scheduled_at < now()
                  and ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)) as onboarding_call_held,
       ds.last_dial_at, ds.dials_total,
       (f.agent_id is not null) as has_deal,
       p.manager_id,
       'staged: Sam decides seats and leads (N8); nothing is granted automatically'::text as decision_note
from public.fn_licensed_activation_population() p
join public.agents a on a.id = p.agent_id
left join public.v_training_required_completion t on t.agent_id = p.agent_id
left join public.v_agent_dialer_state ds on ds.agent_id = p.agent_id
left join public.v_agent_first_deal_any_source f on f.agent_id = p.agent_id
where (coalesce(t.required_complete, false)
       or exists (select 1 from public.interview_events ie
                   where ie.call_track = 'onboarding' and ie.canceled_at is null and ie.scheduled_at < now()
                     and ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)))
  and not coalesce(ds.has_open_seat, false)
  and coalesce(ds.dials_7d, 0) = 0
  and not exists (select 1 from public.lead_bundle_grants g where g.user_id = a.user_id and g.revoked_at is null);
revoke all on public.v_activation_seat_queue from public, anon;
grant select on public.v_activation_seat_queue to authenticated, service_role;

create or replace view public.v_activation_dialing_no_close with (security_barrier = true) as
with prod as (
  select p.agent_id,
         (select count(*) from public.mat_production_unified m
           where m.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)
             and coalesce(m.posted_date, m.effective_date) >= p.hired_at::date)
       + (select count(*) from public.deals d
           where d.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)
             and d.created_at >= p.hired_at) as deals_since_hire
  from public.fn_licensed_activation_population() p
)
select p.agent_id, p.first_name, p.hired_at,
       floor(extract(epoch from (now() - p.hired_at)) / 86400)::int as days_since_hire,
       ds.dials_14d, ds.dials_total, ds.last_dial_at, pr.deals_since_hire,
       'coach: review recordings, script and lead source before more dials'::text as next_action
from public.fn_licensed_activation_population() p
join public.v_agent_dialer_state ds on ds.agent_id = p.agent_id
join prod pr on pr.agent_id = p.agent_id
where ds.dials_14d >= 300 and pr.deals_since_hire = 0;
revoke all on public.v_activation_dialing_no_close from public, anon;
grant select on public.v_activation_dialing_no_close to authenticated, service_role;

-- ── 6. launch board: the seat / leads / coaching step before first_deal ─────────────────────────────────────────
create or replace view public.v_hire_launch_board as
 WITH base AS (
         SELECT a.id AS agent_id,
            a.user_id,
            a.profile_id,
            a.display_name,
            (a.license_status)::text AS license_status,
            (a.onboarding_stage)::text AS onboarding_stage,
            fn_hire_stage_rank((a.onboarding_stage)::text) AS stage_rank,
            a.created_at AS hired_at,
            a.stage_changed_at,
            a.contracted_at,
            a.first_deal_at,
            a.source_application_id,
            a.invited_by_manager_id
           FROM agents a
          WHERE ((a.status = 'active'::agent_status) AND (a.canonical_agent_id IS NULL) AND (COALESCE(a.is_deactivated, false) = false) AND (COALESCE(a.is_inactive, false) = false))
        ), book AS (
         SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS agent_id,
            count(*) AS deals,
            COALESCE(sum(p.annual_premium), (0)::numeric) AS ap
           FROM (v_production_canonical p
             LEFT JOIN v_agent_canonical_map cm ON ((cm.agent_id = p.agent_id)))
          WHERE (p.agent_id IS NOT NULL)
          GROUP BY COALESCE(cm.canonical_agent_id, p.agent_id)
        ), enriched AS (
         SELECT b.agent_id,
            b.user_id,
            b.profile_id,
            b.display_name,
            b.license_status,
            b.onboarding_stage,
            b.stage_rank,
            b.hired_at,
            b.stage_changed_at,
            b.contracted_at,
            b.first_deal_at,
            b.source_application_id,
            b.invited_by_manager_id,
            p.full_name,
            p.email,
            p.phone,
            mgr.display_name AS manager_name,
            GREATEST(0, (CURRENT_DATE - (COALESCE(b.stage_changed_at, b.hired_at))::date)) AS days_in_stage,
            GREATEST(0, (CURRENT_DATE - (b.hired_at)::date)) AS days_since_hired,
            act.calls_7d,
            act.calls_30d,
            act.conversations_30d,
            act.last_call_at,
            COALESCE(bk.deals, (0)::bigint) AS book_deals,
            COALESCE(bk.ap, (0)::numeric) AS book_ap,
            cal.next_call_at,
            cal.last_outcome AS last_call_outcome,
            tr.modules_done,
            EXISTS (SELECT 1 FROM agent_dialer_seats s WHERE s.agent_id = b.agent_id AND s.released_at IS NULL) AS has_open_seat,
            EXISTS (SELECT 1 FROM lead_bundle_grants g WHERE g.user_id = b.user_id AND b.user_id IS NOT NULL AND g.revoked_at IS NULL) AS has_lead_grant,
            dl.dials_7d AS alias_dials_7d,
            dl.dials_14d AS alias_dials_14d
           FROM (((((((base b
             LEFT JOIN profiles p ON ((p.id = b.profile_id)))
             LEFT JOIN agents mgr ON ((mgr.id = b.invited_by_manager_id)))
             LEFT JOIN book bk ON ((bk.agent_id = b.agent_id)))
             LEFT JOIN LATERAL ( SELECT min(oc.scheduled_at) FILTER (WHERE ((oc.scheduled_at > now()) AND (oc.canceled_at IS NULL))) AS next_call_at,
                    (array_agg(oc.outcome ORDER BY oc.scheduled_at DESC) FILTER (WHERE (oc.outcome IS NOT NULL)))[1] AS last_outcome
                   FROM v_onboarding_calls oc
                  WHERE (oc.agent_id = b.agent_id)) cal ON (true))
             LEFT JOIN LATERAL ( SELECT count(*) AS modules_done
                   FROM onboarding_progress op
                  WHERE ((op.agent_id = b.agent_id) AND (op.completed_at IS NOT NULL))) tr ON (true))
             LEFT JOIN v_hire_activity act ON ((act.agent_id = b.agent_id)))
             LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE c.call_started_at >= now() - '7 days'::interval) AS dials_7d,
                    count(*) FILTER (WHERE c.call_started_at >= now() - '14 days'::interval) AS dials_14d
                   FROM readymode_dialer_calls c
                  WHERE c.agent_id IN (SELECT a2.id FROM agents a2 WHERE a2.id = b.agent_id OR a2.canonical_agent_id = b.agent_id)) dl ON (true))
        )
 SELECT agent_id,
    user_id,
    COALESCE(NULLIF(btrim(display_name), ''::text), full_name, 'Name not on file'::text) AS display_name,
    email,
    phone,
    license_status,
    onboarding_stage,
    stage_rank,
    hired_at,
    stage_changed_at,
    days_in_stage,
    days_since_hired,
    contracted_at,
    first_deal_at,
    source_application_id,
    invited_by_manager_id,
    manager_name,
    book_deals,
    book_ap,
    next_call_at,
    last_call_outcome,
    modules_done,
    calls_7d,
    calls_30d,
    conversations_30d,
    last_call_at,
    (hired_at >= (((date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)))::date)::timestamp with time zone + '07:00:00'::interval)) AS hired_this_month,
        CASE
            WHEN (license_status <> 'licensed'::text) THEN 'license'::text
            WHEN (stage_rank IS NULL) THEN 'off_ladder'::text
            WHEN ((stage_rank < 3) AND (book_deals > 0)) THEN 'mark_producing'::text
            WHEN (stage_rank = 0) THEN 'start_onboarding'::text
            WHEN ((stage_rank = 1) AND (next_call_at IS NULL)) THEN 'book_call'::text
            WHEN (stage_rank = 1) THEN 'move_to_course'::text
            WHEN (stage_rank = 2) THEN 'move_to_field'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (COALESCE(alias_dials_14d, 0) >= 300)) THEN 'coach_closing'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_open_seat) AND (COALESCE(alias_dials_7d, 0) = 0)) THEN 'assign_dialer'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_lead_grant)) THEN 'grant_leads'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0)) THEN 'first_deal'::text
            WHEN (stage_rank = 3) THEN 'mark_producing'::text
            ELSE 'coach'::text
        END AS next_action_key,
        CASE
            WHEN (license_status <> 'licensed'::text) THEN 'Get them licensed'::text
            WHEN (stage_rank IS NULL) THEN (('Off the ladder at '::text || COALESCE(onboarding_stage, 'no stage'::text)) || ' — put them back on it'::text)
            WHEN ((stage_rank < 3) AND (book_deals > 0)) THEN 'Already writing business — mark them producing'::text
            WHEN (stage_rank = 0) THEN 'Start onboarding'::text
            WHEN ((stage_rank = 1) AND (next_call_at IS NULL)) THEN 'Book the onboarding call'::text
            WHEN (stage_rank = 1) THEN 'Move them into the course'::text
            WHEN (stage_rank = 2) THEN 'Course done — send them to field training'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (COALESCE(alias_dials_14d, 0) >= 300)) THEN 'Dialing hard, no deal yet — coach the close'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_open_seat) AND (COALESCE(alias_dials_7d, 0) = 0)) THEN 'No dialer seat on record — decide on a seat'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0) AND (NOT has_lead_grant)) THEN 'No leads granted — decide on a starter bundle'::text
            WHEN ((stage_rank = 3) AND (first_deal_at IS NULL) AND (book_deals = 0)) THEN 'Field training — get the first deal'::text
            WHEN (stage_rank = 3) THEN 'First deal is in — mark them producing'::text
            ELSE 'Producing — coach the next win'::text
        END AS next_action_label,
    ((COALESCE(stage_rank, 0) < 4) AND (GREATEST(0, (CURRENT_DATE - (COALESCE(stage_changed_at, hired_at))::date)) > 14)) AS is_stalled,
    ((email IS NULL) OR (btrim(email) = ''::text)) AS email_missing,
    ((phone IS NULL) OR (btrim(phone) = ''::text)) AS phone_missing,
    has_open_seat,
    has_lead_grant,
    COALESCE(alias_dials_14d, 0)::integer AS dials_14d
   FROM enriched e
  WHERE (apex_is_admin() OR crm_can_read_agent_scope(agent_id));
