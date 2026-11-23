-- MP-WIN-POSTS (2026-11-23): win_post_feed() powers the /awards Win Post Studio.
-- One admin-gated jsonb RPC returning everything the studio needs to render
-- downloadable Win/Trophy cards: recent agent-day wins + detected trophies.
--
-- Rules live HERE, in code — the AI/caption layer never decides what counts
-- (Sam: "I don't want it to make the mistake of thinking average really is an
-- achievement"). Thresholds are the Trophy Engine starting numbers:
--   wins floor  : agent-day >= $1,500 ALP or >= 2 deals (tier S >=10k, A >=5k, else B)
--   first_deal  : agent's first-ever submitted deal (A); day_one if within
--                 24h of contracted_at (S)
--   club_20k/50k: calendar-month ALP >= $20k (A) / >= $50k (S)
--   fast_start  : >= $25k ALP within 30 days of contracting (A)
--   sixty_day   : >= $75k ALP within 60 days of contracting (S)
--   hiring_blitz: manager with 5+ contracted hires inside any 48h window (S)
--   team_100k   : manager tree >= $100k calendar-month ALP (S) — agency root
--                 (no upline) excluded or it is a permanent trophy
--   first_on_board: today's earliest daily_production entry (B)
-- Trophies dedupe to the highest-priority one per agent ("only the highest
-- one posts"). Production truth = v_production_canonical.posted_date (never
-- agentlink_book). No client PII is selected anywhere in this function.

create or replace function public.win_post_feed(p_days integer default 14)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := (select auth.uid());
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_from date;
  v_month_start date;
  v_wins jsonb := '[]'::jsonb;
  v_trophies jsonb := '[]'::jsonb;
begin
  if not (public.is_sam() or public.has_role(v_caller, 'admin'::public.app_role)) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  v_from := v_today - greatest(least(coalesce(p_days, 14), 60), 1);
  v_month_start := date_trunc('month', v_today)::date;

  -- ---------------------------------------------------------------- WINS
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
      -- single-row identity resolution: award override -> linked profile ->
      -- user profile. Scalar subqueries with LIMIT 1 on purpose: a duplicate
      -- profiles.user_id row must not fan out or null the whole read
      -- (the MP-275 ambiguity-reads-as-absence class).
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

  -- ------------------------------------------------------------ TROPHIES
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
    -- FIRST DEAL / DAY ONE
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
    -- $20K / $50K CLUB (calendar month)
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
    -- FAST START ($25k/30d) or 60-DAY RUN ($75k/60d)
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
    -- HIRING BLITZ (manager: 5+ contracted hires inside 48h)
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
    -- TEAM $100K MONTH (manager tree; agency root excluded — always-on otherwise)
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
    -- FIRST ON THE BOARD (today's earliest logged production)
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

revoke all on function public.win_post_feed(integer) from public, anon;
grant execute on function public.win_post_feed(integer) to authenticated;
