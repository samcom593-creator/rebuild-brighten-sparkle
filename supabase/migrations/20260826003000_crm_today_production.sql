-- Live, hierarchy-scoped Phoenix-day production for the CRM headline bar.
create or replace function public.crm_today_production()
returns table (
  today_alp numeric,
  today_policies integer,
  selling_streak_days integer,
  business_date date
)
language sql
security definer
set search_path = public
set timezone = 'America/Phoenix'
stable
as $$
  with eligible_deals as (
    select
      (d.created_at at time zone 'America/Phoenix')::date as sold_on,
      coalesce(
        d.annualized_commissionable_premium,
        d.annualized_paid_premium,
        d.annual_premium,
        0
      )::numeric as alp
    from public.deals d
    where d.duplicate_of_deal_id is null
      and d.status in ('submitted', 'needs_review', 'approved', 'issued', 'in_force', 'active')
      and not public.fn_agent_is_roster_excluded(d.agent_id)
      and (
        public.apex_can_read_agent(d.agent_id)
        or public.crm_can_read_agent_scope(d.agent_id)
      )
  ),
  today as (
    select coalesce(sum(alp), 0)::numeric as alp, count(*)::integer as policies
    from eligible_deals
    where sold_on = current_date
  ),
  selling_days as (
    select distinct sold_on
    from eligible_deals
    where sold_on <= current_date
  ),
  streak as (
    select count(*)::integer as days
    from (
      select sold_on, sold_on + row_number() over (order by sold_on desc)::integer as island
      from selling_days
    ) ranked
    where island = current_date + 1
      and exists (select 1 from selling_days where sold_on = current_date)
  )
  select today.alp, today.policies, coalesce(streak.days, 0), current_date
  from today
  cross join streak;
$$;

revoke all on function public.crm_today_production() from public, anon;
grant execute on function public.crm_today_production() to authenticated;

comment on function public.crm_today_production() is
  'Hierarchy-scoped deal count, ALP, and consecutive selling-day streak using America/Phoenix business dates.';
