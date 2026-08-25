-- Live Team row pulse: did this agent sell today, and how many consecutive
-- calendar days (ending today) have at least one canonical posted deal?
-- v_production_unified already owns valid-status filtering and cross-source
-- dedupe, so this function must not re-implement either rule.

begin;

create or replace function public.crm_agent_sales_pulse()
returns table(
  agent_id uuid,
  today_alp numeric,
  today_deals integer,
  selling_streak_days integer
)
language sql
stable
security definer
set search_path = public
as $function$
with ph as (
  select (now() at time zone 'America/Phoenix')::date as today
),
sale_days as (
  select b.agent_id, b.posted_date::date as sale_date
  from public.v_production_unified b
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
  from public.v_production_unified b
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
$function$;

comment on function public.crm_agent_sales_pulse() is
  'Role-scoped Team sales pulse from v_production_unified: Phoenix today ALP/deals and current consecutive calendar-day sales streak.';

revoke all on function public.crm_agent_sales_pulse() from public, anon;
grant execute on function public.crm_agent_sales_pulse() to authenticated;

commit;
