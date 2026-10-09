-- Aflac onboarding gate + mandatory daily check-off (2026-10-08)
--
-- Why: every licensed hire now has to be sent to Aflac for contracting, and Aflac then emails the hire
-- directly. Nothing tracked whether that send happened. This adds the one place it is recorded, and a
-- daily check-off that cannot be completed while a ready hire is still unsent.
--
-- Shape (additive; no table dropped, no row changed, contracting_intakes is only READ):
--   1. aflac_gate_config      one row: go_live_at. Intakes created before it are "earlier hires" and never block.
--   2. aflac_submissions      one row per hire actually sent. A row means SENT. It snapshots the exact name,
--                             email, NPN, phone and the comp level typed by hand at send time.
--   3. aflac_daily_checkoffs  one row per Phoenix calendar day the check-off was completed.
--   4. aflac_gate_state()     the single read: queue, blockers, recent sends, today's check-off.
--   5. aflac_mark_submitted() the single write for a send. ADMIN ONLY (the owner types the comp level by hand
--                             and the hire notice email is sent under the admin's credentials). Refuses a hire with missing or malformed data.
--   6. aflac_daily_checkoff() refuses while any READY, tracked hire is unsent.
--
-- Design rules kept from the Ethos gate: a verdict is never derived from a default (comp level is typed by
-- a human every time), and a hire with bad data is reported as BLOCKED, not quietly dropped or auto-fixed.
-- The check-off allows blocked hires to remain (they are counted and carried), because a gate that can never
-- be cleared by anything a person can do turns permanently red and trains the owner to ignore it.

begin;

create table if not exists public.aflac_gate_config (
  singleton boolean primary key default true check (singleton),
  go_live_at timestamptz not null
);
insert into public.aflac_gate_config (singleton, go_live_at)
values (true, (date_trunc('day', now() at time zone 'America/Phoenix')) at time zone 'America/Phoenix')
on conflict (singleton) do nothing;

create table if not exists public.aflac_submissions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null unique references public.contracting_intakes(id) on delete restrict,
  agent_id uuid references public.agents(id) on delete set null,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  npn text not null check (npn ~ '^[0-9]{6,10}$'),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{9,14}$'),
  comp_level text not null check (comp_level ~ '^[A-Za-z0-9][A-Za-z0-9 %./()+-]{0,39}$'),
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  hire_notified_at timestamptz,
  hire_notify_error text,
  created_at timestamptz not null default now()
);
create index if not exists aflac_submissions_submitted_at_idx on public.aflac_submissions (submitted_at desc);

create table if not exists public.aflac_daily_checkoffs (
  check_date date primary key,
  completed_by uuid,
  completed_at timestamptz not null default now(),
  submitted_that_day integer not null default 0,
  blocked_carried integer not null default 0
);

alter table public.aflac_gate_config enable row level security;
alter table public.aflac_submissions enable row level security;
alter table public.aflac_daily_checkoffs enable row level security;

-- Reads only for staff. Every write goes through the SECURITY DEFINER functions below.
drop policy if exists aflac_submissions_staff_read on public.aflac_submissions;
create policy aflac_submissions_staff_read on public.aflac_submissions for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager'));
drop policy if exists aflac_daily_checkoffs_staff_read on public.aflac_daily_checkoffs;
create policy aflac_daily_checkoffs_staff_read on public.aflac_daily_checkoffs for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager'));
drop policy if exists aflac_gate_config_staff_read on public.aflac_gate_config;
create policy aflac_gate_config_staff_read on public.aflac_gate_config for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager'));

revoke all on table public.aflac_gate_config from anon, authenticated;
revoke all on table public.aflac_submissions from anon, authenticated;
revoke all on table public.aflac_daily_checkoffs from anon, authenticated;
grant select on table public.aflac_gate_config to authenticated;
grant select on table public.aflac_submissions to authenticated;
grant select on table public.aflac_daily_checkoffs to authenticated;
grant all on table public.aflac_gate_config to service_role;
grant all on table public.aflac_submissions to service_role;
grant all on table public.aflac_daily_checkoffs to service_role;

-- Missing/invalid fields for one intake row. Single definition so the queue and the send guard cannot drift.
create or replace function public.aflac_intake_missing(
  p_first text, p_last text, p_email text, p_npn text, p_phone text, p_license text, p_status text
) returns text[]
language sql immutable
set search_path = public
as $$
  select coalesce(array_remove(array[
    case when btrim(coalesce(p_first, '')) = '' then 'first_name' end,
    case when btrim(coalesce(p_last, '')) = '' then 'last_name' end,
    case when coalesce(p_email, '') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then 'email' end,
    case when coalesce(p_npn, '') !~ '^[0-9]{6,10}$' then 'npn' end,
    case when coalesce(p_phone, '') !~ '^\+[1-9][0-9]{9,14}$' then 'phone' end,
    case when coalesce(p_license, '') <> 'licensed' then 'not_licensed' end,
    case when coalesce(p_status, '') <> 'accepted' then 'intake_not_accepted' end
  ], null), '{}'::text[])
$$;

create or replace function public.aflac_gate_state()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_go_live timestamptz;
  v_queue jsonb;
  v_recent jsonb;
  v_check jsonb;
  v_ready int; v_blocked int; v_earlier int;
begin
  if not (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select go_live_at into v_go_live from public.aflac_gate_config where singleton;

  with q as (
    select i.id as intake_id, i.agent_id, i.first_name, i.last_name, i.email, i.npn, i.phone_e164,
           i.license_status, i.status as intake_status, i.review_reason, i.created_at,
           (i.created_at >= v_go_live) as tracked,
           public.aflac_intake_missing(i.first_name, i.last_name, i.email, i.npn, i.phone_e164, i.license_status, i.status) as missing
    from public.contracting_intakes i
    where coalesce(i.license_status, '') = 'licensed'
      and not exists (select 1 from public.aflac_submissions s where s.intake_id = i.id)
  )
  select
    coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb),
    count(*) filter (where q.tracked and cardinality(q.missing) = 0),
    count(*) filter (where q.tracked and cardinality(q.missing) > 0),
    count(*) filter (where not q.tracked)
  into v_queue, v_ready, v_blocked, v_earlier
  from q;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.submitted_at desc), '[]'::jsonb) into v_recent
  from (
    select s.id, s.intake_id, s.first_name, s.last_name, s.email, s.npn, s.phone_e164, s.comp_level,
           s.submitted_at, s.hire_notified_at, s.hire_notify_error
    from public.aflac_submissions s
    where s.submitted_at >= now() - interval '14 days'
    order by s.submitted_at desc
    limit 100
  ) r;

  select to_jsonb(c) into v_check from public.aflac_daily_checkoffs c where c.check_date = v_today;

  return jsonb_build_object(
    'today', v_today,
    'go_live_at', v_go_live,
    'ready_unsent', v_ready,
    'blocked_unsent', v_blocked,
    'earlier_unsent', v_earlier,
    'checked_off_today', v_check is not null,
    'checkoff', v_check,
    'queue', v_queue,
    'recent', v_recent
  );
end;
$$;

create or replace function public.aflac_mark_submitted(p_intake_id uuid, p_comp_level text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  i public.contracting_intakes%rowtype;
  v_missing text[];
  v_comp text := btrim(coalesce(p_comp_level, ''));
  v_id uuid;
begin
  if not public.apex_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_comp !~ '^[A-Za-z0-9][A-Za-z0-9 %./()+-]{0,39}$' then
    return jsonb_build_object('ok', false, 'reason', 'comp_level_required');
  end if;

  select * into i from public.contracting_intakes where id = p_intake_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'intake_not_found');
  end if;

  v_missing := public.aflac_intake_missing(i.first_name, i.last_name, i.email, i.npn, i.phone_e164, i.license_status, i.status);
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_data', 'missing', to_jsonb(v_missing));
  end if;

  insert into public.aflac_submissions
    (intake_id, agent_id, first_name, last_name, email, npn, phone_e164, comp_level, submitted_by)
  values
    (i.id, i.agent_id, btrim(i.first_name), btrim(i.last_name), btrim(i.email), i.npn, i.phone_e164, v_comp, auth.uid())
  on conflict (intake_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'already_submitted', true);
  end if;
  return jsonb_build_object('ok', true, 'submission_id', v_id);
end;
$$;

create or replace function public.aflac_daily_checkoff()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_go_live timestamptz;
  v_ready int; v_blocked int; v_sent int;
begin
  if not public.apex_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.aflac_daily_checkoffs where check_date = v_today) then
    return jsonb_build_object('ok', true, 'already_checked_off', true);
  end if;

  select go_live_at into v_go_live from public.aflac_gate_config where singleton;

  select
    count(*) filter (where cardinality(m.missing) = 0),
    count(*) filter (where cardinality(m.missing) > 0)
  into v_ready, v_blocked
  from (
    select public.aflac_intake_missing(i.first_name, i.last_name, i.email, i.npn, i.phone_e164, i.license_status, i.status) as missing
    from public.contracting_intakes i
    where coalesce(i.license_status, '') = 'licensed'
      and i.created_at >= v_go_live
      and not exists (select 1 from public.aflac_submissions s where s.intake_id = i.id)
  ) m;

  if v_ready > 0 then
    return jsonb_build_object('ok', false, 'reason', 'ready_hires_unsent', 'count', v_ready);
  end if;

  select count(*) into v_sent from public.aflac_submissions
  where (submitted_at at time zone 'America/Phoenix')::date = v_today;

  insert into public.aflac_daily_checkoffs (check_date, completed_by, submitted_that_day, blocked_carried)
  values (v_today, auth.uid(), v_sent, v_blocked)
  on conflict (check_date) do nothing;

  return jsonb_build_object('ok', true, 'submitted_that_day', v_sent, 'blocked_carried', v_blocked);
end;
$$;

revoke all on function public.aflac_intake_missing(text, text, text, text, text, text, text) from public, anon;
revoke all on function public.aflac_gate_state() from public, anon;
revoke all on function public.aflac_mark_submitted(uuid, text) from public, anon;
revoke all on function public.aflac_daily_checkoff() from public, anon;
grant execute on function public.aflac_intake_missing(text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.aflac_gate_state() to authenticated, service_role;
grant execute on function public.aflac_mark_submitted(uuid, text) to authenticated, service_role;
grant execute on function public.aflac_daily_checkoff() to authenticated, service_role;

commit;
