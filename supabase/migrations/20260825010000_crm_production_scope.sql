-- CRM production must match the same unified book that powers /production.
-- Managers see only themselves + their recursive downline; admin/VA operators
-- retain the agency-wide operating view. Native APEX deals were previously
-- omitted from CRM, understating August by 7 deals / $8,898.36 at discovery.

begin;

create or replace function public.crm_can_read_agent_scope(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.apex_is_admin()
    or public.has_role(auth.uid(), 'va_manager')
    or public.has_role(auth.uid(), 'va')
    or (
      public.has_role(auth.uid(), 'manager')
      and public.apex_can_read_agent(p_agent_id)
    );
$$;

revoke all on function public.crm_can_read_agent_scope(uuid) from public, anon;
grant execute on function public.crm_can_read_agent_scope(uuid) to authenticated;

create or replace function public.crm_agent_roster()
returns table(
  agent_id uuid, full_name text, email text, phone text, avatar_url text,
  agent_code text, status text, is_deactivated boolean, is_inactive boolean,
  is_sync_only boolean, license_status text, license_progress text,
  onboarding_stage text, training_stage text, manager_id uuid, manager_name text,
  downline_count integer, contracts_total integer, contracts_active integer,
  mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer,
  lifetime_alp numeric, lifetime_deals integer, first_posted_date date,
  last_posted_date date, last_contacted_at timestamptz, created_at timestamptz,
  tenure_days integer
)
language sql
stable
security definer
set search_path = public
as $function$
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
  from public.v_production_unified b
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
$function$;

create or replace function public.crm_roster_segments()
returns table(
  total integer, active integer, inactive integer, terminated integer,
  licensed integer, unlicensed integer, sync_only integer,
  producing_mtd integer, mtd_alp numeric, active_mtd_alp numeric,
  offroster_mtd_alp numeric, never_produced integer, dormant_60d integer,
  no_contact_14d integer, book_last_posted date
)
language sql
stable
security definer
set search_path = public
as $$
with r as (select * from public.crm_agent_roster()),
ph as (select (now() at time zone 'America/Phoenix')::date as today)
select
  count(*)::int,
  count(*) filter (where status = 'active')::int,
  count(*) filter (where status = 'inactive')::int,
  count(*) filter (where status = 'terminated')::int,
  count(*) filter (where license_status = 'licensed')::int,
  count(*) filter (where license_status is distinct from 'licensed')::int,
  count(*) filter (where is_sync_only)::int,
  count(*) filter (where mtd_alp > 0)::int,
  coalesce(sum(mtd_alp),0),
  coalesce(sum(mtd_alp) filter (where status = 'active'),0),
  coalesce(sum(mtd_alp) filter (where status <> 'active'),0),
  count(*) filter (where status = 'active' and license_status = 'licensed' and lifetime_deals = 0)::int,
  count(*) filter (where status = 'active' and license_status = 'licensed'
    and (last_posted_date is null or last_posted_date < (select today from ph) - 59))::int,
  count(*) filter (where status = 'active'
    and (last_contacted_at is null or last_contacted_at < now() - interval '14 days'))::int,
  max(last_posted_date)
from r;
$$;

create or replace function public.crm_agent_roster_unguarded(p_agent_id uuid)
returns table(
  agent_id uuid, full_name text, email text, phone text, avatar_url text,
  agent_code text, status text, is_deactivated boolean, is_inactive boolean,
  is_sync_only boolean, license_status text, license_progress text,
  onboarding_stage text, training_stage text, manager_id uuid, manager_name text,
  downline_count integer, contracts_total integer, contracts_active integer,
  mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer,
  lifetime_alp numeric, lifetime_deals integer, first_posted_date date,
  last_posted_date date, last_contacted_at timestamptz, created_at timestamptz,
  tenure_days integer
)
language sql
stable
security definer
set search_path = public
as $$
with ph as (select (now() at time zone 'America/Phoenix')::date as today),
win as (select today, date_trunc('month',today)::date as month_start, today - 29 as l30_start from ph),
p as (
  select sum(b.annual_premium) filter (where b.posted_date >= w.month_start) as mtd_alp,
         count(*) filter (where b.posted_date >= w.month_start) as mtd_deals,
         sum(b.annual_premium) filter (where b.posted_date >= w.l30_start) as l30_alp,
         count(*) filter (where b.posted_date >= w.l30_start) as l30_deals,
         sum(b.annual_premium) as life_alp, count(*) as life_deals,
         min(b.posted_date) as first_posted, max(b.posted_date) as last_posted
  from public.v_production_unified b cross join win w
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
$$;

create or replace function public.producer_profile_detail(p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_self boolean;
  v_row record;
  v_result jsonb;
begin
  if p_agent_id is null then return null; end if;

  select exists(select 1 from public.agents where id=p_agent_id and user_id=auth.uid()) into v_self;
  if not (v_self or public.crm_can_read_agent_scope(p_agent_id)) then
    raise exception 'not authorised to read this producer profile';
  end if;

  select * into v_row from public.crm_agent_roster_unguarded(p_agent_id);
  if not found then return null; end if;

  select jsonb_build_object(
    'agent',to_jsonb(v_row),
    'monthly',coalesce((
      select jsonb_agg(m order by m.month) from (
        select to_char(date_trunc('month',b.posted_date),'YYYY-MM') as month,
               round(sum(b.annual_premium))::numeric as alp,count(*)::int as deals
        from public.v_production_unified b
        where b.agent_id=p_agent_id and b.posted_date is not null
          and b.posted_date >= (date_trunc('month',(now() at time zone 'America/Phoenix')::date)-interval '11 months')::date
        group by 1
      ) m
    ),'[]'::jsonb),
    'carriers',coalesce((
      select jsonb_agg(c order by c.alp desc) from (
        select coalesce(b.carrier,'(no carrier on file)') as carrier,
               round(sum(b.annual_premium))::numeric as alp,count(*)::int as deals
        from public.v_production_unified b where b.agent_id=p_agent_id group by 1
      ) c
    ),'[]'::jsonb),
    'recent_deals',coalesce((
      select jsonb_agg(d order by d.posted_date desc) from (
        select b.posted_date,b.carrier,b.product,b.status,
               round(b.annual_premium)::numeric as annual_premium
        from public.v_production_unified b
        where b.agent_id=p_agent_id and b.posted_date is not null
        order by b.posted_date desc limit 10
      ) d
    ),'[]'::jsonb),
    'contracts',coalesce((
      select jsonb_agg(k order by k.status,k.carrier) from (
        select coalesce(car.name,'Carrier #'||c.insuracloud_carrier_id::text,'(unnamed carrier)') as carrier,
               coalesce(c.status,'unknown') as status,c.writing_number,c.commission_level,c.activated_date
        from public.agentlink_contracts c
        left join public.carriers car on car.id=c.carrier_id
        where c.agent_id=p_agent_id
      ) k
    ),'[]'::jsonb),
    'upline',(
      select jsonb_build_object('agent_id',u.id,'name',coalesce(pu.full_name,u.display_name,'(unnamed)'),'status',u.status::text)
      from public.agents me join public.agents u on u.id=coalesce(me.manager_id,me.invited_by_manager_id)
      left join public.profiles pu on pu.user_id=u.user_id where me.id=p_agent_id
    ),
    'downline',coalesce((
      select jsonb_agg(x order by x.mtd_alp desc nulls last,x.name) from (
        select d.id as agent_id,coalesce(pd.full_name,d.display_name,'(unnamed)') as name,
               d.status::text as status,d.license_status::text as license_status,
               coalesce((select round(sum(b.annual_premium)) from public.v_production_unified b
                 where b.agent_id=d.id and b.posted_date >= date_trunc('month',(now() at time zone 'America/Phoenix')::date)::date),0)::numeric as mtd_alp
        from public.agents d left join public.profiles pd on pd.user_id=d.user_id
        where coalesce(d.manager_id,d.invited_by_manager_id)=p_agent_id
      ) x
    ),'[]'::jsonb),
    'training',(
      select jsonb_build_object(
        'modules_total',(select count(*)::int from public.onboarding_modules where is_active=true),
        'modules_passed',(select count(*)::int from public.onboarding_progress where agent_id=p_agent_id and passed=true),
        'last_activity',(select max(completed_at) from public.onboarding_progress where agent_id=p_agent_id)
      )
    )
  ) into v_result;
  return v_result;
end;
$$;

-- Public recruiting proof must never display obvious QA names even when an old
-- probe was misclassified as a real application.
create or replace function public.landing_recent_applicants(p_limit integer default 14)
returns table(first_name text, city text, state text, hours_ago integer)
language sql
security definer
set search_path = public
as $$
  select first_name::text, city::text, state::text,
         round(extract(epoch from (now() - created_at)) / 3600)::int
  from public.v_applications_real applications
  where terminated_at is null and first_name is not null and btrim(first_name) <> ''
    and lower(btrim(first_name)) not in ('test','testing','qa','demo')
    and created_at > now() - interval '30 days'
  order by created_at desc
  limit p_limit;
$$;

revoke all on function public.crm_agent_roster() from public, anon;
revoke all on function public.crm_roster_segments() from public, anon;
revoke all on function public.crm_agent_roster_unguarded(uuid) from public, anon, authenticated;
revoke all on function public.producer_profile_detail(uuid) from public, anon;
grant execute on function public.crm_agent_roster() to authenticated;
grant execute on function public.crm_roster_segments() to authenticated;
grant execute on function public.producer_profile_detail(uuid) to authenticated;
grant execute on function public.landing_recent_applicants(integer) to anon, authenticated;

commit;
