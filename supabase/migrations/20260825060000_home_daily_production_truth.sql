-- Make the home dashboard use the same deduplicated production ledger as the
-- production page, leaderboard and IMO cards. Add a Phoenix-local daily block
-- that is independent of the selected report period.
begin;

create or replace function public.apex_home_dashboard(
  p_scope text default 'agency',
  p_start date default null,
  p_end   date default null
)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_start date := coalesce(p_start, date_trunc('month', (now() at time zone 'America/Phoenix'))::date);
  v_end date := coalesce(p_end, (date_trunc('month', (now() at time zone 'America/Phoenix')) + interval '1 month')::date);
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
    select b.annual_premium as ap, b.posted_date, b.status,
           coalesce(m.canonical_agent_id, b.agent_id) as canon
      from public.v_production_unified b
      left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
  ),
  daily as (
    select
      coalesce(sum(ap) filter (where canon = any(v_caller_ids)), 0) as personal_ap,
      count(*) filter (where canon = any(v_caller_ids)) as personal_policies,
      coalesce(sum(ap), 0) as team_ap,
      count(*) as team_policies
      from scoped where posted_date = v_today
  ),
  period_totals as (
    select
      coalesce(sum(ap) filter (where canon = any(v_caller_ids)), 0) as personal_ap,
      count(*) filter (where canon = any(v_caller_ids)) as personal_policies,
      coalesce(sum(ap), 0) as team_ap,
      count(*) as team_policies
      from scoped where posted_date >= v_start and posted_date < v_end
  ),
  lifetime as (
    select coalesce(sum(ap), 0) as ap, count(*) as policies from scoped
  ),
  trend as (
    select jsonb_agg(t order by t.m) as rows from (
      select to_char(date_trunc('month', posted_date), 'YYYY-MM') as m,
             round(sum(ap)) as ap, count(*) as policies
        from scoped where posted_date > v_today - 365
       group by 1
    ) t
  ),
  board as (
    select jsonb_agg(x order by x.ap desc, x.name) as rows from (
      select coalesce(ag.display_name, 'Unattributed') as name,
             round(sum(s.ap)) as ap, count(*) as deals
        from scoped s left join public.agents ag on ag.id = s.canon
       where s.posted_date >= v_start and s.posted_date < v_end
       group by 1 order by 2 desc limit 10
    ) x
  ),
  statuses as (
    -- Status tiles deliberately read the full imported book. Dead rows are the
    -- lapsed/cancelled policies the operational status section must still show.
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
       group by 1
    ) s
  ),
  roster as (
    select count(*) as total,
           count(*) filter (where is_producing) as producing,
           count(*) filter (where roster_state = 'active_no_production') as in_onboarding
      from public.v_apex_roster
  ),
  attention as (
    select
      (select count(*) from public.agentlink_book b
        where b.status = 'Lapse Pending' and not public.fn_agent_is_roster_excluded(b.agent_id)) as lapse_pending,
      (select count(*) from scoped where status = 'Active' and posted_date > v_today - 30) as in_chargeback_window,
      (select count(*) from public.v_apex_roster
        where is_producing and last_deal < v_today - 45) as dormant_producers
  )
  select jsonb_build_object(
    'as_of', v_today,
    'scope', coalesce(p_scope, 'agency'),
    'today', jsonb_build_object(
      'personal_ap', (select personal_ap from daily),
      'personal_policies', (select personal_policies from daily),
      'team_ap', (select team_ap from daily),
      'team_policies', (select team_policies from daily)),
    'mtd', jsonb_build_object(
      'personal_ap', (select personal_ap from period_totals),
      'personal_policies', (select personal_policies from period_totals),
      'team_ap', (select team_ap from period_totals),
      'team_policies', (select team_policies from period_totals),
      'goal', v_goal,
      'pct_to_goal', case when v_goal > 0 then round(((select team_ap from period_totals) / v_goal) * 100) else 0 end,
      'days_left', greatest(v_end - v_today, 0),
      'window_start', v_start,
      'window_end', v_end),
    'lifetime', jsonb_build_object('ap', (select ap from lifetime), 'policies', (select policies from lifetime)),
    'trend', coalesce((select rows from trend), '[]'::jsonb),
    'leaderboard', coalesce((select rows from board), '[]'::jsonb),
    'policy_status', coalesce((select tiles from statuses), '{}'::jsonb),
    'roster', jsonb_build_object(
      'total', (select total from roster),
      'producing', (select producing from roster),
      'in_onboarding', (select in_onboarding from roster)),
    'needs_attention', jsonb_build_object(
      'lapse_pending', (select lapse_pending from attention),
      'in_chargeback_window', (select in_chargeback_window from attention),
      'dormant_producers', (select dormant_producers from attention))
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.apex_home_dashboard(text, date, date) from public, anon, authenticated;

commit;
