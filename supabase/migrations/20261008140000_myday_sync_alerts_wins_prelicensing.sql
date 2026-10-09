-- My Day: Todoist sync map, phone alerts, win counters, pre-licensing check (2026-10-08)
--
-- Sam: make My Day editable end to end, sync it with the real to-do list so it reaches the calendar, alert
-- him when a block starts, count the wins that matter (hires with every contract sent, unlicensed hires who
-- bought the licensing course, long-form videos posted), and confirm that everyone added to the Slack has
-- actually done pre-licensing.
--
-- Additive only. No existing row is changed here; the schedule rewrite is a separate, snapshotted script.
--
--   1. day_plan_tasks.alert         per-block alert switch (default on)
--   2. day_plan_todoist_map         which Todoist task each recurring block became (edge fn writes, admin reads)
--   3. myday_alerts_sent            one row per block per day, so a block alerts once and only once
--   4. myday_alert_tick()           pg_cron every 5 min: ntfy 5-10 min before a block starts, via fn_ntfy_relay
--   5. myday_counter_events + RPCs  +1 buttons with today / this week / total and an undo
--   6. prelicensing_confirmations   Sam's own "in the Slack" and "pre-licensing done" ticks
--   7. prelicensing_check_list()    everyone who bought the course or is an active unlicensed hire, with XCEL %
--
-- Truth rules kept from the Aflac gate: a confirmation is a human tick, never inferred. XCEL at 100% is shown
-- as evidence beside the tick, it does not set the tick. Admin only.

begin;

alter table public.day_plan_tasks add column if not exists alert boolean not null default true;

create table if not exists public.day_plan_todoist_map (
  key text primary key,
  todoist_id text not null,
  content text not null,
  due_string text not null,
  synced_at timestamptz not null default now()
);
alter table public.day_plan_todoist_map enable row level security;
drop policy if exists day_plan_todoist_map_admin_read on public.day_plan_todoist_map;
create policy day_plan_todoist_map_admin_read on public.day_plan_todoist_map for select using (public.apex_is_admin());
revoke all on table public.day_plan_todoist_map from anon, authenticated;
grant select on table public.day_plan_todoist_map to authenticated;
grant all on table public.day_plan_todoist_map to service_role;

create table if not exists public.myday_alerts_sent (
  task_id uuid not null,
  day date not null,
  request_id bigint,
  sent_at timestamptz not null default now(),
  primary key (task_id, day)
);
alter table public.myday_alerts_sent enable row level security;
revoke all on table public.myday_alerts_sent from anon, authenticated;
grant all on table public.myday_alerts_sent to service_role;

-- Alert 5-10 minutes ahead of every active, undone block that has alerts on. Phoenix clock throughout.
-- Rest blocks never alert except the two that protect sleep. The ntfy title is plain ASCII (MP-274).
create or replace function public.myday_alert_tick(p_topic text default null)
returns jsonb
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_now timestamptz := now();
  v_day date := (v_now at time zone 'America/Phoenix')::date;
  v_wd int := extract(isodow from (v_now at time zone 'America/Phoenix'))::int;
  v_min int := (extract(hour from (v_now at time zone 'America/Phoenix'))::int * 60)
             + extract(minute from (v_now at time zone 'America/Phoenix'))::int;
  r record;
  v_req bigint;
  v_sent int := 0;
begin
  for r in
    select t.id, t.title, t.detail, t.start_min, t.category
    from public.day_plan_tasks t
    where t.active and t.alert
      and t.weekday = v_wd
      and t.start_min >= v_min + 5 and t.start_min < v_min + 10
      and (t.category <> 'rest' or t.title ~* 'wind down|in bed|lights out')
      and not exists (select 1 from public.day_plan_checks c where c.task_id = t.id and c.day = v_day)
      and not exists (select 1 from public.myday_alerts_sent s where s.task_id = t.id and s.day = v_day)
  loop
    v_req := public.fn_ntfy_relay(
      regexp_replace('Next: ' || r.title, '[^\x20-\x7E]', '', 'g'),
      to_char(make_time(r.start_min / 60, r.start_min % 60, 0), 'HH12:MI AM') || ' Arizona. ' || coalesce(left(r.detail, 200), ''),
      '4', 'alarm_clock', coalesce(nullif(p_topic, ''), 'sams-agent-yrkv9kbqp9e987nb')
    );
    insert into public.myday_alerts_sent (task_id, day, request_id) values (r.id, v_day, v_req)
    on conflict do nothing;
    v_sent := v_sent + 1;
  end loop;
  return jsonb_build_object('sent', v_sent, 'phoenix_minute', v_min, 'weekday', v_wd);
end;
$$;
revoke all on function public.myday_alert_tick(text) from public, anon, authenticated;
grant execute on function public.myday_alert_tick(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'myday-alert-tick') then perform cron.unschedule('myday-alert-tick'); end if;
  perform cron.schedule('myday-alert-tick', '*/5 * * * *', 'select public.myday_alert_tick()');
end
$$;

-- Win counters ---------------------------------------------------------------------------------------------
create table if not exists public.myday_counter_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('hire_contracts_sent', 'unlicensed_course_hire', 'long_form_posted')),
  occurred_at timestamptz not null default now(),
  note text
);
create index if not exists myday_counter_events_user_kind_idx on public.myday_counter_events (user_id, kind, occurred_at desc);
alter table public.myday_counter_events enable row level security;
drop policy if exists myday_counter_events_own_read on public.myday_counter_events;
create policy myday_counter_events_own_read on public.myday_counter_events for select
  using (public.apex_is_admin() and user_id = auth.uid());
revoke all on table public.myday_counter_events from anon, authenticated;
grant select on table public.myday_counter_events to authenticated;
grant all on table public.myday_counter_events to service_role;

create or replace function public.myday_counters()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_week date := date_trunc('week', now() at time zone 'America/Phoenix')::date;
  v_out jsonb := '{}'::jsonb;
  k text;
begin
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  foreach k in array array['hire_contracts_sent', 'unlicensed_course_hire', 'long_form_posted'] loop
    v_out := v_out || jsonb_build_object(k, (
      select jsonb_build_object(
        'today', count(*) filter (where (occurred_at at time zone 'America/Phoenix')::date = v_today),
        'week', count(*) filter (where (occurred_at at time zone 'America/Phoenix')::date >= v_week),
        'total', count(*))
      from public.myday_counter_events where user_id = auth.uid() and kind = k));
  end loop;
  return v_out;
end;
$$;

create or replace function public.myday_counter_add(p_kind text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_kind not in ('hire_contracts_sent', 'unlicensed_course_hire', 'long_form_posted') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_kind');
  end if;
  insert into public.myday_counter_events (user_id, kind) values (auth.uid(), p_kind);
  return jsonb_build_object('ok', true);
end;
$$;

-- Undo removes only the most recent event, and only if it is from the last 24 hours: a mis-tap, not history.
create or replace function public.myday_counter_undo(p_kind text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select id into v_id from public.myday_counter_events
  where user_id = auth.uid() and kind = p_kind and occurred_at >= now() - interval '24 hours'
  order by occurred_at desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'nothing_recent_to_undo'); end if;
  delete from public.myday_counter_events where id = v_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Pre-licensing check ---------------------------------------------------------------------------------------
create table if not exists public.prelicensing_confirmations (
  email_key text primary key check (email_key = lower(btrim(email_key)) and email_key <> ''),
  in_slack boolean not null default false,
  in_slack_at timestamptz,
  prelicensing_done boolean not null default false,
  prelicensing_done_at timestamptz,
  confirmed_by uuid,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.prelicensing_confirmations enable row level security;
drop policy if exists prelicensing_confirmations_admin_read on public.prelicensing_confirmations;
create policy prelicensing_confirmations_admin_read on public.prelicensing_confirmations for select using (public.apex_is_admin());
revoke all on table public.prelicensing_confirmations from anon, authenticated;
grant select on table public.prelicensing_confirmations to authenticated;
grant all on table public.prelicensing_confirmations to service_role;

create or replace function public.prelicensing_check_list()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return coalesce((
    with people as (
      select lower(btrim(a.email)) as email_key,
             btrim(concat_ws(' ', a.first_name, a.last_name)) as name,
             a.phone, a.course_purchased_at as bought_at, 'course_buyer'::text as source
      from public.applications a
      where a.course_purchased_at is not null and coalesce(a.license_status::text, '') <> 'licensed'
        and nullif(btrim(a.email), '') is not null
      union all
      select lower(btrim(p.email)), g.display_name, p.phone, null::timestamptz, 'unlicensed_hire'
      from public.agents g
      join public.profiles p on p.user_id = g.user_id
      where g.status::text = 'active' and g.license_status::text in ('unlicensed', 'pending')
        and nullif(btrim(p.email), '') is not null
    ),
    merged as (
      select email_key,
             max(name) as name,
             max(phone) as phone,
             max(bought_at) as bought_at,
             case when count(distinct source) > 1 then 'both' else min(source) end as source
      from people group by email_key
    ),
    xc as (
      select lower(btrim(coalesce(x.email, x.student_email))) as email_key,
             max(x.pre_licensing_pct) as xcel_pct,
             max(x.course_status) as xcel_status
      from public.xcel_events x group by 1
    )
    select jsonb_agg(jsonb_build_object(
        'email_key', m.email_key, 'name', m.name, 'phone', m.phone, 'source', m.source,
        'bought_at', m.bought_at, 'xcel_pct', xc.xcel_pct, 'xcel_status', xc.xcel_status,
        'in_slack', coalesce(c.in_slack, false), 'prelicensing_done', coalesce(c.prelicensing_done, false),
        'note', c.note, 'updated_at', c.updated_at)
      order by coalesce(c.prelicensing_done, false), coalesce(c.in_slack, false), m.bought_at desc nulls last, m.name)
    from merged m
    left join xc on xc.email_key = m.email_key
    left join public.prelicensing_confirmations c on c.email_key = m.email_key
  ), '[]'::jsonb);
end;
$$;

create or replace function public.prelicensing_set(p_email_key text, p_in_slack boolean, p_done boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_key text := lower(btrim(coalesce(p_email_key, '')));
begin
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_key = '' then return jsonb_build_object('ok', false, 'reason', 'email_required'); end if;
  insert into public.prelicensing_confirmations
    (email_key, in_slack, in_slack_at, prelicensing_done, prelicensing_done_at, confirmed_by, note, updated_at)
  values
    (v_key, coalesce(p_in_slack, false), case when p_in_slack then now() end,
     coalesce(p_done, false), case when p_done then now() end, auth.uid(), nullif(btrim(p_note), ''), now())
  on conflict (email_key) do update set
    in_slack = excluded.in_slack,
    in_slack_at = case when excluded.in_slack then coalesce(public.prelicensing_confirmations.in_slack_at, now()) end,
    prelicensing_done = excluded.prelicensing_done,
    prelicensing_done_at = case when excluded.prelicensing_done then coalesce(public.prelicensing_confirmations.prelicensing_done_at, now()) end,
    confirmed_by = auth.uid(),
    note = coalesce(excluded.note, public.prelicensing_confirmations.note),
    updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.myday_counters() from public, anon;
revoke all on function public.myday_counter_add(text) from public, anon;
revoke all on function public.myday_counter_undo(text) from public, anon;
revoke all on function public.prelicensing_check_list() from public, anon;
revoke all on function public.prelicensing_set(text, boolean, boolean, text) from public, anon;
grant execute on function public.myday_counters() to authenticated, service_role;
grant execute on function public.myday_counter_add(text) to authenticated, service_role;
grant execute on function public.myday_counter_undo(text) to authenticated, service_role;
grant execute on function public.prelicensing_check_list() to authenticated, service_role;
grant execute on function public.prelicensing_set(text, boolean, boolean, text) to authenticated, service_role;

commit;
