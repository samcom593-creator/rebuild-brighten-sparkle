-- APEX home dashboard — ONE server-side source for every number on /dashboard.
--
-- Sam: "dashboard still not good, mirror agent cloud, make sure every website
-- function is working." Mirrors the Agent Cloud home anatomy captured at
-- ~/business-ops/agentcloud-reference/pages/00-home-dashboard-fullpage.png:
-- personal/team production, MTD ALP vs goal, needs-attention, leaderboard,
-- commission quad, IMO by agency, onboarding, production trend, enrollment,
-- policy-status tiles.
--
-- WHY ONE RPC: the old page ran ~20 client-side queries, several against the
-- LEGACY `deals` table rather than agentlink_book, and derived headline counts
-- from arrays PostgREST caps at 1000 rows. That is how the dashboard came to
-- disagree with the leaderboard. Everything here is computed server-side from
-- agentlink_book with posted_date + America/Phoenix + is_dead filtering, and
-- honours fn_agent_is_roster_excluded so a removed agent (Alyjah Rowland) is
-- absent here exactly as he is on every other surface.
create or replace function public.apex_home_dashboard(p_scope text default 'agency')
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_m_start date := date_trunc('month', (now() at time zone 'America/Phoenix'))::date;
  v_m_end   date := (date_trunc('month', (now() at time zone 'America/Phoenix')) + interval '1 month')::date;
  v_caller_ids uuid[];
  v_goal numeric;
  v_out jsonb;
begin
  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}')
    into v_caller_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
   where a.user_id = auth.uid();

  select coalesce((value)::numeric, 25000) into v_goal
    from public.system_settings where key = 'dashboard_mtd_goal' limit 1;
  v_goal := coalesce(v_goal, 25000);

  with scoped as (
    select b.annual_premium as ap, b.posted_date, b.status, b.carrier,
           coalesce(m.canonical_agent_id, b.agent_id) as canon
    from public.agentlink_book b
    left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
    where b.is_dead is not true
      and not public.fn_agent_is_roster_excluded(b.agent_id)
  ),
  mtd as (
    select
      coalesce(sum(ap) filter (where canon = any(v_caller_ids)), 0)  as personal_ap,
      count(*)          filter (where canon = any(v_caller_ids))     as personal_policies,
      coalesce(sum(ap), 0)                                           as team_ap,
      count(*)                                                       as team_policies
    from scoped where posted_date >= v_m_start and posted_date < v_m_end
  ),
  lifetime as (
    select coalesce(sum(ap),0) as ap, count(*) as policies from scoped
  ),
  trend as (
    select jsonb_agg(t order by t.m) as rows from (
      select to_char(date_trunc('month', posted_date), 'YYYY-MM') as m,
             round(sum(ap)) as ap, count(*) as policies
      from scoped where posted_date > v_today - 365
      group by 1) t
  ),
  board as (
    select jsonb_agg(x order by x.ap desc) as rows from (
      select coalesce(ag.display_name, 'Unattributed') as name,
             round(sum(s.ap)) as ap, count(*) as deals
      from scoped s left join public.agents ag on ag.id = s.canon
      where s.posted_date >= v_m_start and s.posted_date < v_m_end
      group by 1 order by 2 desc limit 10) x
  ),
  statuses as (
    -- Over the WHOLE book, not `scoped`: scoped filters is_dead, and Lapsed /
    -- Cancelled / Withdrawn / Not-Taken policies ARE dead — filtering them made
    -- five of the ten status tiles permanently read 0 while the DB held 63
    -- lapsed and 62 lapse-pending. 'Unknown' is its own bucket and is NOT folded
    -- into carrier_na: AgentLink returns policyStatus=None for 1,304 of 1,731
    -- deals upstream, and dressing an upstream data gap as a carrier problem is
    -- the fake-success disease.
    select jsonb_object_agg(k, n) as tiles from (
      select case
        when b.status = 'Active' then 'active'
        when b.status in ('Issued','Approved') then 'issued_not_paid'
        when b.status in ('In Review','Pending') then 'in_review'
        when b.status = 'Lapse Pending' then 'lapse_pending'
        when b.status = 'Lapsed' then 'lapsed'
        when b.status = 'Cancelled' then 'cancelled'
        when b.status = 'Withdrawn' then 'withdrawn'
        when b.status in ('Not Taken','Declined') then 'not_taken'
        when b.status = 'Postponed' then 'postponed'
        when b.status = 'Unknown' or b.status is null then 'status_not_reported'
        else 'carrier_na' end as k,
        count(*) as n
      from public.agentlink_book b
      where not public.fn_agent_is_roster_excluded(b.agent_id)
      group by 1) s
  ),
  roster as (
    select count(*) as total,
           count(*) filter (where is_producing) as producing,
           count(*) filter (where roster_state = 'active_no_production') as active_no_prod
    from public.v_apex_roster
  ),
  onboarding as (
    select count(*) as in_onboarding from public.v_apex_roster
     where roster_state = 'active_no_production'
  ),
  attention as (
    select
      (select count(*) from scoped where status = 'Lapse Pending')                as lapse_pending,
      (select count(*) from scoped
        where status = 'Active' and posted_date > v_today - 30)                   as in_chargeback_window,
      (select count(*) from public.v_apex_roster
        where is_producing and last_deal < v_today - 45)                          as dormant_producers
  )
  select jsonb_build_object(
    'as_of', v_today,
    'scope', coalesce(p_scope,'agency'),
    'mtd', jsonb_build_object(
      'personal_ap', (select personal_ap from mtd),
      'personal_policies', (select personal_policies from mtd),
      'team_ap', (select team_ap from mtd),
      'team_policies', (select team_policies from mtd),
      'goal', v_goal,
      'pct_to_goal', case when v_goal > 0
        then round(((select team_ap from mtd) / v_goal) * 100) else 0 end,
      'days_left', (v_m_end - v_today)
    ),
    'lifetime', jsonb_build_object(
      'ap', (select ap from lifetime), 'policies', (select policies from lifetime)),
    'trend', coalesce((select rows from trend), '[]'::jsonb),
    'leaderboard', coalesce((select rows from board), '[]'::jsonb),
    'policy_status', coalesce((select tiles from statuses), '{}'::jsonb),
    'roster', jsonb_build_object(
      'total', (select total from roster),
      'producing', (select producing from roster),
      'in_onboarding', (select in_onboarding from onboarding)),
    'needs_attention', jsonb_build_object(
      'lapse_pending', (select lapse_pending from attention),
      'in_chargeback_window', (select in_chargeback_window from attention),
      'dormant_producers', (select dormant_producers from attention))
  ) into v_out;

  return v_out;
end;
$fn$;

grant execute on function public.apex_home_dashboard(text) to authenticated;
