-- The roster's people counts come from crm_agent_roster, but its production KPI
-- must also include admin-visible external agency reconciliation. Otherwise the
-- leaderboard/home total and the Team card disagree by the unresolved Vantage
-- snapshot even though both claim to be the live IMO total.

begin;

create or replace function public.crm_roster_segments()
returns table(
  total integer,
  active integer,
  inactive integer,
  terminated integer,
  licensed integer,
  unlicensed integer,
  sync_only integer,
  producing_mtd integer,
  mtd_alp numeric,
  active_mtd_alp numeric,
  offroster_mtd_alp numeric,
  never_produced integer,
  dormant_60d integer,
  no_contact_14d integer,
  book_last_posted date
)
language sql
stable
security definer
set search_path = public
as $function$
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
  from public.v_production_unified u cross join ph
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
$function$;

revoke all on function public.crm_roster_segments() from public, anon;
grant execute on function public.crm_roster_segments() to authenticated, service_role;

comment on function public.crm_roster_segments() is
  'Hierarchy-scoped roster counts and production. Admin MTD totals include deduplicated external agency reconciliation without inventing individual attribution.';

commit;
