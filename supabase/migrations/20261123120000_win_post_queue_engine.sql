-- MP-WIN-POSTS.2 (2026-11-23): the automation wave of the Win Post Studio.
-- Detection now runs ITSELF: an hourly pg_cron job computes the same feed the
-- studio shows, upserts NEW qualifying events into win_post_queue (stable
-- event keys = natural dedupe), auto-archives queued events that no longer
-- qualify on re-detect (deal rollback QA), and sends ONE ntfy digest per run
-- only when something new crossed the S/A bar — never a storm. Sam approves /
-- holds / marks posted from the studio's Queue tab. Live auto-publishing to
-- Instagram is deliberately NOT here: it lands when the account is connected,
-- consuming the approved queue.
--
-- Pattern: fn_win_post_feed_compute() is the gate-free twin of win_post_feed()
-- (same split as apex_admin_operations_snapshot_compute, MP-PERF-OPS) so the
-- cron can detect without a JWT while the client RPC keeps its admin gate.

-- ------------------------------------------------------------------ queue
create table if not exists public.win_post_queue (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  kind text not null check (kind in ('win','trophy')),
  trophy text,
  tier text not null check (tier in ('S','A','B')),
  agent_id uuid,
  agent_name text,
  event_date date not null,
  payload jsonb not null,
  detected_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued','approved','held','posted','archived')),
  decided_at timestamptz,
  decided_by uuid,
  posted_at timestamptz,
  note text
);

-- RLS on, no policies: the table is reachable only through the definer RPCs
-- below (PostgREST .from() reads return nothing for every role).
alter table public.win_post_queue enable row level security;

create index if not exists idx_win_post_queue_status on public.win_post_queue (status);
create index if not exists idx_win_post_queue_agent on public.win_post_queue (agent_id) where agent_id is not null;
create index if not exists idx_win_post_queue_posted on public.win_post_queue (posted_at) where posted_at is not null;

-- --------------------------------------------- gate-free compute twin
create or replace function public.fn_win_post_feed_compute(p_days integer default 14)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_from date;
  v_month_start date;
  v_wins jsonb := '[]'::jsonb;
  v_trophies jsonb := '[]'::jsonb;
begin
  v_from := v_today - greatest(least(coalesce(p_days, 14), 60), 1);
  v_month_start := date_trunc('month', v_today)::date;

  select coalesce(jsonb_agg(w order by (w ->> 'date') desc, (w ->> 'alp')::numeric desc), '[]'::jsonb)
  into v_wins
  from (
    select jsonb_build_object(
      'kind', 'win',
      'date', p.posted_date,
      'tier', case when p.alp >= 10000 then 'S' when p.alp >= 5000 then 'A' else 'B' end,
      'agent_id', p.agent_id,
      'agent_name', idn.name,
      'photo_url', idn.photo,
      'instagram_handle', idn.ig,
      'alp', round(p.alp, 2),
      'deals', p.deals,
      'avg_alp', round(p.alp / greatest(p.deals, 1), 0),
      'carrier', p.top_carrier,
      'product', p.top_product
    ) as w
    from (
      select m.agent_id, m.posted_date,
             sum(m.annual_premium) as alp,
             count(*) as deals,
             (array_agg(m.carrier order by m.annual_premium desc nulls last))[1] as top_carrier,
             (array_agg(m.product order by m.annual_premium desc nulls last))[1] as top_product
      from public.v_production_canonical m
      where m.posted_date between v_from and v_today
        and m.agent_id is not null
      group by m.agent_id, m.posted_date
    ) p
    join public.agents a on a.id = p.agent_id
    cross join lateral (
      select
        coalesce(
          nullif((select x.display_name_override from public.agent_award_profiles x where x.agent_id = a.id limit 1), ''),
          nullif(a.display_name, ''),
          (select pp.full_name from public.profiles pp where pp.id = a.profile_id limit 1),
          (select pu.full_name from public.profiles pu where pu.user_id = a.user_id limit 1),
          'Galaxy Agent') as name,
        coalesce(
          nullif((select x.photo_url from public.agent_award_profiles x where x.agent_id = a.id limit 1), ''),
          (select coalesce(nullif(pp.avatar_url, ''), nullif(pp.photo_url, '')) from public.profiles pp where pp.id = a.profile_id limit 1),
          (select coalesce(nullif(pu.avatar_url, ''), nullif(pu.photo_url, '')) from public.profiles pu where pu.user_id = a.user_id limit 1)) as photo,
        coalesce(
          nullif((select x.instagram_handle from public.agent_award_profiles x where x.agent_id = a.id limit 1), ''),
          (select nullif(pp.instagram_handle, '') from public.profiles pp where pp.id = a.profile_id limit 1),
          (select nullif(pu.instagram_handle, '') from public.profiles pu where pu.user_id = a.user_id limit 1)) as ig
    ) idn
    where p.alp >= 1500 or p.deals >= 2
  ) q;

  with firsts as (
    select agent_id, min(posted_date) as fd
    from public.v_production_canonical
    where agent_id is not null
    group by agent_id
    having min(posted_date) >= v_from
  ),
  first_day as (
    select f.agent_id, f.fd, sum(m.annual_premium) as alp, count(*) as deals
    from firsts f
    join public.v_production_canonical m on m.agent_id = f.agent_id and m.posted_date = f.fd
    group by f.agent_id, f.fd
  ),
  month_tot as (
    select agent_id, sum(annual_premium) as alp, count(*) as deals
    from public.v_production_canonical
    where posted_date between v_month_start and v_today
      and agent_id is not null
    group by agent_id
  ),
  fresh as (
    select a.id as agent_id, a.contracted_at::date as cd,
           sum(m.annual_premium) filter (where m.posted_date <= a.contracted_at::date + 30) as alp30,
           sum(m.annual_premium) filter (where m.posted_date <= a.contracted_at::date + 60) as alp60,
           count(*) filter (where m.posted_date <= a.contracted_at::date + 60) as deals60
    from public.agents a
    join public.v_production_canonical m
      on m.agent_id = a.id and m.posted_date >= a.contracted_at::date
    where a.contracted_at is not null
      and a.contracted_at >= now() - interval '120 days'
    group by a.id, a.contracted_at::date
  ),
  hires as (
    select coalesce(a.manager_id, a.invited_by_manager_id) as mgr, a.contracted_at
    from public.agents a
    where a.contracted_at is not null
      and a.contracted_at >= now() - interval '120 days'
      and coalesce(a.manager_id, a.invited_by_manager_id) is not null
  ),
  blitz as (
    select mgr, max(c) as hires_48, max(contracted_at) as last_at
    from (
      select mgr, contracted_at,
             count(*) over (partition by mgr order by contracted_at
                            range between interval '48 hours' preceding and current row) as c
      from hires
    ) w
    where c >= 5 and contracted_at >= v_from::timestamptz
    group by mgr
  ),
  team_month as (
    select h.root as mgr, sum(m.annual_premium) as alp, count(*) as deals
    from public.mv_hierarchy_hops h
    join public.v_production_canonical m
      on m.agent_id = h.member and m.posted_date between v_month_start and v_today
    group by h.root
  ),
  team_total as (
    select t.mgr,
           t.alp + coalesce(s.alp, 0) as alp,
           t.deals + coalesce(s.deals, 0) as deals
    from team_month t
    left join month_tot s on s.agent_id = t.mgr
  ),
  cand (agent_id, trophy, tier, pr, headline, subline, stats, dt) as (
    select fd.agent_id,
           case when a.contracted_at is not null and fd.fd <= a.contracted_at::date + 1 then 'day_one' else 'first_deal' end,
           case when a.contracted_at is not null and fd.fd <= a.contracted_at::date + 1 then 'S' else 'A' end,
           case when a.contracted_at is not null and fd.fd <= a.contracted_at::date + 1 then 40 else 25 end,
           case when a.contracted_at is not null and fd.fd <= a.contracted_at::date + 1 then 'DAY ONE DEAL' else 'FIRST DEAL' end,
           case when a.contracted_at is not null and fd.fd <= a.contracted_at::date + 1
                then 'First deal within 24 hrs of contracting' else 'First submitted deal with Galaxy' end,
           jsonb_build_array(
             jsonb_build_object('label', 'ALP that day', 'value', to_char(fd.alp, 'FM$999,999,990')),
             jsonb_build_object('label', 'Deals', 'value', fd.deals::text),
             jsonb_build_object('label', 'Date', 'value', to_char(fd.fd, 'Mon DD'))),
           fd.fd
    from first_day fd
    join public.agents a on a.id = fd.agent_id

    union all
    select mt.agent_id,
           case when mt.alp >= 50000 then 'club_50k' else 'club_20k' end,
           case when mt.alp >= 50000 then 'S' else 'A' end,
           case when mt.alp >= 50000 then 45 else 30 end,
           case when mt.alp >= 50000 then '$50K CLUB' else '$20K CLUB' end,
           to_char(v_today, 'FMMonth') || ' production club',
           jsonb_build_array(
             jsonb_build_object('label', 'Month ALP', 'value', to_char(mt.alp, 'FM$999,999,990')),
             jsonb_build_object('label', 'Deals', 'value', mt.deals::text),
             jsonb_build_object('label', 'Month', 'value', to_char(v_today, 'FMMonth YYYY'))),
           v_today
    from month_tot mt
    where mt.alp >= 20000

    union all
    select f.agent_id,
           case when coalesce(f.alp60, 0) >= 75000 then 'sixty_day_run' else 'fast_start' end,
           case when coalesce(f.alp60, 0) >= 75000 then 'S' else 'A' end,
           case when coalesce(f.alp60, 0) >= 75000 then 50 else 35 end,
           case when coalesce(f.alp60, 0) >= 75000 then '$75K IN 60 DAYS' else '$25K IN 30 DAYS' end,
           'Since contracting ' || to_char(f.cd, 'Mon DD'),
           jsonb_build_array(
             jsonb_build_object('label', 'ALP', 'value',
               to_char(case when coalesce(f.alp60, 0) >= 75000 then f.alp60 else f.alp30 end, 'FM$999,999,990')),
             jsonb_build_object('label', 'Deals', 'value', f.deals60::text),
             jsonb_build_object('label', 'Days in', 'value', least(v_today - f.cd, 60)::text)),
           v_today
    from fresh f
    where (coalesce(f.alp30, 0) >= 25000 or coalesce(f.alp60, 0) >= 75000)
      and f.cd + 60 >= v_from

    union all
    select b.mgr, 'hiring_blitz', 'S', 55,
           b.hires_48::text || ' HIRES IN 48 HRS',
           'Recruiting sprint',
           jsonb_build_array(
             jsonb_build_object('label', 'Hires', 'value', b.hires_48::text),
             jsonb_build_object('label', 'Window', 'value', '48 hours'),
             jsonb_build_object('label', 'Latest', 'value', to_char(b.last_at at time zone 'America/Phoenix', 'Mon DD'))),
           (b.last_at at time zone 'America/Phoenix')::date
    from blitz b

    union all
    select tt.mgr, 'team_100k', 'S', 60,
           'TEAM $100K MONTH',
           to_char(v_today, 'FMMonth') || ' team production',
           jsonb_build_array(
             jsonb_build_object('label', 'Team ALP', 'value', to_char(tt.alp, 'FM$999,999,990')),
             jsonb_build_object('label', 'Team deals', 'value', tt.deals::text),
             jsonb_build_object('label', 'Month', 'value', to_char(v_today, 'FMMonth YYYY'))),
           v_today
    from team_total tt
    join public.agents ma on ma.id = tt.mgr
      and coalesce(ma.is_manager, false)
      and ma.manager_id is not null
    where tt.alp >= 100000

    union all
    select dp.agent_id, 'first_on_board', 'B', 10,
           'FIRST ON THE BOARD',
           'First deal of the day',
           jsonb_build_array(
             jsonb_build_object('label', 'AOP', 'value', to_char(coalesce(dp.aop, 0), 'FM$999,999,990')),
             jsonb_build_object('label', 'Deals', 'value', dp.deals_closed::text),
             jsonb_build_object('label', 'Date', 'value', to_char(v_today, 'Mon DD'))),
           v_today
    from (
      select agent_id, aop, deals_closed
      from public.daily_production
      where production_date = v_today and deals_closed > 0 and agent_id is not null
      order by created_at asc
      limit 1
    ) dp
  ),
  best as (
    select distinct on (agent_id) *
    from cand
    order by agent_id, pr desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', 'trophy',
      'trophy', b.trophy,
      'tier', b.tier,
      'date', b.dt,
      'agent_id', b.agent_id,
      'agent_name', idn.name,
      'photo_url', idn.photo,
      'instagram_handle', idn.ig,
      'headline', b.headline,
      'subline', b.subline,
      'stats', b.stats
    ) order by case b.tier when 'S' then 3 when 'A' then 2 else 1 end desc, b.dt desc), '[]'::jsonb)
  into v_trophies
  from best b
  join public.agents a on a.id = b.agent_id
  cross join lateral (
    select
      coalesce(
        nullif((select x.display_name_override from public.agent_award_profiles x where x.agent_id = a.id limit 1), ''),
        nullif(a.display_name, ''),
        (select pp.full_name from public.profiles pp where pp.id = a.profile_id limit 1),
        (select pu.full_name from public.profiles pu where pu.user_id = a.user_id limit 1),
        'Galaxy Agent') as name,
      coalesce(
        nullif((select x.photo_url from public.agent_award_profiles x where x.agent_id = a.id limit 1), ''),
        (select coalesce(nullif(pp.avatar_url, ''), nullif(pp.photo_url, '')) from public.profiles pp where pp.id = a.profile_id limit 1),
        (select coalesce(nullif(pu.avatar_url, ''), nullif(pu.photo_url, '')) from public.profiles pu where pu.user_id = a.user_id limit 1)) as photo,
      coalesce(
        nullif((select x.instagram_handle from public.agent_award_profiles x where x.agent_id = a.id limit 1), ''),
        (select nullif(pp.instagram_handle, '') from public.profiles pp where pp.id = a.profile_id limit 1),
        (select nullif(pu.instagram_handle, '') from public.profiles pu where pu.user_id = a.user_id limit 1)) as ig
  ) idn;

  return jsonb_build_object(
    'as_of', now(),
    'period', jsonb_build_object('from', v_from, 'to', v_today),
    'wins', v_wins,
    'trophies', v_trophies
  );
end;
$function$;

revoke all on function public.fn_win_post_feed_compute(integer) from public, anon, authenticated;

-- ------------------------------------- win_post_feed becomes gate + twin
create or replace function public.win_post_feed(p_days integer default 14)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := (select auth.uid());
begin
  if not (public.is_sam() or public.has_role(v_caller, 'admin'::public.app_role)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return public.fn_win_post_feed_compute(p_days);
end;
$function$;

revoke all on function public.win_post_feed(integer) from public, anon;
grant execute on function public.win_post_feed(integer) to authenticated;

-- ------------------------------------------------------------- detection
create or replace function public.fn_win_post_detect(p_days integer default 14, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_feed jsonb;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_from date;
  v_ins integer := 0;
  v_upd integer := 0;
  v_arch integer := 0;
  v_new_sa_n integer := 0;
  v_new_sa text := null;
  v_notify_note text := 'nothing new';
begin
  v_from := v_today - greatest(least(coalesce(p_days, 14), 60), 1);
  v_feed := public.fn_win_post_feed_compute(p_days);

  drop table if exists _wpd_items;
  create temp table _wpd_items on commit drop as
  select
    e as item,
    e ->> 'kind' as kind,
    e ->> 'trophy' as trophy,
    e ->> 'tier' as tier,
    nullif(e ->> 'agent_id', '')::uuid as agent_id,
    e ->> 'agent_name' as agent_name,
    (e ->> 'date')::date as event_date,
    case
      when e ->> 'kind' = 'win' then 'win:' || (e ->> 'agent_id') || ':' || (e ->> 'date')
      when e ->> 'trophy' in ('club_20k', 'club_50k', 'team_100k')
        then (e ->> 'trophy') || ':' || (e ->> 'agent_id') || ':' || to_char((e ->> 'date')::date, 'YYYY-MM')
      when e ->> 'trophy' = 'hiring_blitz' then 'hiring_blitz:' || (e ->> 'agent_id') || ':' || (e ->> 'date')
      when e ->> 'trophy' = 'first_on_board' then 'first_on_board:' || (e ->> 'date')
      else (e ->> 'trophy') || ':' || (e ->> 'agent_id')
    end as event_key
  from jsonb_array_elements((v_feed -> 'wins') || (v_feed -> 'trophies')) e;

  -- upsert: new events insert; already-queued events get their payload
  -- refreshed (photo/IG coverage grows); approved/held/posted rows are never
  -- rewritten — what Sam approved stays what Sam approved.
  with ins as (
    insert into public.win_post_queue
      (event_key, kind, trophy, tier, agent_id, agent_name, event_date, payload)
    select event_key, kind, trophy, tier, agent_id, agent_name, event_date, item
    from _wpd_items
    on conflict (event_key) do update
      set payload = excluded.payload,
          tier = excluded.tier,
          agent_name = excluded.agent_name
      where win_post_queue.status = 'queued'
    returning (xmax = 0) as inserted, tier, agent_name, payload
  )
  select
    count(*) filter (where inserted),
    count(*) filter (where not inserted),
    count(*) filter (where inserted and tier in ('S', 'A')),
    string_agg(
      coalesce(payload ->> 'headline',
               '+' || to_char(coalesce((payload ->> 'alp')::numeric, 0), 'FM$999,999,990') || ' ALP') ||
      ' — ' || coalesce(agent_name, '—'), E'\n')
      filter (where inserted and tier in ('S', 'A'))
  into v_ins, v_upd, v_new_sa_n, v_new_sa
  from ins;

  -- rollback QA: a QUEUED event inside the window that no longer qualifies on
  -- re-detect (deal withdrawn, aggregate dropped below the bar) is archived,
  -- never silently deleted. Approved/posted rows are left for a human.
  update public.win_post_queue q
     set status = 'archived',
         decided_at = now(),
         note = 'auto: no longer qualifies on re-detect'
   where q.status = 'queued'
     and q.event_date between v_from and v_today
     and not exists (select 1 from _wpd_items i where i.event_key = q.event_key);
  get diagnostics v_arch = row_count;

  -- one digest per run, S/A only, plain-ASCII title (the MP-274 emoji-header
  -- lesson), failure never aborts detection (the alert-wave lesson).
  if p_notify and v_new_sa_n > 0 then
    begin
      perform net.http_post(
        url := 'https://ntfy.sh',
        body := jsonb_build_object(
          'topic', 'sams-agent-yrkv9kbqp9e987nb',
          'title', v_new_sa_n || ' new trophy post' || case when v_new_sa_n = 1 then '' else 's' end || ' ready',
          'message', v_new_sa || E'\n\nOpen the studio: approve, save, post.',
          'click', 'https://apex-financial.org/awards',
          'priority', 4,
          'tags', jsonb_build_array('trophy')
        )
      );
      v_notify_note := 'sent';
    exception when others then
      v_notify_note := 'ntfy failed: ' || sqlerrm;
    end;
  elsif v_new_sa_n > 0 then
    v_notify_note := 'suppressed (p_notify=false)';
  end if;

  return jsonb_build_object(
    'as_of', now(),
    'window', jsonb_build_object('from', v_from, 'to', v_today),
    'inserted', v_ins,
    'refreshed', v_upd,
    'archived', v_arch,
    'new_s_a', v_new_sa_n,
    'notify', v_notify_note
  );
end;
$function$;

revoke all on function public.fn_win_post_detect(integer, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ board
create or replace function public.win_post_queue_board()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := (select auth.uid());
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_rows jsonb;
  v_picks jsonb;
  v_counts jsonb;
  v_posted_today integer := 0;
begin
  if not (public.is_sam() or public.has_role(v_caller, 'admin'::public.app_role)) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'event_key', q.event_key, 'kind', q.kind, 'trophy', q.trophy,
      'tier', q.tier, 'status', q.status, 'event_date', q.event_date,
      'agent_name', q.agent_name, 'detected_at', q.detected_at,
      'posted_at', q.posted_at, 'note', q.note, 'payload', q.payload)
    order by case q.status when 'approved' then 0 when 'queued' then 1 when 'held' then 2 else 3 end,
             case q.tier when 'S' then 0 when 'A' then 1 else 2 end,
             q.event_date desc), '[]'::jsonb)
  into v_rows
  from public.win_post_queue q
  where q.status in ('queued', 'approved', 'held')
     or (q.status = 'posted' and q.posted_at >= now() - interval '7 days');

  select count(*) into v_posted_today
  from public.win_post_queue
  where status = 'posted'
    and (posted_at at time zone 'America/Phoenix')::date = v_today;

  -- Today's picks = the anti-spam caps as a recommendation: max 2 feed posts
  -- per Phoenix day, one post per agent per rolling 7 days unless Tier S.
  with posted7 as (
    select agent_id from public.win_post_queue
    where status = 'posted' and posted_at >= now() - interval '7 days' and agent_id is not null
  ),
  elig as (
    select q.event_key, q.tier, q.event_date
    from public.win_post_queue q
    where q.status in ('queued', 'approved')
      and (q.tier = 'S' or q.agent_id is null
           or not exists (select 1 from posted7 p where p.agent_id = q.agent_id))
  )
  select coalesce(jsonb_agg(e.event_key), '[]'::jsonb)
  into v_picks
  from (
    select event_key
    from elig
    order by case tier when 'S' then 0 when 'A' then 1 else 2 end, event_date desc
    limit greatest(0, 2 - v_posted_today)
  ) e;

  select coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
  into v_counts
  from (select status as s, count(*) as n from public.win_post_queue group by status) c;

  return jsonb_build_object(
    'as_of', now(),
    'queue', v_rows,
    'picks', v_picks,
    'posted_today', v_posted_today,
    'counts', v_counts
  );
end;
$function$;

revoke all on function public.win_post_queue_board() from public, anon;
grant execute on function public.win_post_queue_board() to authenticated;

-- ----------------------------------------------------------------- decide
create or replace function public.win_post_queue_decide(p_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := (select auth.uid());
  v_row public.win_post_queue;
  v_new text;
begin
  if not (public.is_sam() or public.has_role(v_caller, 'admin'::public.app_role)) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select * into v_row from public.win_post_queue where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not found');
  end if;

  v_new := case p_action
    when 'approve' then 'approved'
    when 'hold' then 'held'
    when 'queue' then 'queued'
    when 'posted' then 'posted'
    when 'archive' then 'archived'
    else null
  end;
  if v_new is null then
    return jsonb_build_object('error', 'unknown action');
  end if;

  if v_row.status = 'posted' and v_new <> 'posted' then
    return jsonb_build_object('error', 'posted is terminal');
  end if;
  if v_new = 'posted' and v_row.status not in ('approved', 'posted') then
    return jsonb_build_object('error', 'approve before marking posted');
  end if;

  update public.win_post_queue
     set status = v_new,
         decided_at = now(),
         decided_by = v_caller,
         posted_at = case when v_new = 'posted' then coalesce(posted_at, now()) else posted_at end,
         note = coalesce(p_note, note)
   where id = p_id
   returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status, 'posted_at', v_row.posted_at);
end;
$function$;

revoke all on function public.win_post_queue_decide(uuid, text, text) from public, anon;
grant execute on function public.win_post_queue_decide(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------- cron
-- Hourly at :15, 07:15–19:15 Phoenix (14:15–02:15 UTC). Detection is a <1s
-- read; dedupe makes every run idempotent, so a replayed run costs nothing.
do $do$
begin
  begin
    perform cron.unschedule('apex-win-post-detect');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'apex-win-post-detect',
    '15 14-23,0-2 * * *',
    $cron$select public.fn_win_post_detect(14, true);$cron$
  );
end
$do$;
