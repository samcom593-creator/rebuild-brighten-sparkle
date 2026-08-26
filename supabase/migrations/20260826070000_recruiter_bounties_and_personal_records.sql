-- Recruiter bounties + personal records (2026-08-26).
--
-- Two durable engines the closure audit found missing (generic confetti is not
-- a ledger):
--   1. $500 producer bounty: when an agent recruited by a NON-manager producer
--      posts their first TWO canonical policies, the recruiter earns $500 — once
--      per recruited agent, auditable through pending → qualified → approved →
--      paid → reversed.
--   2. Personal records: best day (ALP), best week (ALP), most policies in a
--      day, longest selling streak (business days). Idempotent per record
--      boundary: one row per (agent, record_type, period_key).
-- Both read ONLY v_production_unified (canonical, deduped, roster-excluded) —
-- never a parallel daily total. Both emit outbox events (Slack) exactly once
-- per new row via idempotency_key. Evaluated by pg_cron every 15 minutes over
-- agents with production in the last 3 days, so a sync that lands 1,700 rows
-- does not run a per-row trigger 1,700 times.

-- ───────────────────────── recruiter bounties ─────────────────────────
create table if not exists public.recruiter_bounties (
  id uuid primary key default gen_random_uuid(),
  recruited_agent_id uuid not null unique references public.agents(id) on delete cascade,
  recruiter_agent_id uuid not null references public.agents(id) on delete cascade,
  application_id uuid,
  amount_cents integer not null default 50000,
  status text not null default 'qualified'
    check (status in ('pending','qualified','approved','paid','reversed')),
  policies_at_qualification integer not null,
  qualified_at timestamptz not null default now(),
  approved_at timestamptz, approved_by uuid,
  paid_at timestamptz, paid_by uuid, paid_reference text,
  reversed_at timestamptz, reversed_by uuid, reversed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recruiter_bounties enable row level security;
drop policy if exists recruiter_bounties_admin_all on public.recruiter_bounties;
create policy recruiter_bounties_admin_all on public.recruiter_bounties
  for all to authenticated using (public.apex_is_admin()) with check (public.apex_is_admin());
drop policy if exists recruiter_bounties_own_read on public.recruiter_bounties;
create policy recruiter_bounties_own_read on public.recruiter_bounties
  for select to authenticated using (
    exists (select 1 from public.agents a where a.user_id = auth.uid()
            and (a.id = recruiter_agent_id or a.id = recruited_agent_id))
  );
grant select on public.recruiter_bounties to authenticated;
grant all on public.recruiter_bounties to service_role;

-- The recruit → recruiter edge: the earliest application whose email matches
-- the agent's profile email and carries a recruiter_id (806 applications do;
-- recruiter_id references agents.id). Managers are excluded by rule.
create or replace view public.v_recruiter_bounty_candidates as
with recruit as (
  select distinct on (a.id)
    a.id as recruited_agent_id,
    coalesce(m.canonical_agent_id, a.id) as recruited_canonical_id,
    ap.recruiter_id as recruiter_agent_id,
    ap.id as application_id
  from public.agents a
  join public.profiles p on p.user_id = a.user_id
  join public.applications ap on lower(ap.email) = lower(p.email) and ap.recruiter_id is not null
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  join public.agents r on r.id = ap.recruiter_id
  where coalesce(r.is_manager, false) = false
    -- a recruiter with a downline is a manager whatever the flag says (KJ runs Vantage with is_manager=false)
    and not exists (select 1 from public.agents d where d.manager_id = r.id or d.invited_by_manager_id = r.id or d.switched_to_manager_id = r.id)
    and coalesce((select pct from public.fn_agent_contract_pct(r.id)), 0) < 100
    and r.id <> a.id
    and not public.fn_agent_is_roster_excluded(a.id)
  order by a.id, ap.created_at asc
)
select r.recruited_agent_id, r.recruiter_agent_id, r.application_id,
       (select count(*) from public.v_production_unified u
         where u.agent_id = r.recruited_canonical_id and u.origin <> 'external_daily_gap') as canonical_policies
from recruit r;
grant select on public.v_recruiter_bounty_candidates to authenticated, service_role;

create or replace function public.fn_evaluate_recruiter_bounties()
returns integer
language plpgsql security definer set search_path = public
as $fn$
declare v_new integer := 0; r record;
begin
  for r in
    select c.* from public.v_recruiter_bounty_candidates c
    where c.canonical_policies >= 2
      and not exists (select 1 from public.recruiter_bounties b where b.recruited_agent_id = c.recruited_agent_id)
  loop
    insert into public.recruiter_bounties(recruited_agent_id, recruiter_agent_id, application_id, policies_at_qualification)
    values (r.recruited_agent_id, r.recruiter_agent_id, r.application_id, r.canonical_policies)
    on conflict (recruited_agent_id) do nothing;
    if found then
      v_new := v_new + 1;
      insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
      select 'recruiter_bounty', b.id, 'recruiting.bounty_qualified', 'slack',
        jsonb_build_object(
          'recruiterName', coalesce(pr.full_name, ar.display_name, 'APEX producer'),
          'recruitName', coalesce(pc.full_name, ac.display_name, 'new agent'),
          'amountCents', b.amount_cents,
          'policies', b.policies_at_qualification,
          'openUrl', 'https://apex-financial.org/dashboard/team'),
        'recruiting.bounty_qualified:' || b.id::text || ':slack', gen_random_uuid()
      from public.recruiter_bounties b
      join public.agents ar on ar.id = b.recruiter_agent_id left join public.profiles pr on pr.user_id = ar.user_id
      join public.agents ac on ac.id = b.recruited_agent_id left join public.profiles pc on pc.user_id = ac.user_id
      where b.recruited_agent_id = r.recruited_agent_id
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;
  return v_new;
end;
$fn$;
revoke all on function public.fn_evaluate_recruiter_bounties() from public, anon, authenticated;
grant execute on function public.fn_evaluate_recruiter_bounties() to service_role;

create or replace function public.set_recruiter_bounty_status(p_id uuid, p_status text, p_note text default null)
returns public.recruiter_bounties
language plpgsql security definer set search_path = public
as $fn$
declare v public.recruiter_bounties;
begin
  if not public.apex_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_status not in ('approved','paid','reversed','qualified') then raise exception 'invalid status %', p_status; end if;
  update public.recruiter_bounties set
    status = p_status,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    paid_by = case when p_status = 'paid' then auth.uid() else paid_by end,
    paid_reference = case when p_status = 'paid' then p_note else paid_reference end,
    reversed_at = case when p_status = 'reversed' then now() else reversed_at end,
    reversed_by = case when p_status = 'reversed' then auth.uid() else reversed_by end,
    reversed_reason = case when p_status = 'reversed' then p_note else reversed_reason end,
    updated_at = now()
  where id = p_id returning * into v;
  if v.id is null then raise exception 'bounty % not found', p_id; end if;
  return v;
end;
$fn$;
revoke all on function public.set_recruiter_bounty_status(uuid, text, text) from public, anon;
grant execute on function public.set_recruiter_bounty_status(uuid, text, text) to authenticated, service_role;

-- ───────────────────────── personal records ─────────────────────────
create table if not exists public.personal_records (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  record_type text not null check (record_type in ('daily_alp','weekly_alp','daily_policies','selling_streak')),
  period_key text not null,
  value numeric not null,
  previous_best numeric,
  achieved_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, record_type, period_key)
);
alter table public.personal_records enable row level security;
drop policy if exists personal_records_read on public.personal_records;
create policy personal_records_read on public.personal_records for select to authenticated
  using (public.apex_is_admin() or exists (select 1 from public.agents a where a.user_id = auth.uid() and a.id = agent_id));
grant select on public.personal_records to authenticated;
grant all on public.personal_records to service_role;

-- Weekday ordinal: consecutive integers across Mon..Fri, weekends collapse, so
-- a streak = consecutive ordinals. Anchor 2000-01-03 is a Monday.
create or replace function public.fn_business_day_ordinal(p_date date)
returns integer language sql immutable as $$
  select (p_date - date '2000-01-03') - 2 * (((p_date - date '2000-01-03')) / 7)
$$;

create or replace function public.fn_evaluate_personal_records(p_since date default null, p_emit boolean default true)
returns integer
language plpgsql security definer set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_since date := coalesce(p_since, v_today - 3);
  v_new integer := 0;
  r record;
begin
  for r in
    with active as (
      select distinct u.agent_id from public.v_production_unified u
      where u.posted_date >= v_since and u.agent_id is not null and u.origin <> 'external_daily_gap'
    ),
    days as (
      select u.agent_id, u.posted_date, sum(u.annual_premium) as alp, count(*) as policies
      from public.v_production_unified u join active a on a.agent_id = u.agent_id
      where u.origin <> 'external_daily_gap'
      group by 1,2
    ),
    weeks as (
      select agent_id, to_char(date_trunc('week', posted_date), 'IYYY-"W"IW') as wk, sum(alp) as alp,
             max(posted_date) as last_day
      from days group by 1,2
    ),
    streaks as (
      select agent_id, posted_date,
             public.fn_business_day_ordinal(posted_date)
               - row_number() over (partition by agent_id order by posted_date) as grp
      from days where extract(isodow from posted_date) between 1 and 5
    ),
    streak_len as (
      select agent_id, count(*) as len, max(posted_date) as end_day, min(posted_date) as start_day
      from streaks group by agent_id, grp
    ),
    candidates as (
      -- daily ALP: a day beating every EARLIER day
      select d.agent_id, 'daily_alp'::text as record_type, d.posted_date::text as period_key, d.alp as value,
             (select max(alp) from days p where p.agent_id = d.agent_id and p.posted_date < d.posted_date) as previous_best,
             d.posted_date as achieved_on
      from days d where d.posted_date >= v_since
      union all
      select d.agent_id, 'daily_policies', d.posted_date::text, d.policies,
             (select max(policies) from days p where p.agent_id = d.agent_id and p.posted_date < d.posted_date),
             d.posted_date
      from days d where d.posted_date >= v_since
      union all
      select w.agent_id, 'weekly_alp', w.wk, w.alp,
             (select max(alp) from weeks p where p.agent_id = w.agent_id and p.wk < w.wk),
             w.last_day
      from weeks w where w.last_day >= v_since
      union all
      select s.agent_id, 'selling_streak', s.end_day::text, s.len,
             (select max(len) from streak_len p where p.agent_id = s.agent_id and p.end_day < s.start_day),
             s.end_day
      from streak_len s where s.end_day >= v_since and s.len >= 2
    )
    select * from candidates c
    where c.value > coalesce(c.previous_best, 0)
      and coalesce(c.previous_best, 0) > 0 or (c.record_type = 'selling_streak' and c.value > coalesce(c.previous_best, 1))
  loop
    insert into public.personal_records(agent_id, record_type, period_key, value, previous_best, achieved_on)
    values (r.agent_id, r.record_type, r.period_key, r.value, r.previous_best, r.achieved_on)
    on conflict (agent_id, record_type, period_key)
      do update set value = excluded.value, previous_best = excluded.previous_best, updated_at = now()
      where public.personal_records.value < excluded.value;
    if found and p_emit and not exists (
      select 1 from public.outbox_events o
      where o.idempotency_key = 'production.personal_record:' || r.agent_id::text || ':' || r.record_type || ':' || r.period_key || ':slack'
    ) then
      v_new := v_new + 1;
      insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
      select 'personal_record', pr.id, 'production.personal_record', 'slack',
        jsonb_build_object(
          'agentName', coalesce(p.full_name, a.display_name, 'APEX producer'),
          'recordType', r.record_type, 'value', r.value, 'previousBest', r.previous_best,
          'periodKey', r.period_key, 'openUrl', 'https://apex-financial.org/dashboard'),
        'production.personal_record:' || r.agent_id::text || ':' || r.record_type || ':' || r.period_key || ':slack',
        gen_random_uuid()
      from public.personal_records pr
      join public.agents a on a.id = pr.agent_id left join public.profiles p on p.user_id = a.user_id
      where pr.agent_id = r.agent_id and pr.record_type = r.record_type and pr.period_key = r.period_key
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;
  return v_new;
end;
$fn$;
revoke all on function public.fn_evaluate_personal_records(date, boolean) from public, anon, authenticated;
grant execute on function public.fn_evaluate_personal_records(date, boolean) to service_role;

-- Read model for the dashboard card: admin sees everyone, everyone else sees
-- their own hierarchy (same edge set as scoped_production_scoreboard).
create or replace function public.apex_records_and_bounties(p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare v_scope uuid[]; v_admin boolean := public.apex_is_admin(); v_out jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if v_admin then
    select coalesce(array_agg(id), '{}') into v_scope from public.agents;
  else
    with recursive roots as (
      select a.id from public.agents a where a.user_id = auth.uid()
    ), h(id) as (
      select id from roots
      union
      select c.id from public.agents c join h on c.manager_id = h.id or c.invited_by_manager_id = h.id or c.switched_to_manager_id = h.id
    ) select coalesce(array_agg(id), '{}') into v_scope from h;
  end if;
  select jsonb_build_object(
    'records', coalesce((select jsonb_agg(x order by x->>'achieved_on' desc, x->>'created_at' desc) from (
        select jsonb_build_object('id', pr.id, 'agent_id', pr.agent_id,
          'agent_name', coalesce(p.full_name, a.display_name), 'record_type', pr.record_type,
          'period_key', pr.period_key, 'value', pr.value, 'previous_best', pr.previous_best,
          'achieved_on', pr.achieved_on, 'created_at', pr.created_at) as x
        from public.personal_records pr join public.agents a on a.id = pr.agent_id
        left join public.profiles p on p.user_id = a.user_id
        where pr.agent_id = any(v_scope)
        order by pr.achieved_on desc, pr.created_at desc limit p_limit) s), '[]'::jsonb),
    'bounties', coalesce((select jsonb_agg(x order by x->>'qualified_at' desc) from (
        select jsonb_build_object('id', b.id, 'status', b.status, 'amount_cents', b.amount_cents,
          'recruiter_name', coalesce(pr.full_name, ar.display_name), 'recruit_name', coalesce(pc.full_name, ac.display_name),
          'policies_at_qualification', b.policies_at_qualification, 'qualified_at', b.qualified_at,
          'paid_at', b.paid_at, 'reversed_reason', b.reversed_reason) as x
        from public.recruiter_bounties b
        join public.agents ar on ar.id = b.recruiter_agent_id left join public.profiles pr on pr.user_id = ar.user_id
        join public.agents ac on ac.id = b.recruited_agent_id left join public.profiles pc on pc.user_id = ac.user_id
        where b.recruiter_agent_id = any(v_scope) or b.recruited_agent_id = any(v_scope)
        order by b.qualified_at desc limit p_limit) s), '[]'::jsonb),
    'candidates_near', case when v_admin then (select count(*) from public.v_recruiter_bounty_candidates c
        where c.canonical_policies = 1 and not exists (select 1 from public.recruiter_bounties b where b.recruited_agent_id = c.recruited_agent_id)) else null end,
    'is_admin', v_admin
  ) into v_out;
  return v_out;
end;
$fn$;
revoke all on function public.apex_records_and_bounties(integer) from public, anon;
grant execute on function public.apex_records_and_bounties(integer) to authenticated, service_role;

-- ───────────────────────── Slack routes ─────────────────────────
do $block$
declare v_inst uuid; v_dest uuid; v_route record;
begin
  select id into v_inst from public.messaging_workspace_installations
  where provider = 'slack' and environment = 'production' and status = 'active'
  order by installed_at desc nulls last, created_at desc limit 1;
  if v_inst is null then raise notice 'no active Slack installation; routes not bound'; return; end if;
  for v_route in select * from (values
      ('production.personal_record', 'sales_wins', 2::smallint),
      ('recruiting.bounty_qualified', 'manager_ops', 1::smallint)) as t(event_type, purpose, priority)
  loop
    select id into v_dest from public.messaging_destinations
    where installation_id = v_inst and purpose = v_route.purpose and scope_type = 'organization' and scope_key is null and is_enabled;
    if v_dest is null then raise notice 'no destination for %', v_route.purpose; continue; end if;
    insert into public.messaging_route_rules(installation_id, event_type, destination_id, audience_scope, priority, batch_policy, is_enabled)
    values (v_inst, v_route.event_type, v_dest, 'organization', v_route.priority, 'instant', true)
    on conflict (installation_id, event_type, destination_id, audience_scope)
      do update set priority = excluded.priority, is_enabled = true, updated_at = now();
  end loop;
end;
$block$;

-- ───────────────────────── schedule ─────────────────────────
select cron.unschedule(jobid) from cron.job where jobname in ('apex-personal-records-15min','apex-recruiter-bounties-15min');
select cron.schedule('apex-personal-records-15min', '*/15 * * * *', $$select public.fn_evaluate_personal_records()$$);
select cron.schedule('apex-recruiter-bounties-15min', '7,22,37,52 * * * *', $$select public.fn_evaluate_recruiter_bounties()$$);

-- Reversal is announced on the same channel the qualification was, so a wrong
-- award never stands uncorrected in Slack. Emitted by set_recruiter_bounty_status.
create or replace function public.fn_emit_bounty_reversed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status = 'reversed' and old.status is distinct from 'reversed' then
    insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
    select 'recruiter_bounty', new.id, 'recruiting.bounty_reversed', 'slack',
      jsonb_build_object(
        'recruiterName', coalesce(pr.full_name, ar.display_name, 'APEX producer'),
        'recruitName', coalesce(pc.full_name, ac.display_name, 'new agent'),
        'reason', new.reversed_reason,
        'openUrl', 'https://apex-financial.org/dashboard/team')
    from public.agents ar left join public.profiles pr on pr.user_id = ar.user_id,
         public.agents ac left join public.profiles pc on pc.user_id = ac.user_id
    where ar.id = new.recruiter_agent_id and ac.id = new.recruited_agent_id
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
exception when others then return new;
end;
$fn$;
drop trigger if exists trg_recruiter_bounty_reversed on public.recruiter_bounties;
create trigger trg_recruiter_bounty_reversed after update of status on public.recruiter_bounties
  for each row execute function public.fn_emit_bounty_reversed();
do $block$
declare v_inst uuid; v_dest uuid;
begin
  select id into v_inst from public.messaging_workspace_installations where provider='slack' and environment='production' and status='active' order by installed_at desc nulls last, created_at desc limit 1;
  select id into v_dest from public.messaging_destinations where installation_id = v_inst and purpose = 'manager_ops' and scope_type='organization' and scope_key is null and is_enabled;
  if v_inst is not null and v_dest is not null then
    insert into public.messaging_route_rules(installation_id, event_type, destination_id, audience_scope, priority, batch_policy, is_enabled)
    values (v_inst, 'recruiting.bounty_reversed', v_dest, 'organization', 1, 'instant', true)
    on conflict (installation_id, event_type, destination_id, audience_scope) do update set is_enabled = true, updated_at = now();
  end if;
end;
$block$;
