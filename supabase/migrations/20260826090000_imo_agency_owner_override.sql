-- Vantage + all sub-agencies rolled under the IMO owner (Sam), WITH the owner's
-- estimated override per agency, on the dashboard AND finances (Sam 2026-08-26:
-- "add vantage and all sub agencys under me in dashboard and finances,
-- especially for commissions").
--
-- owner_override_pct = owner comp − that agency's HEAD comp:
--   Vantage: 120 − 105 = 15  →  Sam earns 15% on Vantage's ALP
--   Primary APEX: 120 − 120 = 0  →  your own book; the direct + team override
--   lives in the scoreboard's earnings, not double-counted here.
-- Extensible: head_pct is the MAX contract level inside each agency, so a new
-- sub-agency rolls up automatically the moment fn_agent_subagency knows it.

create or replace view public.v_imo_by_agency as
with bounds as (
  select (now() at time zone 'America/Phoenix')::date as today,
         date_trunc('month', (now() at time zone 'America/Phoenix'))::date as month_start
),
scoped as (
  select u.annual_premium, u.posted_date,
         coalesce(public.fn_agent_subagency(u.agent_id) = 'vantage', false) as is_vantage
  from public.v_production_unified u
),
heads as (
  select case when public.fn_agent_subagency(a.id) = 'vantage'
              then 'Vantage Financial' else 'APEX Financial' end as agency,
         max((public.fn_agent_contract_pct(a.id)).pct) as head_pct
  from public.agents a
  where not public.fn_agent_is_roster_excluded(a.id)
  group by 1
),
owner as (
  select max((public.fn_agent_contract_pct(a.id)).pct) as owner_pct
  from public.agents a
  where not public.fn_agent_is_roster_excluded(a.id)
),
agg as (
  select case when scoped.is_vantage then 'Vantage Financial' else 'APEX Financial' end as agency,
         not scoped.is_vantage as is_primary,
         count(*)::integer as policies,
         round(sum(scoped.annual_premium), 0) as alp,
         round(coalesce(sum(scoped.annual_premium) filter (
           where scoped.posted_date >= bounds.month_start and scoped.posted_date <= bounds.today), 0), 0) as alp_mtd,
         count(*) filter (where scoped.posted_date >= bounds.month_start and scoped.posted_date <= bounds.today)::integer as policies_mtd,
         count(*) filter (where scoped.posted_date >= bounds.today - 30 and scoped.posted_date <= bounds.today)::integer as policies_30d,
         round(coalesce(sum(scoped.annual_premium) filter (
           where scoped.posted_date >= bounds.today - 30 and scoped.posted_date <= bounds.today), 0), 0) as alp_30d
  from scoped cross join bounds
  group by 1, 2
)
select agg.agency, agg.is_primary, agg.policies, agg.alp, agg.alp_mtd,
       agg.policies_mtd, agg.policies_30d, agg.alp_30d,
       coalesce(o.owner_pct, 120) as owner_pct,
       h.head_pct,
       greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) as owner_override_pct,
       round(agg.alp     * greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) / 100.0, 0) as est_owner_override_alp,
       round(agg.alp_mtd * greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) / 100.0, 0) as est_owner_override_mtd,
       round(agg.alp_30d * greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) / 100.0, 0) as est_owner_override_30d
from agg
left join heads h on h.agency = agg.agency
cross join owner o
order by agg.alp desc;

grant select on public.v_imo_by_agency to authenticated, service_role;

-- Windowed variant used by the dashboard/finances date picker.
drop function if exists public.imo_by_agency_period(date, date);
create function public.imo_by_agency_period(p_start date, p_end date)
returns table(agency text, is_primary boolean, policies integer, alp numeric,
              owner_override_pct numeric, est_owner_override_alp numeric)
language sql stable security definer set search_path to 'public'
as $function$
  with heads as (
    select case when public.fn_agent_subagency(a.id) = 'vantage'
                then 'Vantage Financial' else 'APEX Financial' end as agency,
           max((public.fn_agent_contract_pct(a.id)).pct) as head_pct
    from public.agents a
    where not public.fn_agent_is_roster_excluded(a.id)
    group by 1
  ), owner as (
    select max((public.fn_agent_contract_pct(a.id)).pct) as owner_pct
    from public.agents a
    where not public.fn_agent_is_roster_excluded(a.id)
  ), agg as (
    select case when coalesce(public.fn_agent_subagency(u.agent_id) = 'vantage', false)
                then 'Vantage Financial' else 'APEX Financial' end as agency,
           not coalesce(public.fn_agent_subagency(u.agent_id) = 'vantage', false) as is_primary,
           count(*)::integer as policies,
           round(coalesce(sum(u.annual_premium), 0), 0) as alp
    from public.v_production_unified u
    where u.posted_date >= p_start and u.posted_date < p_end
    group by 1, 2
  )
  select agg.agency, agg.is_primary, agg.policies, agg.alp,
         greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) as owner_override_pct,
         round(agg.alp * greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) / 100.0, 0) as est_owner_override_alp
  from agg
  left join heads h on h.agency = agg.agency
  cross join owner o
  order by agg.alp desc;
$function$;

revoke all on function public.imo_by_agency_period(date, date) from public, anon;
grant execute on function public.imo_by_agency_period(date, date) to authenticated, service_role;
