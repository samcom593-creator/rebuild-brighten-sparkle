-- MP-337b: point the five CRM readers at the snapshot instead of re-deriving
-- the production union on every call.
--
-- Measured before, as the viewer Sam is: crm_agent_sales_pulse 6.2s,
-- crm_roster_segments 5.2s, crm_today_production 4.0s, crm_agent_roster 1.2s.
-- pg_stat_statements attributes 132 + 109 + 104 minutes of lifetime database
-- time to this class. v_production_unified is 1,427 rows — the cost is
-- recomputation, not volume.
--
-- Only the reference changes; every guard (crm_can_read_roster,
-- crm_can_read_agent_scope, apex_can_read_agent, fn_agent_is_roster_excluded,
-- apex_is_admin) is preserved verbatim, because these bodies were read back
-- from pg_proc and rewritten with a single substitution rather than retyped.
-- The scoreboard and finances stay on the live views: money surfaces keep
-- zero staleness, the CRM accepts up to 60 seconds.

begin;

CREATE OR REPLACE FUNCTION public.crm_agent_roster()
 RETURNS TABLE(agent_id uuid, full_name text, email text, phone text, avatar_url text, agent_code text, status text, is_deactivated boolean, is_inactive boolean, is_sync_only boolean, license_status text, license_progress text, onboarding_stage text, training_stage text, manager_id uuid, manager_name text, downline_count integer, contracts_total integer, contracts_active integer, mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer, lifetime_alp numeric, lifetime_deals integer, first_posted_date date, last_posted_date date, last_contacted_at timestamp with time zone, created_at timestamp with time zone, tenure_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with ph as (
  select (now() at time zone 'America/Phoenix')::date as today
),
win as (
  select today, date_trunc('month', today)::date as month_start,
         today - 29 as l30_start
  from ph
),
prod as (
  select b.agent_id,
         sum(b.annual_premium) filter (where b.posted_date >= w.month_start) as mtd_alp,
         count(*) filter (where b.posted_date >= w.month_start) as mtd_deals,
         sum(b.annual_premium) filter (where b.posted_date >= w.l30_start) as l30_alp,
         count(*) filter (where b.posted_date >= w.l30_start) as l30_deals,
         sum(b.annual_premium) as life_alp,
         count(*) as life_deals,
         min(b.posted_date) as first_posted,
         max(b.posted_date) as last_posted
  from public.mat_production_unified b
  cross join win w
  where b.agent_id is not null and b.posted_date is not null
  group by b.agent_id
),
ident as (
  select a.id,
         coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as full_name,
         coalesce(pu.email, pp.email) as email,
         coalesce(pu.phone, pp.phone) as phone,
         coalesce(pu.avatar_url, pp.avatar_url) as avatar_url
  from public.agents a
  left join public.profiles pu on pu.user_id = a.user_id
  left join public.profiles pp on pp.id = a.profile_id
),
prog as (
  select lower(btrim(ap.email)) as email_key,
         max(array_position(array[
           'unlicensed','course_purchased','finished_course','test_scheduled',
           'passed_test','fingerprints_done','waiting_fingerprints',
           'waiting_on_license','licensed'
         ], ap.license_progress::text)) as best_idx
  from public.applications ap
  where ap.email is not null and ap.terminated_at is null
  group by 1
),
contact as (
  select ap.assigned_agent_id as agent_id, max(ap.last_contacted_at) as last_contacted_at
  from public.applications ap
  where ap.assigned_agent_id is not null and ap.last_contacted_at is not null
  group by 1
),
downline as (
  select m.mid as agent_id, count(distinct m.child) as n
  from (
    select manager_id as mid, id as child from public.agents where manager_id is not null
    union
    select invited_by_manager_id, id from public.agents where invited_by_manager_id is not null
  ) m
  group by 1
),
contracts as (
  select c.agent_id, count(*)::int as total,
         count(*) filter (where lower(coalesce(c.status,'')) in ('active','approved','appointed'))::int as active
  from public.agentlink_contracts c
  where c.agent_id is not null
  group by 1
)
select
  a.id, i.full_name, i.email, i.phone, i.avatar_url, a.agent_code,
  a.status::text, coalesce(a.is_deactivated,false), coalesce(a.is_inactive,false),
  (a.agent_code like 'GHOST\_%' and a.user_id is null), a.license_status::text,
  case when a.license_status::text = 'licensed' then 'licensed'
       else (array[
         'unlicensed','course_purchased','finished_course','test_scheduled',
         'passed_test','fingerprints_done','waiting_fingerprints',
         'waiting_on_license','licensed'
       ])[pr.best_idx]
  end,
  a.onboarding_stage::text, ts.stage::text,
  coalesce(a.manager_id, a.invited_by_manager_id), mi.full_name,
  coalesce(dl.n,0)::int, coalesce(ct.total,0), coalesce(ct.active,0),
  coalesce(p.mtd_alp,0), coalesce(p.mtd_deals,0)::int,
  coalesce(p.l30_alp,0), coalesce(p.l30_deals,0)::int,
  coalesce(p.life_alp,0), coalesce(p.life_deals,0)::int,
  p.first_posted, p.last_posted, co.last_contacted_at, a.created_at,
  case when a.start_date is not null then ((select today from ph) - a.start_date)::int
       when a.created_at is not null then ((select today from ph) - (a.created_at at time zone 'America/Phoenix')::date)::int
       else null end
from public.agents a
join ident i on i.id = a.id
left join prod p on p.agent_id = a.id
left join prog pr on pr.email_key = lower(btrim(i.email))
left join contact co on co.agent_id = a.id
left join downline dl on dl.agent_id = a.id
left join contracts ct on ct.agent_id = a.id
left join public.v_agent_training_stage ts on ts.agent_id = a.id
left join ident mi on mi.id = coalesce(a.manager_id, a.invited_by_manager_id)
where public.crm_can_read_roster()
  and public.crm_can_read_agent_scope(a.id)
  and coalesce(a.is_inactive,false) = false
  and coalesce(a.is_deactivated,false) = false
  and not public.fn_agent_is_roster_excluded(a.id);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_agent_roster_unguarded(p_agent_id uuid)
 RETURNS TABLE(agent_id uuid, full_name text, email text, phone text, avatar_url text, agent_code text, status text, is_deactivated boolean, is_inactive boolean, is_sync_only boolean, license_status text, license_progress text, onboarding_stage text, training_stage text, manager_id uuid, manager_name text, downline_count integer, contracts_total integer, contracts_active integer, mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer, lifetime_alp numeric, lifetime_deals integer, first_posted_date date, last_posted_date date, last_contacted_at timestamp with time zone, created_at timestamp with time zone, tenure_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with ph as (select (now() at time zone 'America/Phoenix')::date as today),
win as (select today, date_trunc('month',today)::date as month_start, today - 29 as l30_start from ph),
p as (
  select sum(b.annual_premium) filter (where b.posted_date >= w.month_start) as mtd_alp,
         count(*) filter (where b.posted_date >= w.month_start) as mtd_deals,
         sum(b.annual_premium) filter (where b.posted_date >= w.l30_start) as l30_alp,
         count(*) filter (where b.posted_date >= w.l30_start) as l30_deals,
         sum(b.annual_premium) as life_alp, count(*) as life_deals,
         min(b.posted_date) as first_posted, max(b.posted_date) as last_posted
  from public.mat_production_unified b cross join win w
  where b.agent_id = p_agent_id and b.posted_date is not null
)
select a.id,
  coalesce(pu.full_name,pp.full_name,a.display_name,'(unnamed agent)'),
  coalesce(pu.email,pp.email), coalesce(pu.phone,pp.phone),
  coalesce(pu.avatar_url,pp.avatar_url), a.agent_code, a.status::text,
  coalesce(a.is_deactivated,false), coalesce(a.is_inactive,false),
  (a.agent_code like 'GHOST\_%' and a.user_id is null), a.license_status::text,
  case when a.license_status::text = 'licensed' then 'licensed' else (
    select ap.license_progress::text from public.applications ap
    where lower(btrim(ap.email)) = lower(btrim(coalesce(pu.email,pp.email)))
      and ap.terminated_at is null and ap.license_progress is not null
    order by array_position(array['unlicensed','course_purchased','finished_course','test_scheduled','passed_test','fingerprints_done','waiting_fingerprints','waiting_on_license','licensed'],ap.license_progress::text) desc nulls last
    limit 1) end,
  a.onboarding_stage::text, ts.stage::text,
  coalesce(a.manager_id,a.invited_by_manager_id),
  (select coalesce(mp.full_name,m.display_name) from public.agents m
    left join public.profiles mp on mp.user_id = m.user_id
    where m.id = coalesce(a.manager_id,a.invited_by_manager_id)),
  (select count(*)::int from public.agents d where coalesce(d.manager_id,d.invited_by_manager_id)=a.id),
  (select count(*)::int from public.agentlink_contracts c where c.agent_id=a.id),
  (select count(*)::int from public.agentlink_contracts c where c.agent_id=a.id
    and lower(coalesce(c.status,'')) in ('active','approved','appointed')),
  coalesce(p.mtd_alp,0),coalesce(p.mtd_deals,0)::int,
  coalesce(p.l30_alp,0),coalesce(p.l30_deals,0)::int,
  coalesce(p.life_alp,0),coalesce(p.life_deals,0)::int,
  p.first_posted,p.last_posted,
  (select max(ap.last_contacted_at) from public.applications ap where ap.assigned_agent_id=a.id),
  a.created_at,
  case when a.start_date is not null then ((select today from ph)-a.start_date)::int
       when a.created_at is not null then ((select today from ph)-(a.created_at at time zone 'America/Phoenix')::date)::int
       else null end
from public.agents a
left join public.profiles pu on pu.user_id=a.user_id
left join public.profiles pp on pp.id=a.profile_id
left join public.v_agent_training_stage ts on ts.agent_id=a.id
cross join p
where not public.fn_agent_is_roster_excluded(a.id) and a.id=p_agent_id;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_agent_sales_pulse()
 RETURNS TABLE(agent_id uuid, today_alp numeric, today_deals integer, selling_streak_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with ph as (
  select (now() at time zone 'America/Phoenix')::date as today
),
sale_days as (
  select b.agent_id, b.posted_date::date as sale_date
  from public.mat_production_unified b
  cross join ph
  where b.agent_id is not null
    and b.posted_date is not null
    and b.posted_date <= ph.today
  group by b.agent_id, b.posted_date::date
),
ranked_days as (
  select
    sd.agent_id,
    (ph.today - sd.sale_date)::int as days_back,
    (row_number() over (partition by sd.agent_id order by sd.sale_date desc) - 1)::int as expected_days_back
  from sale_days sd
  cross join ph
),
streaks as (
  select agent_id, count(*)::int as selling_streak_days
  from ranked_days
  where days_back = expected_days_back
  group by agent_id
),
today_sales as (
  select
    b.agent_id,
    coalesce(sum(b.annual_premium), 0)::numeric as today_alp,
    count(*)::int as today_deals
  from public.mat_production_unified b
  cross join ph
  where b.agent_id is not null
    and b.posted_date = ph.today
  group by b.agent_id
)
select
  a.id,
  coalesce(t.today_alp, 0),
  coalesce(t.today_deals, 0),
  coalesce(s.selling_streak_days, 0)
from public.agents a
left join today_sales t on t.agent_id = a.id
left join streaks s on s.agent_id = a.id
where public.crm_can_read_roster()
  and public.crm_can_read_agent_scope(a.id)
  and coalesce(a.is_inactive, false) = false
  and coalesce(a.is_deactivated, false) = false
  and not public.fn_agent_is_roster_excluded(a.id);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_roster_segments()
 RETURNS TABLE(total integer, active integer, inactive integer, terminated integer, licensed integer, unlicensed integer, sync_only integer, producing_mtd integer, mtd_alp numeric, active_mtd_alp numeric, offroster_mtd_alp numeric, never_produced integer, dormant_60d integer, no_contact_14d integer, book_last_posted date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with r as (
  select * from public.crm_agent_roster()
), ph as (
  select
    (now() at time zone 'America/Phoenix')::date as today,
    date_trunc('month', (now() at time zone 'America/Phoenix')::date)::date as month_start,
    (date_trunc('month', (now() at time zone 'America/Phoenix')::date) + interval '1 month')::date as month_end
), external_mtd as (
  select
    coalesce(sum(u.annual_premium), 0)::numeric as alp,
    max(u.posted_date)::date as last_posted
  from public.mat_production_unified u cross join ph
  where public.apex_is_admin()
    and u.origin = 'external_daily_gap'
    and u.posted_date >= ph.month_start
    and u.posted_date < ph.month_end
)
select
  count(*)::int,
  count(*) filter (where status = 'active')::int,
  count(*) filter (where status = 'inactive')::int,
  count(*) filter (where status = 'terminated')::int,
  count(*) filter (where license_status = 'licensed')::int,
  count(*) filter (where license_status is distinct from 'licensed')::int,
  count(*) filter (where is_sync_only)::int,
  count(*) filter (where mtd_alp > 0)::int,
  coalesce(sum(mtd_alp), 0) + external_mtd.alp,
  coalesce(sum(mtd_alp) filter (where status = 'active'), 0) + external_mtd.alp,
  coalesce(sum(mtd_alp) filter (where status <> 'active'), 0),
  count(*) filter (where status = 'active' and license_status = 'licensed' and lifetime_deals = 0)::int,
  count(*) filter (
    where status = 'active' and license_status = 'licensed'
      and (last_posted_date is null or last_posted_date < (select today from ph) - 59)
  )::int,
  count(*) filter (
    where status = 'active'
      and (last_contacted_at is null or last_contacted_at < now() - interval '14 days')
  )::int,
  greatest(max(last_posted_date), external_mtd.last_posted)
from r cross join external_mtd
group by external_mtd.alp, external_mtd.last_posted;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_today_production()
 RETURNS TABLE(today_alp numeric, today_policies integer, selling_streak_days integer, business_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Phoenix'
AS $function$
  with eligible_deals as (
    select
      u.posted_date as sold_on,
      coalesce(u.annual_premium, 0)::numeric as annual_premium
    from public.mat_production_unified u
    where (
      u.origin = 'external_daily_gap' and public.apex_is_admin()
    ) or (
      u.origin <> 'external_daily_gap'
      and not public.fn_agent_is_roster_excluded(u.agent_id)
      and (
        public.apex_can_read_agent(u.agent_id)
        or public.crm_can_read_agent_scope(u.agent_id)
      )
    )
  ), today as (
    select coalesce(sum(annual_premium), 0)::numeric as alp, count(*)::integer as policies
    from eligible_deals
    where sold_on = current_date
  ), selling_days as (
    select distinct sold_on
    from eligible_deals
    where sold_on <= current_date
  ), streak as (
    select count(*)::integer as days
    from (
      select sold_on, sold_on + row_number() over (order by sold_on desc)::integer as island
      from selling_days
    ) ranked
    where island = current_date + 1
      and exists (select 1 from selling_days where sold_on = current_date)
  )
  select today.alp, today.policies, coalesce(streak.days, 0), current_date
  from today cross join streak;
$function$
;

commit;
