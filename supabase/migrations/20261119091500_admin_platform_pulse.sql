-- MP-BEST-2 (2026-11-19): admin_platform_pulse() - is the platform doing its job?
--
-- Until today the only usage signal was auth.users.last_sign_in_at, which moves on a
-- fresh sign-in and never on a session that stays open. Measured against page views:
-- 80 people read "silent 7d+" on the team panel while 8 of them had been in the app that
-- week, and sign-in understated real activity by up to 62 days. Every page view has been
-- recorded in analytics_events since June; nothing read it back.
--
-- One admin-only jsonb, built from rows that already exist:
--   team      active agents split by "posted a deal in 30 days" x "opened the app in 30 days"
--   daily     agents in the app per day, 30 days (Phoenix calendar days)
--   agents    per-agent last seen, days active, top screen, phone share, deals posted,
--             and the leads they hold versus the leads they have never touched
--   pages     the screens people open, most used first
--   speed     how long the biggest element takes to appear, per screen (p75, 14 days)
--   leads     live packs: held, never touched, sold, warm
--   stability forced "loading the latest version" reloads and other crash screens
--
-- Deliberately NO dollar figures: production has its own canonical surfaces and a second
-- total that disagrees with the scoreboard is how the $2.34M phantom got in front of Sam.
--
-- Automation is excluded (user_agent ~ 'headless': 3,198 of 11,539 page views in 30 days
-- were verification sessions and the site watcher) and so are admins, so the owner's own
-- visits and persona checks never read as team adoption.
--
-- SECURITY DEFINER functions, never a definer view (2026-08-20). Two of them, the
-- established shape (20261119050000): admin_platform_pulse_compute() does the work, is
-- gate-free and callable by nobody but the database; admin_platform_pulse() is what the
-- app calls, refuses non-admins with 42501, and serves the one agency-wide answer from
-- the single-flight cache for five minutes (the compute reads 90 days of page views and
-- takes about three seconds; rpc_result_cache has RLS on and no client grants).

create or replace function public.admin_platform_pulse_compute()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $fn$
declare
  v jsonb;
begin
  with adm as (
    select user_id from public.user_roles where role = 'admin'::public.app_role
  ),
  roster as (
    select a.id as agent_id, a.user_id, a.display_name, a.license_status::text as license_status,
           a.onboarding_stage::text as stage, a.created_at as hired_at, m.display_name as manager_name
    from public.agents a
    left join public.agents m on m.id = a.manager_id
    where a.status::text = 'active'
      and coalesce(a.is_inactive, false) = false
      and coalesce(a.is_deactivated, false) = false
      and (a.user_id is null or a.user_id not in (select user_id from adm))
  ),
  pv as materialized (
    select e.user_id, e.created_at,
           (e.created_at at time zone 'America/Phoenix')::date as day,
           (coalesce(e.user_agent, '') ~* 'iphone|android|mobile') as phone,
           regexp_replace(regexp_replace(regexp_replace(
             split_part(coalesce(e.properties->>'path', e.url, ''), '?', 1),
             '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{22}', ':id', 'g'),
             '^/(r|hire|status|claim)/[^/]+', '/\1/:id'),
             '/[0-9]+(/|$)', '/:n\1', 'g') as path
    from public.analytics_events e
    where e.event_name = 'navigation.page_view'
      and e.user_id is not null
      and e.created_at > now() - interval '90 days'
      and coalesce(e.user_agent, '') !~* 'headless'
      and e.user_id not in (select user_id from adm)
  ),
  seen as (
    select user_id,
           max(created_at) as last_seen,
           count(*) filter (where created_at > now() - interval '7 days') as views_7d,
           count(*) filter (where created_at > now() - interval '30 days') as views_30d,
           count(distinct day) filter (where created_at > now() - interval '30 days') as days_30d,
           count(*) filter (where phone and created_at > now() - interval '30 days') as phone_views_30d,
           mode() within group (order by path) filter (where created_at > now() - interval '30 days') as top_page
    from pv
    group by user_id
  ),
  prod as (
    select agent_id, count(*) as deals_30d, max(posted_date) as last_deal
    from public.v_production_canonical
    where posted_date > current_date - 30
    group by agent_id
  ),
  live_items as (
    select i.id, i.status, i.status_at, g.user_id
    from public.lead_bundle_items i
    join public.lead_bundles b on b.id = i.bundle_id and b.archived_at is null
    join public.lead_bundle_grants g on g.bundle_id = b.id and g.revoked_at is null
    where i.removed_at is null
  ),
  leads as (
    select user_id,
           count(*) as held,
           count(*) filter (where status = 'new') as untouched,
           count(*) filter (where status = 'sold') as sold,
           count(*) filter (where status in ('callback', 'appointment')) as warm,
           max(status_at) filter (where status <> 'new') as last_worked
    from live_items
    group by user_id
  ),
  full_roster as (
    select r.agent_id, r.user_id, r.display_name, r.manager_name, r.license_status, r.stage, r.hired_at,
           s.last_seen,
           coalesce(s.views_7d, 0) as views_7d,
           coalesce(s.views_30d, 0) as views_30d,
           coalesce(s.days_30d, 0) as days_30d,
           coalesce(s.phone_views_30d, 0) as phone_views_30d,
           s.top_page,
           coalesce(p.deals_30d, 0) as deals_30d,
           p.last_deal,
           coalesce(l.held, 0) as leads_held,
           coalesce(l.untouched, 0) as leads_untouched,
           coalesce(l.sold, 0) as leads_sold,
           coalesce(l.warm, 0) as leads_warm,
           l.last_worked
    from roster r
    left join seen s on s.user_id = r.user_id
    left join prod p on p.agent_id = r.agent_id
    left join leads l on l.user_id = r.user_id
  ),
  team as (
    select count(*) as active_agents,
           count(*) filter (where user_id is not null) as with_login,
           count(*) filter (where views_7d > 0) as seen_7d,
           count(*) filter (where views_30d > 0) as seen_30d,
           count(*) filter (where last_seen is not null) as seen_90d,
           count(*) filter (where deals_30d > 0) as sold_30d,
           count(*) filter (where deals_30d > 0 and views_30d > 0) as selling_on_platform,
           count(*) filter (where deals_30d > 0 and views_30d = 0) as selling_off_platform,
           count(*) filter (where deals_30d = 0 and views_30d > 0) as on_platform_not_selling,
           count(*) filter (where deals_30d = 0 and views_30d = 0) as dark
    from full_roster
  ),
  days as (
    select generate_series(
             (now() at time zone 'America/Phoenix')::date - 29,
             (now() at time zone 'America/Phoenix')::date,
             interval '1 day')::date as day
  ),
  daily as (
    select d.day,
           count(distinct pv.user_id) filter (where pv.user_id in (select user_id from roster)) as agents
    from days d
    left join pv on pv.day = d.day
    group by d.day
  ),
  pages as (
    select path, count(*) as views, count(distinct user_id) as people, count(*) filter (where phone) as phone_views
    from pv
    where created_at > now() - interval '30 days' and path like '/%'
    group by path
    order by count(*) desc
    limit 30
  ),
  speed as (
    select regexp_replace(split_part(e.url, '?', 1), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{22}', ':id', 'g') as path,
           count(*) as samples,
           round((percentile_cont(0.75) within group (order by (e.properties->>'value')::numeric))::numeric) as p75_ms
    from public.analytics_events e
    where e.event_name = 'web_vital.LCP'
      and e.created_at > now() - interval '14 days'
      and e.properties->>'value' ~ '^[0-9]+(\.[0-9]+)?$'
      and coalesce(e.user_agent, '') !~* 'headless'
      and (e.url = '/' or e.url ~ '^/(dashboard|agent-portal|numbers|login)')
    group by 1
    having count(*) >= 15
    order by 3 desc
    limit 15
  ),
  lead_tot as (
    select count(distinct id) as held,
           count(distinct id) filter (where status = 'new') as untouched,
           count(distinct id) filter (where status <> 'new') as worked,
           count(distinct id) filter (where status = 'sold') as sold,
           count(distinct id) filter (where status in ('callback', 'appointment')) as warm,
           count(distinct user_id) as holders
    from live_items
  ),
  errs as (
    select user_id, created_at,
           (error_message ~ 'reading .default.|_result\.default|dynamically imported module|Loading chunk') as stale_build
    from public.error_logs
    where created_at > now() - interval '30 days'
  ),
  stab as (
    -- one reload is often logged twice (two lazy boundaries fail in the same render), so count per person per minute
    select count(distinct (coalesce(user_id::text, 'anon'), date_trunc('minute', created_at)))
             filter (where stale_build and created_at > now() - interval '7 days') as forced_reloads_7d,
           count(distinct user_id) filter (where stale_build and created_at > now() - interval '7 days') as forced_reload_people_7d,
           count(distinct (coalesce(user_id::text, 'anon'), date_trunc('minute', created_at))) filter (where stale_build) as forced_reloads_30d,
           count(*) filter (where not stale_build) as other_crashes_30d,
           count(distinct user_id) filter (where not stale_build) as other_crash_people_30d
    from errs
  )
  select jsonb_build_object(
    'generated_at', now(),
    'team', (select to_jsonb(t) from team t),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'agents', agents) order by day), '[]'::jsonb) from daily),
    'agents', (select coalesce(jsonb_agg(to_jsonb(f) order by f.last_seen desc nulls last, f.display_name), '[]'::jsonb) from full_roster f),
    'pages', (select coalesce(jsonb_agg(to_jsonb(p) order by p.views desc), '[]'::jsonb) from pages p),
    'speed', (select coalesce(jsonb_agg(to_jsonb(s) order by s.p75_ms desc), '[]'::jsonb) from speed s),
    'leads', (select to_jsonb(l) from lead_tot l),
    'stability', (select to_jsonb(s) from stab s)
  ) into v;

  return v;
end
$fn$;

revoke all on function public.admin_platform_pulse_compute() from public, anon, authenticated;

create or replace function public.admin_platform_pulse()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $wrap$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return public.fn_rpc_single_flight('admin_platform_pulse:global', 300,
    'select public.admin_platform_pulse_compute()');
end
$wrap$;

revoke all on function public.admin_platform_pulse() from public, anon;
grant execute on function public.admin_platform_pulse() to authenticated;

comment on function public.admin_platform_pulse() is
  'MP-BEST-2: admin-only platform usage pulse (real last-seen from page views, sellers x platform split, lead work rate, screen use, speed, forced reloads). No dollar figures by design.';
