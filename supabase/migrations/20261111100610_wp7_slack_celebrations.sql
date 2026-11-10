-- WP7 (onboarding audit 2026-11-10): the momentum moments that only ever
-- existed on Discord (first deal, MTD milestone tiers, weekly leaderboard) now
-- go to Slack through the receipted outbox, from the canonical production
-- source (mat_production_unified, never agentlink_book).
--
-- FORWARD ONLY. The migration runs fn_enqueue_production_celebrations(true)
-- once, which BASELINES every first deal and every tier already crossed this
-- month into the ledger and sends nothing. After that, only producers who
-- ENTER a state (a first-ever production row, a new tier crossing) are posted.
-- A first row older than 14 days is recorded 'skipped', never celebrated late.
--
-- Templates (apex-outbox-dispatcher/slack-event-templates.ts) read a FIRST
-- NAME, a product category and dollars. Never client data.
--
-- Applied live by WP7, recorded in supabase_migrations.schema_migrations.

create table if not exists public.channel_celebration_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('first_deal', 'mtd_milestone', 'weekly_leaderboard')),
  subject_key text not null,            -- canonical agent id, or 'org'
  period_key text not null,             -- 'all' | 'YYYY-MM' | week start 'YYYY-MM-DD'
  tier integer not null default 0,
  state text not null check (state in ('baseline', 'enqueued', 'skipped')),
  reason text,
  outbox_event_id uuid,
  created_at timestamptz not null default now(),
  unique (kind, subject_key, period_key, tier)
);
alter table public.channel_celebration_ledger enable row level security;
revoke all on public.channel_celebration_ledger from anon, authenticated;
grant select, insert, update on public.channel_celebration_ledger to service_role;
drop policy if exists channel_celebration_ledger_admin_read on public.channel_celebration_ledger;
create policy channel_celebration_ledger_admin_read on public.channel_celebration_ledger
  for select to authenticated using (public.apex_is_admin());
grant select on public.channel_celebration_ledger to authenticated;

create or replace function public.fn_enqueue_production_celebrations(p_seed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date := date_trunc('month', (now() at time zone 'America/Phoenix'))::date;
  v_month_key text := to_char((now() at time zone 'America/Phoenix'), 'YYYY-MM');
  v_month_label text := to_char((now() at time zone 'America/Phoenix'), 'Mon YYYY');
  v_first_enqueued integer := 0;
  v_first_baseline integer := 0;
  v_first_skipped integer := 0;
  v_tier_enqueued integer := 0;
  v_tier_baseline integer := 0;
  v_tier_skipped integer := 0;
  v_event_id uuid;
  v_new_tiers integer[];
  v_top integer;
  v_t integer;
  v_eligible boolean;
  r record;
begin
  if coalesce(auth.role(), '') not in ('service_role', '') and not coalesce(public.apex_is_admin(), false) then
    raise exception 'service role or admin required' using errcode = '42501';
  end if;

  -- ---- first deals ----------------------------------------------------------
  for r in
    with prod as (
      select coalesce(public.fn_canonical_agent_id(m.agent_id), m.agent_id) as agent_id,
             m.posted_date, m.annual_premium, m.product, m.row_key
      from public.mat_production_unified m
      where m.agent_id is not null and m.posted_date is not null
        and lower(coalesce(m.status, '')) not in
            ('lapsed', 'cancelled', 'canceled', 'charged_back', 'chargeback', 'withdrawn', 'not_taken', 'declined', 'terminated')
    ), firsts as (
      select distinct on (agent_id) agent_id, posted_date, annual_premium, product
      from prod
      order by agent_id, posted_date, row_key
    )
    select f.*, a.display_name, a.status::text as agent_status,
           coalesce(a.is_deactivated, false) as is_deactivated,
           coalesce(a.is_inactive, false) as is_inactive
    from firsts f
    join public.agents a on a.id = f.agent_id
    where not exists (
      select 1 from public.channel_celebration_ledger l
      where l.kind = 'first_deal' and l.subject_key = f.agent_id::text and l.period_key = 'all' and l.tier = 0)
  loop
    v_eligible := r.agent_status = 'active' and not r.is_deactivated and not r.is_inactive
                  and not public.fn_agent_is_roster_excluded(r.agent_id);
    if p_seed then
      insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, reason)
      values ('first_deal', r.agent_id::text, 'all', 0, 'baseline', 'seeded at deploy; never posted')
      on conflict do nothing;
      v_first_baseline := v_first_baseline + 1;
    elsif not v_eligible or r.posted_date < v_today - 14 then
      insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, reason)
      values ('first_deal', r.agent_id::text, 'all', 0, 'skipped',
              case when not v_eligible then 'agent not active or roster-excluded' else 'first row older than 14 days' end)
      on conflict do nothing;
      v_first_skipped := v_first_skipped + 1;
    else
      insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
      values ('agent', r.agent_id, 'production.first_deal', 'slack',
              jsonb_strip_nulls(jsonb_build_object(
                'agentFirstName', split_part(coalesce(nullif(btrim(r.display_name), ''), 'A new producer'), ' ', 1),
                'productCategory', nullif(btrim(coalesce(r.product, '')), ''),
                'annualPremium', r.annual_premium,
                'openUrl', 'https://apex-financial.org/dashboard/production')),
              'production.first_deal:' || r.agent_id::text || ':slack', gen_random_uuid())
      on conflict (idempotency_key) do nothing
      returning id into v_event_id;
      insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, outbox_event_id)
      values ('first_deal', r.agent_id::text, 'all', 0, 'enqueued', v_event_id)
      on conflict do nothing;
      v_first_enqueued := v_first_enqueued + 1;
    end if;
  end loop;

  -- ---- month-to-date tiers (highest NEW tier per agent per run) -------------
  for r in
    with prod as (
      select coalesce(public.fn_canonical_agent_id(m.agent_id), m.agent_id) as agent_id, m.annual_premium
      from public.mat_production_unified m
      where m.agent_id is not null and m.posted_date >= v_month_start and m.posted_date <= v_today
        and lower(coalesce(m.status, '')) not in
            ('lapsed', 'cancelled', 'canceled', 'charged_back', 'chargeback', 'withdrawn', 'not_taken', 'declined', 'terminated')
    ), mtd as (
      select agent_id, sum(annual_premium) as alp from prod group by agent_id having sum(annual_premium) >= 25000
    )
    select m.agent_id, m.alp, a.display_name, a.status::text as agent_status,
           coalesce(a.is_deactivated, false) as is_deactivated,
           coalesce(a.is_inactive, false) as is_inactive
    from mtd m join public.agents a on a.id = m.agent_id
  loop
    select array_agg(t order by t) into v_new_tiers
    from unnest(array[25000, 40000, 75000, 100000]) t
    where r.alp >= t
      and not exists (
        select 1 from public.channel_celebration_ledger l
        where l.kind = 'mtd_milestone' and l.subject_key = r.agent_id::text
          and l.period_key = v_month_key and l.tier = t);
    if v_new_tiers is null then continue; end if;
    v_top := v_new_tiers[array_length(v_new_tiers, 1)];
    v_eligible := r.agent_status = 'active' and not r.is_deactivated and not r.is_inactive
                  and not public.fn_agent_is_roster_excluded(r.agent_id);
    foreach v_t in array v_new_tiers loop
      if p_seed then
        insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, reason)
        values ('mtd_milestone', r.agent_id::text, v_month_key, v_t, 'baseline', 'seeded at deploy; never posted')
        on conflict do nothing;
        v_tier_baseline := v_tier_baseline + 1;
      elsif v_t <> v_top or not v_eligible then
        insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, reason)
        values ('mtd_milestone', r.agent_id::text, v_month_key, v_t, 'skipped',
                case when not v_eligible then 'agent not active or roster-excluded' else 'superseded by a higher tier in the same run' end)
        on conflict do nothing;
        v_tier_skipped := v_tier_skipped + 1;
      else
        v_event_id := null;
        insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
        values ('agent', r.agent_id, 'production.mtd_milestone', 'slack',
                jsonb_build_object(
                  'agentFirstName', split_part(coalesce(nullif(btrim(r.display_name), ''), 'A producer'), ' ', 1),
                  'tier', v_t,
                  'monthLabel', v_month_label,
                  'openUrl', 'https://apex-financial.org/dashboard/production'),
                'production.mtd_milestone:' || r.agent_id::text || ':' || v_month_key || ':' || v_t::text || ':slack',
                gen_random_uuid())
        on conflict (idempotency_key) do nothing
        returning id into v_event_id;
        insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, outbox_event_id)
        values ('mtd_milestone', r.agent_id::text, v_month_key, v_t, 'enqueued', v_event_id)
        on conflict do nothing;
        v_tier_enqueued := v_tier_enqueued + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'seed', p_seed,
    'first_deal', jsonb_build_object('enqueued', v_first_enqueued, 'baseline', v_first_baseline, 'skipped', v_first_skipped),
    'mtd_milestone', jsonb_build_object('enqueued', v_tier_enqueued, 'baseline', v_tier_baseline, 'skipped', v_tier_skipped),
    'month', v_month_key);
end;
$function$;
revoke all on function public.fn_enqueue_production_celebrations(boolean) from public, anon, authenticated;
grant execute on function public.fn_enqueue_production_celebrations(boolean) to service_role;

create or replace function public.fn_enqueue_weekly_leaderboard(p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_start date := coalesce(p_week_start, date_trunc('week', v_today)::date - 7);  -- last completed Mon-Sun
  v_end date;
  v_entries jsonb;
  v_event_id uuid;
begin
  if coalesce(auth.role(), '') not in ('service_role', '') and not coalesce(public.apex_is_admin(), false) then
    raise exception 'service role or admin required' using errcode = '42501';
  end if;
  v_end := v_start + 6;
  if v_end >= v_today then
    return jsonb_build_object('ok', false, 'reason', 'week not complete', 'week_start', v_start);
  end if;
  if exists (select 1 from public.channel_celebration_ledger l
             where l.kind = 'weekly_leaderboard' and l.subject_key = 'org' and l.period_key = v_start::text) then
    return jsonb_build_object('ok', true, 'reason', 'already handled', 'week_start', v_start);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('rank', rnk, 'firstName', first_name, 'alp', round(alp)) order by rnk), '[]'::jsonb)
    into v_entries
  from (
    select row_number() over (order by sum(m.annual_premium) desc) as rnk,
           split_part(coalesce(nullif(btrim(a.display_name), ''), 'Galaxy producer'), ' ', 1) as first_name,
           sum(m.annual_premium) as alp
    from public.mat_production_unified m
    join public.agents a on a.id = coalesce(public.fn_canonical_agent_id(m.agent_id), m.agent_id)
    where m.posted_date between v_start and v_end
      and lower(coalesce(m.status, '')) not in
          ('lapsed', 'cancelled', 'canceled', 'charged_back', 'chargeback', 'withdrawn', 'not_taken', 'declined', 'terminated')
      and a.status::text = 'active'
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false
      and not public.fn_agent_is_roster_excluded(a.id)
    group by a.id, a.display_name
    having sum(m.annual_premium) > 0
    order by sum(m.annual_premium) desc
    limit 5
  ) t;

  if jsonb_array_length(v_entries) = 0 then
    insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, reason)
    values ('weekly_leaderboard', 'org', v_start::text, 0, 'skipped', 'no posted production that week')
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'reason', 'no production', 'week_start', v_start);
  end if;

  insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
  values ('leaderboard', md5('leaderboard.weekly:' || v_start::text)::uuid, 'leaderboard.weekly', 'slack',
          jsonb_build_object(
            'weekLabel', to_char(v_start, 'Mon FMDD') || ' – ' || to_char(v_end, 'Mon FMDD'),
            'entries', v_entries,
            'openUrl', 'https://apex-financial.org/dashboard/production'),
          'leaderboard.weekly:' || v_start::text || ':slack', gen_random_uuid())
  on conflict (idempotency_key) do nothing
  returning id into v_event_id;
  insert into public.channel_celebration_ledger(kind, subject_key, period_key, tier, state, outbox_event_id)
  values ('weekly_leaderboard', 'org', v_start::text, 0, 'enqueued', v_event_id)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'week_start', v_start, 'entries', jsonb_array_length(v_entries), 'outbox_event_id', v_event_id);
end;
$function$;
revoke all on function public.fn_enqueue_weekly_leaderboard(date) from public, anon, authenticated;
grant execute on function public.fn_enqueue_weekly_leaderboard(date) to service_role;

-- Routes. First deals also go to #unlicensed (social proof for recruits, same
-- as deal.posted); the leaderboard also goes to #general.
insert into public.messaging_route_rules(installation_id, event_type, destination_id, audience_scope, priority, is_enabled)
select '92872a3c-5c16-4543-8f31-73ffbf4aef58'::uuid, v.event_type, v.destination_id::uuid, 'organization', v.priority::smallint, true
from (values
  ('production.first_deal',    '3495845d-9b3d-4f5c-a5ea-ab9ff8baba44', 2),  -- #apex-sales-wins
  ('production.first_deal',    '50f541c1-f9ae-447c-a6ec-240d84a3ac76', 5),  -- #unlicensed
  ('production.mtd_milestone', '3495845d-9b3d-4f5c-a5ea-ab9ff8baba44', 2),  -- #apex-sales-wins
  ('leaderboard.weekly',       '3495845d-9b3d-4f5c-a5ea-ab9ff8baba44', 2),  -- #apex-sales-wins
  ('leaderboard.weekly',       '034e72d5-8b2f-46b6-bee6-c4323398eca7', 5)   -- #general
) v(event_type, destination_id, priority)
where exists (select 1 from public.messaging_destinations d where d.id = v.destination_id::uuid and d.is_enabled)
on conflict (installation_id, event_type, destination_id, audience_scope) do nothing;

-- Baseline (sends nothing). Only on first apply: a re-apply finds rows.
do $$
begin
  if not exists (select 1 from public.channel_celebration_ledger where state = 'baseline') then
    perform public.fn_enqueue_production_celebrations(true);
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'apex-production-celebrations-slack') then
    perform cron.unschedule('apex-production-celebrations-slack');
  end if;
  perform cron.schedule('apex-production-celebrations-slack', '*/10 * * * *',
    $cmd$select public.fn_enqueue_production_celebrations(false);$cmd$);
  if exists (select 1 from cron.job where jobname = 'apex-weekly-leaderboard-slack') then
    perform cron.unschedule('apex-weekly-leaderboard-slack');
  end if;
  -- Mondays 15:00 UTC = 08:00 Phoenix, covering the previous Mon-Sun.
  perform cron.schedule('apex-weekly-leaderboard-slack', '0 15 * * 1',
    $cmd$select public.fn_enqueue_weekly_leaderboard(null);$cmd$);
end $$;
