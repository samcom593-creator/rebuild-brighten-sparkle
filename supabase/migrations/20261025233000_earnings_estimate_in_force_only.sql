-- Earnings estimate overestimated (2026-10-25, Sam: "fix the overestimated earnings").
-- v_earnings_estimate summed annual premium x comp over EVERY deal as "earned on in-force":
-- measured 1,405 rows / $1.45M "earned", of which 969 rows ($1.01M) carry status 'unknown' (the frozen
-- AgentLink book) and 179 ($197K) are only 'submitted'. Only 131 deals are actually in force.
-- Now: earned = in-force statuses only x resolved comp x the advance the agency contracts for
-- (system_settings.contracting_default_advance, '6 month' = 6/12 of first-year comp). Submitted and
-- unknown-status business is reported in its own columns and never counted as earned. Each agent
-- sees only their own row; staff and service readers see all.
create or replace function public.fn_commission_advance_factor()
returns numeric language sql stable set search_path = public as $$
  select least(1, greatest(0.25,
    coalesce(nullif(regexp_replace((select value from public.system_settings where key='contracting_default_advance' limit 1), '[^0-9]', '', 'g'), '')::numeric, 6) / 12.0));
$$;
revoke all on function public.fn_commission_advance_factor() from public, anon;
grant execute on function public.fn_commission_advance_factor() to authenticated, service_role;

drop view if exists public.v_earnings_estimate;
create view public.v_earnings_estimate as
with t as (
  select t.*, case
    when lower(coalesce(t.status,'')) in ('active','issued','approved','in force','inforce','in-force','paid','placed','issued paid') then 'in_force'
    when lower(coalesce(t.status,'')) in ('submitted','pending','in review','underwriting','app submitted','applied') then 'pending'
    else 'unknown' end as bucket
  from public.v_production_comp_truth t)
select t.agent_id,
  min(t.agent_name) as agent_name,
  max(coalesce(mgr.display_name, 'unassigned')) as manager,
  round(max(t.seller_comp_pct), 1) as contract_pct,
  count(*) filter (where t.bucket = 'in_force') as in_force_deals,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'in_force'), 0) * public.fn_commission_advance_factor(), 0) as est_earned_in_force,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'pending'), 0) * public.fn_commission_advance_factor(), 0) as est_pending_if_issued,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'in_force' and t.posted_date >= (now() at time zone 'America/Phoenix')::date - 30), 0) * public.fn_commission_advance_factor(), 0) as est_earned_30d,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'in_force' and t.posted_date >= date_trunc('month', now() at time zone 'America/Phoenix')::date), 0) * public.fn_commission_advance_factor(), 0) as est_earned_mtd,
  format('ESTIMATE: in-force deals only (active/issued/approved) x resolved comp x %s%% advance (system_settings.contracting_default_advance). Submitted and unknown-status deals are shown separately and are not counted as earned. Not a carrier-paid statement.', round(public.fn_commission_advance_factor() * 100)) as basis,
  count(*) filter (where t.bucket = 'in_force') as confirmed_active_deals,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'in_force'), 0), 0) as est_confirmed_active,
  count(*) filter (where t.bucket = 'pending') as submitted_deals,
  count(*) filter (where t.bucket = 'unknown') as unknown_status_deals,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'unknown'), 0), 0) as est_unknown_status_first_year,
  round(coalesce(sum(t.direct_estimate) filter (where t.bucket = 'in_force'), 0), 0) as est_first_year_in_force,
  public.fn_commission_advance_factor() as advance_factor
from t
left join public.agents a on a.id = t.agent_id
left join public.agents mgr on mgr.id = a.manager_id
where public.is_agency_staff() or auth.uid() is null
   or t.agent_id in (select ag.id from public.agents ag where ag.user_id = auth.uid())
group by t.agent_id;
grant select on public.v_earnings_estimate to authenticated;
