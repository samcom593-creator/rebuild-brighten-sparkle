-- Agency production must never mix an all-time policy count with MTD ALP or
-- relabel MTD data as the home dashboard's selected date range.

begin;

create or replace view public.v_imo_by_agency
with (security_invoker = on) as
with bounds as (
  select
    (now() at time zone 'America/Phoenix')::date as today,
    date_trunc('month', now() at time zone 'America/Phoenix')::date as month_start
), scoped as (
  select annual_premium, posted_date,
         coalesce(public.fn_agent_subagency(agent_id) = 'vantage', false) as is_vantage
  from public.v_production_unified
)
select
  case when is_vantage then 'Vantage Financial'::text else 'APEX Financial'::text end as agency,
  not is_vantage as is_primary,
  count(*)::integer as policies,
  round(sum(annual_premium), 0) as alp,
  round(coalesce(sum(annual_premium) filter (
    where posted_date >= bounds.month_start and posted_date <= bounds.today
  ), 0::numeric), 0) as alp_mtd,
  count(*) filter (
    where posted_date >= bounds.month_start and posted_date <= bounds.today
  )::integer as policies_mtd,
  count(*) filter (
    where posted_date >= bounds.today - 30 and posted_date <= bounds.today
  )::integer as policies_30d,
  round(coalesce(sum(annual_premium) filter (
    where posted_date >= bounds.today - 30 and posted_date <= bounds.today
  ), 0::numeric), 0) as alp_30d
from scoped cross join bounds
group by 1, 2
order by round(sum(annual_premium), 0) desc;

create or replace function public.imo_by_agency_period(p_start date, p_end date)
returns table (
  agency text,
  is_primary boolean,
  policies integer,
  alp numeric
)
language sql
stable
set search_path to 'public'
as $$
  select
    case when is_vantage then 'Vantage Financial'::text else 'APEX Financial'::text end,
    not is_vantage,
    count(*)::integer,
    round(coalesce(sum(annual_premium), 0::numeric), 0)
  from (
    select
      u.annual_premium,
      coalesce(public.fn_agent_subagency(u.agent_id) = 'vantage', false) as is_vantage
    from public.v_production_unified u
    where u.posted_date >= p_start and u.posted_date < p_end
  ) scoped
  group by is_vantage
  order by round(coalesce(sum(annual_premium), 0::numeric), 0) desc;
$$;

revoke all on function public.imo_by_agency_period(date, date) from public, anon;
grant execute on function public.imo_by_agency_period(date, date) to authenticated, service_role;
grant select on public.v_imo_by_agency to authenticated;

commit;
