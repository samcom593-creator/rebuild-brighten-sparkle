-- Producer workspace: personal monthly production, an evidenced activity plan, and
-- effective-dated selling schedules. No provider calls, sends, or seeded fake activity.
-- Canonical production uses Phoenix posted_date, matching v_production_canonical.

create or replace function public.producer_can_access_agent(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null
    and not public.fn_user_login_blocked(auth.uid())
    and not public.fn_user_is_suspended(auth.uid())
    and (
      public.apex_is_admin()
      or exists (
        select 1 from public.agents a
         where coalesce(a.canonical_agent_id, a.id) = p_agent_id
           and a.user_id = auth.uid()
           and a.is_deactivated is not true and a.is_inactive is not true
           and coalesce(a.status::text,'') not in ('terminated','inactive')
           and not public.fn_agent_is_suspended(p_agent_id)
      )
    )
$$;
revoke all on function public.producer_can_access_agent(uuid) from public, anon;
grant execute on function public.producer_can_access_agent(uuid) to authenticated;

create table if not exists public.producer_work_schedules (
  agent_id uuid not null references public.agents(id) on delete cascade,
  effective_on date not null,
  selling_days integer[] not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (agent_id, effective_on),
  constraint producer_work_days_valid check (
    cardinality(selling_days) between 1 and 7
    and selling_days <@ array[0,1,2,3,4,5,6]
    and array_position(selling_days, null) is null
  )
);
alter table public.producer_work_schedules enable row level security;
create policy producer_work_schedules_read on public.producer_work_schedules
  for select to authenticated using (public.producer_can_access_agent(agent_id));
revoke all on public.producer_work_schedules from public, anon, authenticated;
grant select on public.producer_work_schedules to authenticated;

create or replace function public.producer_set_work_schedule(p_agent_id uuid, p_selling_days integer[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_days integer[]; v_effective date := (now() at time zone 'America/Phoenix')::date + 1;
begin
  if not public.producer_can_access_agent(p_agent_id) then
    raise exception 'Producer not found or access denied' using errcode = '42501';
  end if;
  select array_agg(distinct d order by d) into v_days from unnest(p_selling_days) d;
  if v_days is null or cardinality(v_days) not between 1 and 7
     or not (v_days <@ array[0,1,2,3,4,5,6]) or array_position(v_days, null) is not null then
    raise exception 'Choose at least one selling day' using errcode = '22023';
  end if;
  -- Tomorrow is the earliest effective date. A schedule change never rewrites a
  -- completed day or repairs a missed streak retroactively.
  insert into public.producer_work_schedules(agent_id, effective_on, selling_days, created_by)
  values (p_agent_id, v_effective, v_days, auth.uid())
  on conflict (agent_id, effective_on) do update
    set selling_days = excluded.selling_days, created_by = excluded.created_by, created_at = now();
  return jsonb_build_object('effective_on', v_effective, 'selling_days', v_days);
end $$;
revoke all on function public.producer_set_work_schedule(uuid, integer[]) from public, anon;
grant execute on function public.producer_set_work_schedule(uuid, integer[]) to authenticated;

create or replace function public.producer_month_workspace(p_agent_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_start date; v_end date; v_goal numeric := 20000; v_goal_source text := 'agency_standard';
  v_result jsonb;
begin
  if not public.producer_can_access_agent(p_agent_id) then
    raise exception 'Producer not found or access denied' using errcode = '42501';
  end if;
  v_start := date_trunc('month', v_today)::date;
  v_end := (v_start + interval '1 month - 1 day')::date;
  select greatest(20000, g.personal_ap_goal), 'assigned_personal_goal'
    into v_goal, v_goal_source
    from public.team_goals g
   where g.agent_id = p_agent_id and g.period_start = v_start and g.period_end = v_end
     and g.personal_ap_goal > 0 limit 1;
  v_goal := coalesce(v_goal, 20000);
  v_goal_source := coalesce(v_goal_source, 'agency_standard');

  with production as materialized (
    select p.* from public.v_production_canonical p
      join public.agents pa on pa.id = p.agent_id
     where coalesce(pa.canonical_agent_id,pa.id) = p_agent_id and p.posted_date between v_today - 179 and v_today
  ), day_plan as (
    select d::date as day,
      extract(dow from d)::integer = any(coalesce((
        select s.selling_days from public.producer_work_schedules s
         where s.agent_id = p_agent_id and s.effective_on <= d::date
         order by s.effective_on desc limit 1
      ), array[1,2,3,4,5])) as scheduled
      from generate_series((v_today - 179)::timestamp, v_end::timestamp, interval '1 day') d
  ), production_days as (
    select posted_date as day, sum(annual_premium) as ap, count(*) as deals
      from production where annual_premium > 0 group by posted_date
  ), activity_events as materialized (
    -- Provider receipts only. Multiple imports of one provider event count once.
    select distinct on (coalesce(nullif(c.external_call_id, ''), c.id::text))
      coalesce(nullif(c.external_call_id, ''), c.id::text) as event_key,
      (c.call_started_at at time zone 'America/Phoenix')::date as day,
      c.disposition
      from public.readymode_dialer_calls c
      join public.agents a on a.id = c.agent_id
     where coalesce(a.canonical_agent_id, a.id) = p_agent_id
       and c.call_started_at >= ((v_today - 60)::timestamp at time zone 'America/Phoenix')
       and c.call_started_at < ((v_today + 1)::timestamp at time zone 'America/Phoenix')
       and c.call_ended_at is not null and c.duration_seconds > 0
       and nullif(btrim(c.disposition), '') is not null
     order by coalesce(nullif(c.external_call_id, ''), c.id::text), c.updated_at desc
  ), activity as (
    select count(*) filter (where day < v_today) as sample_calls,
      count(*) filter (where day < v_today and disposition = 'Completed Sale') as sample_sold_calls,
      count(*) filter (where day = v_today) as completed_today,
      count(*) filter (where day = v_today and disposition = 'Completed Sale') as sold_calls_today
      from activity_events
  ), policy_baseline as (
    select count(*) as sample_policies, avg(annual_premium) as avg_policy_ap
      from production where posted_date >= v_today - 60 and posted_date < v_today and annual_premium > 0
  ), monthly as (
    select coalesce(sum(annual_premium),0) as ap, count(*) as deals,
      max(synced_at) as source_updated_at
      from production where posted_date >= v_start and annual_premium > 0
  ), month_schedule as (
    select count(*) filter (where scheduled and day >= v_start) as total_days,
      count(*) filter (where scheduled and day between v_start and v_today) as elapsed_days,
      count(*) filter (where scheduled and day >= v_today) as remaining_days
      from day_plan
  ), carrier as (
    -- These are carrier-book subsets, never invented payment/retention evidence.
    select count(*) as known_policies,
      coalesce(sum(p.annual_premium) filter (
        where p.status_bucket = 'active' and p.sold_on between v_start and v_today
      ),0) as in_force_month_ap,
      count(*) filter (
        where p.status_bucket = 'active' and p.last_seen_on is not null
          and p.effective_on <= least(v_today,p.last_seen_on) - 90
      ) as active_90d_policies,
      max(p.updated_at) as updated_at,
      min(p.last_seen_on) as oldest_seen_on
      from public.carrier_book_policies p
      join public.agents a on a.id = p.agent_id
     where coalesce(a.canonical_agent_id, a.id) = p_agent_id
  )
  select jsonb_build_object(
    'agent_id', p_agent_id, 'today', v_today, 'period_start', v_start, 'period_end', v_end,
    'as_of', now(), 'timezone', 'America/Phoenix', 'target_ap', v_goal, 'target_source', v_goal_source,
    'production_ap', m.ap, 'production_deals', m.deals, 'production_updated_at', m.source_updated_at,
    'selling_days_total', s.total_days, 'selling_days_elapsed', s.elapsed_days, 'selling_days_remaining', s.remaining_days,
    'schedule', coalesce((select selling_days from public.producer_work_schedules where agent_id = p_agent_id and effective_on <= v_today order by effective_on desc limit 1), array[1,2,3,4,5]),
    'next_schedule', (select jsonb_build_object('effective_on', effective_on, 'selling_days', selling_days) from public.producer_work_schedules where agent_id = p_agent_id and effective_on > v_today order by effective_on limit 1),
    'activity', jsonb_build_object('sample_days', 60, 'sample_calls', a.sample_calls,
      'sample_sold_calls', a.sample_sold_calls, 'sample_policies', b.sample_policies,
      'avg_policy_ap', b.avg_policy_ap, 'completed_today', a.completed_today, 'sold_calls_today', a.sold_calls_today),
    'carrier', jsonb_build_object('covered_policies', c.known_policies,
      'in_force_month_ap', case when c.known_policies > 0 then c.in_force_month_ap end,
      'active_90d_policies', case when c.known_policies > 0 then c.active_90d_policies end,
      'updated_at', c.updated_at, 'oldest_seen_on', c.oldest_seen_on,
      'paid_ap', null, 'paid_reason', 'No verified payment receipt is supplied by this view'),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day, 'scheduled', d.scheduled, 'production_ap', coalesce(p.ap,0), 'deals', coalesce(p.deals,0)
    ) order by d.day), '[]'::jsonb) from day_plan d left join production_days p on p.day = d.day where d.day <= v_today)
  ) into v_result from monthly m cross join month_schedule s cross join activity a cross join policy_baseline b cross join carrier c;
  return v_result;
end $$;
revoke all on function public.producer_month_workspace(uuid) from public, anon;
grant execute on function public.producer_month_workspace(uuid) to authenticated;

comment on function public.producer_month_workspace(uuid) is
  'Personal canonical production only; team sales and ReadyMode sale dispositions never add to ALP. Carrier in-force and 90-day-active counts are explicitly partial carrier-book evidence, not payment receipts. Workday production streak inputs include rest days and retain historical schedules.';
