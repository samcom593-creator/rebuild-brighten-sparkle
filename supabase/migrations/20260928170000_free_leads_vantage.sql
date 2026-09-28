-- Free leads (Sam 2026-09-28): only LIVE agents who are out of training qualify, and a
-- live agent with zero policies after 7 days live does not count. Ramp is now 30 days
-- from going live, not from hire. Same signature so both readers (team page roster and
-- the agent's own card via get_agent_free_leads_status) change together.
-- Vantage sub-agency producers (vantage_producer_map) are licensed and live through
-- Vantage, so our license/stage flags don't apply to them; they qualify on production.
CREATE OR REPLACE FUNCTION public.crm_agent_free_leads_status()
 RETURNS TABLE(agent_id uuid, qualifies boolean, reason text, l30_alp numeric, tenure_days integer, days_left_in_ramp integer, needed_for_qual numeric, qualifying_threshold numeric, ramp_days integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
with params as (
  select (now() at time zone 'America/Phoenix')::date as today, 20000.00::numeric as threshold, 30::integer as ramp_days, 7::integer as no_sale_grace
), targets as (
  select a.id, coalesce(public.fn_canonical_agent_id(a.id), a.id) as canonical_id,
    a.license_status, a.onboarding_stage::text as stage, a.stage_changed_at, a.contracted_at,
    exists (select 1 from public.vantage_producer_map vm where vm.apex_agent_id = a.id) as is_vantage,
    greatest(0, case when a.start_date is not null then p.today - a.start_date
                     when a.created_at is not null then p.today - (a.created_at at time zone 'America/Phoenix')::date else 0 end)::integer as tenure_days
  from public.agents a cross join params p
  where a.status = 'active' and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
    and a.id <> '00000000-0000-0000-0000-00000000a008'::uuid and not public.fn_agent_is_roster_excluded(a.id)
    and (auth.role() = 'service_role' or public.crm_can_read_agent_scope(a.id))
), production as (
  select coalesce(public.fn_canonical_agent_id(v.agent_id), v.agent_id) as canonical_id,
    count(*)::integer as policies,
    min(v.posted_date) as first_policy,
    coalesce(sum(v.annual_premium) filter (where v.posted_date between p.today - 29 and p.today), 0)::numeric as l30_alp
  from public.v_production_canonical v cross join params p
  where v.agent_id is not null group by 1
), status as (
  select t.id as agent_id, t.tenure_days, p.threshold, p.ramp_days, p.no_sale_grace,
    coalesce(pr.l30_alp, 0)::numeric as l30_alp, coalesce(pr.policies, 0) as policies,
    (t.is_vantage or (t.license_status = 'licensed'
      and coalesce(t.stage, '') not in ('pre_licensed', 'training_online', 'in_field_training', 'inactive', 'applied')
      and (t.stage in ('live', 'evaluated') or coalesce(pr.policies, 0) > 0))) as is_live,
    greatest(0, p.today - coalesce(
      case when t.stage in ('live', 'evaluated') then (t.stage_changed_at at time zone 'America/Phoenix')::date end,
      pr.first_policy,
      (t.contracted_at at time zone 'America/Phoenix')::date,
      p.today - t.tenure_days))::integer as live_days
  from targets t cross join params p left join production pr on pr.canonical_id = t.canonical_id
), graded as (
  select s.*,
    (s.is_live and not (s.policies = 0 and s.live_days > s.no_sale_grace)
      and (s.live_days <= s.ramp_days or s.l30_alp >= s.threshold)) as qualifies
  from status s
)
select g.agent_id, g.qualifies,
  case
    when not g.is_live then 'In training — free leads start once they are live'
    when g.policies = 0 and g.live_days > g.no_sale_grace then 'Live ' || g.live_days || ' days with no policy yet — not eligible'
    when g.live_days <= g.ramp_days then 'First 30 days live (' || (g.ramp_days - g.live_days) || ' days left)'
    when g.qualifies then 'Producing Tier Qualified ($' || to_char(g.l30_alp, 'FM999,999,990') || ' L30 ALP)'
    else '$' || to_char(greatest(0, g.threshold - g.l30_alp), 'FM999,999,990') || ' needed to unlock Free Leads ($' || to_char(g.l30_alp, 'FM999,999,990') || ' / $20K)'
  end,
  g.l30_alp, g.tenure_days,
  case when g.is_live then greatest(0, g.ramp_days - g.live_days) else 0 end,
  case when g.is_live then greatest(0::numeric, g.threshold - g.l30_alp) else null end,
  g.threshold, g.ramp_days
from graded g;
$function$;
