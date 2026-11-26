-- MP-PROJ-INP-TRUTH (2026-11-25): projections, the 30-day run-rate and the
-- issued-not-paid age each read ONE definition.
--
-- What was wrong, measured live at 18:29 America/Phoenix on 2026-11-25:
--   * v_agent_20k_target_leaderboard (the $20K pace board) built "this month" and
--     "day of month" from now() in UTC, divided MTD by the PARTIAL current day with
--     no history guard, and read raw public.deals ($112,328 / 68 deals MTD), while
--     scoped_production_projection (the production scoreboard, one screen away)
--     used Phoenix completed days with a 3-day guard on the canonical comp truth
--     ($131,658 / 78, incl. 13 Discord-posted deals). Same producer, same month,
--     two projections: Edwin Ac-lumor $30,024 vs $36,500; Jontay Taylor $35,795 vs
--     $37,785. From 17:00 Phoenix the board also divided by one extra day, and on
--     the last day of a month its MTD reset seven hours early.
--   * v_production_origin_freshness compared a 31-day window (d-30 .. d inclusive)
--     against a 30-day prior window (d-60 .. d-31). The boundary day d-30 alone
--     carried 8 native deals / $12,234, so the CFO headline read +20.9% MoM
--     ("NATIVE_BOOK_GROWING") where equal 30-day windows read +0.3% ($131,082 vs
--     $130,731). v_cfo_native_producer_falloff shared the window, so every
--     per-producer delta inherited the same tilt.
--   * v_cfo_native_payment_reconciliation aged native deals as the UTC date minus
--     a Phoenix date, so from 17:00 Phoenix every age was one day too old (oldest
--     95d vs 94d) and the >60d chase cohort could grow at dinner time instead of
--     midnight. Seven CFO scripts carried a byte-copy of the same expression.
--   * fn_goal_scorecard projected period end as actual / fraction-of-period
--     INCLUDING today: a third formula, 31x the first day's production on day 1.
--
-- Column lists and output keys are unchanged on every object below, so dependents
-- (v_cfo_dark_feed_only_producers, v_cfo_faller_dark_feed_overlap,
-- v_licensed_hire_clock, mat_recruit_funnel_person, the Target20kPaceWidget row
-- type, the CFO sheet generators) keep working without edits.
begin;

-- ---------------------------------------------------------------------------
-- 1) ONE projection. Mirrors src/lib/productionRunRate.ts exactly: an arithmetic
--    extrapolation of COMPLETED Phoenix days, at least the current actual, and
--    NULL (never a number) until three completed days carry production.
-- ---------------------------------------------------------------------------
create or replace function public.fn_pace_projection(
  p_actual numeric,
  p_completed_actual numeric,
  p_completed_days integer,
  p_completed_active_days integer,
  p_total_days integer
) returns numeric
language sql immutable parallel safe
as $$
  select case
    when p_actual is null or p_completed_actual is null or p_completed_days is null
      or p_completed_active_days is null or p_total_days is null
      or p_total_days < 1 or p_completed_days < 0 or p_completed_days >= p_total_days
      or p_actual < 0 or p_completed_actual < 0 or p_completed_actual > p_actual
      or p_completed_active_days > p_completed_days
    then null
    when p_completed_days < 3 or p_completed_active_days < 3 or p_completed_actual <= 0
    then null
    else round(greatest(p_actual, p_completed_actual / p_completed_days * p_total_days), 2)
  end
$$;
comment on function public.fn_pace_projection(numeric, numeric, integer, integer, integer) is
  'Period-end projection = posted ALP through yesterday / completed Phoenix days x days in the period, at least the current actual. NULL until three completed days carry production. The single source for v_agent_20k_target_leaderboard, scoped_production_projection and fn_goal_scorecard; mirrors src/lib/productionRunRate.ts.';
grant execute on function public.fn_pace_projection(numeric, numeric, integer, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) The production scoreboard's projection calls the shared function. Its
--    behaviour is unchanged (it already used completed Phoenix days and the
--    3-day guard); only the formula's home moves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoped_production_projection_uncached()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_month_end date := (date_trunc('month', v_today) + interval '1 month')::date;
  v_elapsed_days integer := extract(day from v_today)::integer;
  v_days_in_month integer := extract(day from (v_month_end - interval '1 day'))::integer;
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[] := '{}'::uuid[];
  v_hier_ids uuid[] := '{}'::uuid[];
  v_scope_ids uuid[] := '{}'::uuid[];
  v_vantage_head constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  v_gap_visible boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null or public.fn_user_login_blocked(auth.uid()) or public.fn_user_is_suspended(auth.uid()) then
    raise exception 'authentication required';
  end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid())
    into v_has_profile;

  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_personal_ids
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  where a.user_id = auth.uid();

  select coalesce(array_agg(distinct h.member)
    filter (where not public.fn_agent_is_roster_excluded(h.member)), '{}'::uuid[])
    into v_hier_ids
  from public.fn_hierarchy_first_hops(v_personal_ids) h;

  if v_is_admin then
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
      into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    select coalesce(array_agg(distinct t.id), '{}'::uuid[])
      into v_scope_ids
    from unnest(v_personal_ids || v_hier_ids) as t(id);
  end if;

  -- A legacy aggregate Vantage snapshot is visible to the owner/admin only.
  -- It contributes to agency/IMO pace, but never to a named producer's pace.
  v_gap_visible := v_is_admin;

  with production as (
    select
      c.origin,
      c.agent_id,
      c.raw_agent_id,
      c.annual_premium,
      c.posted_date,
      (c.agent_id = any(v_personal_ids) and c.origin <> 'external_daily_gap') as is_self,
      c.agency, c.synced_at,
      (c.agent_id = any(v_hier_ids) and not c.agent_id = any(v_personal_ids) and c.origin <> 'external_daily_gap') as is_downline
    from public.mv_production_comp_truth c
    where c.posted_date >= v_month_start
      and c.posted_date <= v_today
      and (c.origin <> 'apex_native' or exists(select 1 from public.deals nd where nd.id::text=c.row_key and nd.posted_at <= now()))
      and (
        (c.origin <> 'external_daily_gap' and c.agent_id = any(v_scope_ids))
        or (c.origin = 'external_daily_gap' and v_gap_visible)
      )
  ), buckets as (
    select 'personal'::text as bucket, 'Personal'::text as label,
      annual_premium, posted_date
    from production where is_self
    union all
    select 'team', 'Downline only', annual_premium, posted_date from production where is_downline
    union all
    select 'imo', 'Full IMO', annual_premium, posted_date from production
      where v_is_admin
  ), bucket_metrics as (
    select bucket, label,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date) filter (where annual_premium > 0)::integer as active_days,
      coalesce(sum(annual_premium) filter (where posted_date < v_today),0) as completed_ap,
      count(distinct posted_date) filter (where posted_date < v_today and annual_premium > 0)::integer as completed_active_days
    from buckets
    group by bucket, label
  ), bucket_complete as (
    select seed.bucket, seed.label,
      coalesce(m.policies, 0) as policies,
      coalesce(m.mtd_ap, 0) as mtd_ap,
      coalesce(m.active_days, 0) as active_days,
      coalesce(m.completed_ap,0) as completed_ap,
      coalesce(m.completed_active_days,0) as completed_active_days
    from (values ('personal', 'Personal'), ('team', 'Downline only'), ('imo', 'Full IMO')) seed(bucket, label)
    left join bucket_metrics m on m.bucket = seed.bucket
    where seed.bucket <> 'imo' or v_is_admin
  ), bucket_json as (
    select jsonb_object_agg(bucket, jsonb_build_object(
      'label', label,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'completed_ap', completed_ap, 'completed_active_days', completed_active_days,
      'projected_ap', public.fn_pace_projection(mtd_ap, completed_ap, v_elapsed_days - 1, completed_active_days, v_days_in_month),
      'estimate_status', case
        when public.fn_pace_projection(mtd_ap, completed_ap, v_elapsed_days - 1, completed_active_days, v_days_in_month) is null then 'insufficient_history'
        else 'run_rate' end
    )) as value
    from bucket_complete
  ), agency_metrics as (
    select agency,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date) filter (where annual_premium > 0)::integer as active_days,
      coalesce(sum(annual_premium) filter (where posted_date < v_today),0) as completed_ap,
      count(distinct posted_date) filter (where posted_date < v_today and annual_premium > 0)::integer as completed_active_days
    from production
    group by agency
  ), agencies as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agency', agency,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'completed_ap', completed_ap, 'completed_active_days', completed_active_days,
      'projected_ap', public.fn_pace_projection(mtd_ap, completed_ap, v_elapsed_days - 1, completed_active_days, v_days_in_month),
      'estimate_status', case
        when public.fn_pace_projection(mtd_ap, completed_ap, v_elapsed_days - 1, completed_active_days, v_days_in_month) is null then 'insufficient_history'
        else 'run_rate' end
    ) order by mtd_ap desc), '[]'::jsonb) as value
    from agency_metrics
  )
  select jsonb_build_object(
    'as_of', v_today,
    'month_start', v_month_start,
    'month_end_exclusive', v_month_end,
    'elapsed_calendar_days', v_elapsed_days,
    'completed_calendar_days', greatest(v_elapsed_days - 1,0),
    'method', 'completed_calendar_run_rate',
    'team_includes_personal', false,
    'last_synced_at', (select max(synced_at) from production),
    'days_in_month', v_days_in_month,
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when cardinality(v_hier_ids) = 0 then 'Personal book'
      else 'You + ' || cardinality(v_hier_ids) || ' downline'
    end,
    'personal', coalesce((select value -> 'personal' from bucket_json), '{}'::jsonb),
    'team', coalesce((select value -> 'team' from bucket_json), '{}'::jsonb),
    'imo', case when v_is_admin then (select value -> 'imo' from bucket_json) else null end,
    'agencies', (select value from agencies),
    'basis', 'Arithmetic run rate = posted ALP through yesterday / completed Phoenix calendar days x days in the month, at least current MTD. Requires three completed days with posted production. Today is excluded from the pace sample; future-dated rows are excluded. Downline excludes personal production. This estimate does not predict issued or paid business.'
  ) into v_result;

  return v_result;
end;
$function$;
revoke all on function public.scoped_production_projection_uncached() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) The $20K pace board: Phoenix calendar, the canonical comp truth (the same
--    rows the scoreboard, producer profile and finances read), the shared
--    projection. Columns, types and order are identical to the previous view.
--    pace_verdict gains 'pace_unavailable' for a producer with production but
--    fewer than three completed selling days: the board says so instead of
--    extrapolating one day into a month.
-- ---------------------------------------------------------------------------
create or replace view public.v_agent_20k_target_leaderboard as
with cal as (
  select
    (now() at time zone 'America/Phoenix')::date as today,
    date_trunc('month', (now() at time zone 'America/Phoenix')::date)::date as month_start,
    extract(day from (date_trunc('month', (now() at time zone 'America/Phoenix')::date) + interval '1 month - 1 day'))::integer as days_in_month
), canonical_agents as (
  select a.id, a.profile_id, a.agent_code, a.display_name, a.license_status, a.created_at
  from public.agents a
  where a.canonical_agent_id is null
    and a.status = 'active'::agent_status
    and not public.is_placeholder_agent(a.agent_code, a.user_id)
), prod as (
  select c.agent_id, c.annual_premium, c.posted_date, c.policy_number
  from public.mv_production_comp_truth c
  cross join cal
  where c.origin <> 'external_daily_gap'
    and c.posted_date >= cal.month_start
    and c.posted_date <= cal.today
    and (c.origin <> 'apex_native'
         or exists (select 1 from public.deals nd where nd.id::text = c.row_key and nd.posted_at <= now()))
), base as (
  select
    ca.id as agent_id,
    coalesce(nullif(p.full_name, ''), nullif(ca.display_name, ''), nullif(ca.agent_code, ''), 'Agent ' || left(ca.id::text, 8)) as name,
    p.email,
    ca.license_status,
    ca.created_at::date as hired,
    count(pr.agent_id)::bigint as deals_mtd,
    coalesce(sum(pr.annual_premium), 0)::integer as ap_mtd,
    count(pr.agent_id) filter (where pr.policy_number is null or btrim(pr.policy_number) = '')::bigint as deals_no_policy_mtd,
    coalesce(sum(pr.annual_premium) filter (where pr.policy_number is null or btrim(pr.policy_number) = ''), 0)::integer as ap_at_risk_mtd,
    coalesce(sum(pr.annual_premium) filter (where pr.posted_date < cal.today), 0) as completed_ap,
    count(distinct pr.posted_date) filter (where pr.posted_date < cal.today and pr.annual_premium > 0)::integer as completed_active_days,
    cal.today,
    cal.days_in_month
  from canonical_agents ca
  cross join cal
  left join public.profiles p on p.id = ca.profile_id
  left join prod pr on pr.agent_id = ca.id
  group by ca.id, ca.agent_code, ca.display_name, p.full_name, p.email, ca.license_status, ca.created_at, cal.today, cal.days_in_month
), scored as (
  select b.*,
    public.fn_pace_projection(b.ap_mtd::numeric, b.completed_ap, extract(day from b.today)::integer - 1, b.completed_active_days, b.days_in_month) as proj
  from base b
)
select
  agent_id,
  name,
  email,
  license_status,
  hired,
  deals_mtd,
  ap_mtd,
  deals_no_policy_mtd,
  ap_at_risk_mtd,
  greatest(20000 - ap_mtd, 0) as ap_to_20k,
  proj::integer as projected_eom_ap,
  case
    when ap_mtd >= 20000 then 'hit_20k'
    when ap_mtd > 0 and proj is null then 'pace_unavailable'
    when ap_mtd > 0 and proj >= 20000 then 'on_pace_20k'
    when ap_mtd > 0 then 'below_pace'
    when hired > today - 30 then 'new_hire_grace'
    else 'zero_mtd'
  end as pace_verdict
from scored
where (deals_mtd > 0 or ap_mtd > 0 or hired > today - 30)
  -- Read scope: the admin sees the agency; anyone else sees only producers they
  -- may read (self + hierarchy), the same rule the scoreboard RPC applies.
  and (public.apex_is_admin() or public.production_can_read_agent(agent_id))
order by ap_mtd desc nulls last, proj desc nulls last;
comment on view public.v_agent_20k_target_leaderboard is
  'Per-producer pace to $20,000 posted ALP this Phoenix calendar month, read from mv_production_comp_truth (the same source as scoped_production_projection / the production scoreboard). projected_eom_ap is fn_pace_projection: posted ALP through yesterday / completed days x days in the month, at least MTD, NULL (pace_unavailable) until three completed days carry production. Rows are scoped to what the caller may read.';
-- The previous view carried no SELECT grant for authenticated (has_table_privilege
-- = false on 2026-11-25), so every browser read of the $20K pace board returned
-- 42501 and the widget showed its feed-error card. Restore the grant; the scope
-- gate above is what makes that safe.
grant select on public.v_agent_20k_target_leaderboard to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) The goal scorecard's "on pace to finish" uses the shared projection on
--    completed days. pace_pct ("should be at X today") is a target line and is
--    deliberately unchanged. Output keys are identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_goal_scorecard(p_agent_id uuid, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := public.has_role(v_caller, 'admin'::public.app_role);
  v_caller_agent uuid := (select id from public.agents where user_id = v_caller order by created_at limit 1);
  v_allowed boolean;
  v_sam uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
  v_sam_pct numeric := coalesce((select pct from public.fn_agent_contract_pct(v_sam) limit 1), 125);
  v_name text; v_mgr_id uuid; v_own_pct numeric; v_own_prov text;
  v_goal record; v_ps date := p_period_start; v_pe date := p_period_end;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_days_total int; v_days_elapsed int; v_days_remaining int; v_frac numeric;
  v_personal_actual numeric := 0; v_downline_actual numeric := 0; v_team_actual numeric := 0;
  v_personal_deals int := 0; v_downline_deals int := 0; v_team_deals int := 0;
  v_team_completed numeric := 0; v_team_completed_days int := 0;
  v_recruit_actual int := 0; v_team_members int := 0; v_producing int := 0;
  v_downline_frac numeric; v_override_spread numeric;
  v_personal_at_goal numeric; v_downline_at_goal numeric;
  v_mgr_income numeric; v_sam_income numeric; v_total_proj numeric;
  v_pace numeric; v_needed_day numeric; v_proj_eom numeric; v_status text;
  v_upcoming boolean; v_ended boolean;
  v_avg_deal numeric; v_win_start date; v_biz_remaining int;
  v_deals_to_goal int; v_deals_remaining int; v_deals_per_week numeric; v_deals_per_day numeric;
  v_ap_per_day numeric; v_recruits_needed int; v_ap_per_recruit numeric;
begin
  select display_name, manager_id into v_name, v_mgr_id from public.agents where id = p_agent_id;
  v_allowed := v_is_admin
    or (v_caller_agent is not null and v_caller_agent = p_agent_id)
    or (v_caller_agent is not null and v_caller_agent = v_mgr_id);
  if not v_allowed then return jsonb_build_object('error','forbidden'); end if;

  -- Resolve the active goal period when not given: the goal that contains today,
  -- else the nearest upcoming goal, else the most recent past goal.
  if v_ps is null or v_pe is null then
    select g.period_start, g.period_end into v_ps, v_pe
    from public.team_goals g where g.agent_id = p_agent_id
    order by
      case when v_today between g.period_start and g.period_end then 0
           when g.period_start > v_today then 1 else 2 end,
      case when g.period_start > v_today then g.period_start end asc nulls last,
      g.period_start desc
    limit 1;
  end if;
  if v_ps is null then
    return jsonb_build_object('agent_id', p_agent_id, 'name', v_name, 'has_goal', false, 'status','no_goal');
  end if;

  select * into v_goal from public.team_goals g
   where g.agent_id = p_agent_id and g.period_start = v_ps and g.period_end = v_pe limit 1;

  v_own_pct := coalesce((select pct from public.fn_agent_contract_pct(p_agent_id) limit 1), 60);
  v_own_prov := coalesce((select provenance from public.fn_agent_contract_pct(p_agent_id) limit 1), 'assumed_base');

  select coalesce(sum(annual_premium),0), count(*) into v_personal_actual, v_personal_deals
    from public.v_production_canonical
   where agent_id = p_agent_id and posted_date between v_ps and v_pe and annual_premium is not null;

  select coalesce(sum(p.annual_premium),0), count(p.*), count(distinct h.member),
         count(distinct p.agent_id) filter (where p.agent_id is not null)
    into v_downline_actual, v_downline_deals, v_team_members, v_producing
    from public.mv_hierarchy_hops h
    left join public.v_production_canonical p
      on p.agent_id = h.member and p.posted_date between v_ps and v_pe and p.annual_premium is not null
   where h.root = p_agent_id;

  v_team_actual := v_personal_actual + v_downline_actual;
  v_team_deals := v_personal_deals + v_downline_deals;

  -- Completed-day sample for the projection: the same tree, posted before today.
  select coalesce(sum(p.annual_premium),0), count(distinct p.posted_date) filter (where p.annual_premium > 0)
    into v_team_completed, v_team_completed_days
    from public.v_production_canonical p
   where p.posted_date between v_ps and v_pe and p.posted_date < v_today and p.annual_premium is not null
     and (p.agent_id = p_agent_id
          or p.agent_id in (select h.member from public.mv_hierarchy_hops h where h.root = p_agent_id));

  select count(*) into v_recruit_actual from public.agents
   where manager_id = p_agent_id and status <> 'terminated'
     and created_at >= v_ps::timestamptz and created_at < (v_pe + 1)::timestamptz;

  v_days_total := greatest((v_pe - v_ps) + 1, 1);
  v_days_elapsed := least(greatest((v_today - v_ps) + 1, 0), v_days_total);
  v_days_remaining := greatest(v_days_total - v_days_elapsed, 0);
  v_frac := round(v_days_elapsed::numeric / v_days_total, 4);
  v_upcoming := v_today < v_ps;
  v_ended := v_today > v_pe;

  -- average deal size: this tree's trailing 120d, else agency, floored so the
  -- "deals needed" math never divides by a tiny number.
  v_avg_deal := coalesce(
    (select avg(annual_premium) from public.v_production_canonical p
      where p.annual_premium > 0 and p.posted_date > v_today - 120
        and (p.agent_id = p_agent_id or p.agent_id in (select member from public.mv_hierarchy_hops where root = p_agent_id))),
    (select avg(annual_premium) from public.v_production_canonical where annual_premium > 0 and posted_date > v_today - 120),
    1600);
  v_avg_deal := greatest(round(v_avg_deal), 500);

  v_win_start := greatest(v_today, v_ps);
  select count(*) into v_biz_remaining
    from generate_series(v_win_start, v_pe, interval '1 day') d
    where extract(dow from d) not in (0,6);

  if v_goal.id is not null then
    -- Split personal vs downline from TRAILING 120d, not the current period (which is
  -- 0 for an upcoming month and would credit the whole goal as personal, overstating
  -- a team manager's income). This is the stable historical production mix.
  v_downline_frac := (
    select case when (pers + dl) > 0 then round(dl / (pers + dl), 4) else 0 end
    from (
      select
        (select coalesce(sum(annual_premium),0) from public.v_production_canonical p
          where p.agent_id = p_agent_id and p.posted_date > v_today - 120) as pers,
        (select coalesce(sum(p.annual_premium),0) from public.mv_hierarchy_hops h
          join public.v_production_canonical p on p.agent_id = h.member and p.posted_date > v_today - 120
          where h.root = p_agent_id) as dl
    ) s
  );
    v_override_spread := greatest(v_own_pct - coalesce((
        select avg(coalesce((select pct from public.fn_agent_contract_pct(d.id) limit 1), 60))
          from public.agents d where d.manager_id = p_agent_id and d.status <> 'terminated'), v_own_pct), 0);
    v_personal_at_goal := v_goal.team_ap_goal * (1 - v_downline_frac);
    v_downline_at_goal := v_goal.team_ap_goal * v_downline_frac;
    v_mgr_income := round(v_personal_at_goal * v_own_pct/100 + v_downline_at_goal * v_override_spread/100, 2);
    v_total_proj := coalesce(v_goal.income_goal, v_mgr_income);
    v_sam_income := round(v_goal.team_ap_goal * greatest(v_sam_pct - v_own_pct, 0)/100, 2);

    -- breakdown
    v_deals_to_goal := ceil(v_goal.team_ap_goal / v_avg_deal);
    v_deals_remaining := greatest(ceil(greatest(v_goal.team_ap_goal - v_team_actual, 0) / v_avg_deal), 0);
    v_deals_per_day := case when v_biz_remaining > 0 then round(v_deals_remaining::numeric / v_biz_remaining, 1) else null end;
    v_deals_per_week := case when v_biz_remaining > 0 then round(v_deals_remaining::numeric / (v_biz_remaining::numeric/5), 1) else null end;
    v_ap_per_day := case when v_biz_remaining > 0 then round(greatest(v_goal.team_ap_goal - v_team_actual,0) / v_biz_remaining) else null end;
    v_recruits_needed := greatest(coalesce(v_goal.recruit_goal,0) - v_recruit_actual, 0);
    v_ap_per_recruit := case when coalesce(v_goal.recruit_goal,0) > 0 then round(v_goal.team_ap_goal / v_goal.recruit_goal) else null end;

    if v_upcoming then v_status := 'upcoming';
    elsif v_ended then v_status := case when v_team_actual >= v_goal.team_ap_goal then 'hit' else 'missed' end;
    else
      v_pace := case when v_goal.team_ap_goal > 0 and v_frac > 0 then round(v_team_actual / (v_goal.team_ap_goal * v_frac) * 100, 1) else null end;
      -- Shared projection: completed days through yesterday, NULL for the first
      -- three days (the card prints a dash instead of 31x the first day).
      v_proj_eom := public.fn_pace_projection(
        v_team_actual, v_team_completed,
        least(greatest(v_days_elapsed - 1, 0), v_days_total),
        v_team_completed_days, v_days_total);
      v_status := case when v_pace is null then 'no_goal' when v_pace >= 105 then 'ahead' when v_pace >= 90 then 'on_track' else 'behind' end;
    end if;
    v_needed_day := v_ap_per_day;
  end if;

  return jsonb_build_object(
    'agent_id', p_agent_id, 'name', v_name,
    'period_start', v_ps, 'period_end', v_pe,
    'period_label', trim(to_char(v_ps, 'FMMonth YYYY')),
    'has_goal', v_goal.id is not null, 'upcoming', v_upcoming, 'ended', v_ended,
    'own_pct', v_own_pct, 'own_prov', v_own_prov, 'sam_pct', v_sam_pct,
    'days_total', v_days_total, 'days_elapsed', v_days_elapsed, 'days_remaining', v_days_remaining, 'frac', v_frac,
    'biz_days_remaining', v_biz_remaining,
    'personal_ap_actual', round(v_personal_actual,2), 'downline_ap_actual', round(v_downline_actual,2),
    'team_ap_actual', round(v_team_actual,2), 'team_deals_actual', v_team_deals,
    'team_members', v_team_members, 'producing_members', v_producing, 'recruit_actual', v_recruit_actual,
    'personal_ap_goal', v_goal.personal_ap_goal, 'team_ap_goal', v_goal.team_ap_goal,
    'recruit_goal', coalesce(v_goal.recruit_goal,0), 'label', v_goal.label,
    'override_spread', v_override_spread, 'downline_frac', v_downline_frac,
    'projected_mgr_income', v_mgr_income, 'projected_total_income', v_total_proj, 'projected_sam_override', v_sam_income,
    'pace_pct', v_pace, 'needed_per_day', v_needed_day, 'projected_eom', v_proj_eom, 'status', coalesce(v_status,'no_goal'),
    -- the plan to hit it
    'avg_deal_size', v_avg_deal,
    'deals_to_goal', v_deals_to_goal, 'deals_remaining', v_deals_remaining,
    'deals_per_week', v_deals_per_week, 'deals_per_day', v_deals_per_day, 'ap_per_day', v_ap_per_day,
    'recruits_needed', v_recruits_needed, 'ap_per_recruit', v_ap_per_recruit
  );
end $function$;

-- ---------------------------------------------------------------------------
-- 5) Equal 30-day windows. Current = (d-30, d] = the 30 Phoenix days ending today.
--    Prior = (d-60, d-30] = the 30 days before those. The dead-feed "blind"
--    window already used this shape; the MoM windows now match it.
-- ---------------------------------------------------------------------------
create or replace view public.v_production_origin_freshness as
 WITH p AS (
         SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS d
        ), lp AS (
         SELECT u.origin,
            max(u.posted_date) AS last_posted
           FROM v_production_unified u
          WHERE u.agent_id IS NOT NULL
          GROUP BY u.origin
        ), agg AS (
         SELECT u.origin,
            lp.last_posted,
            count(*) FILTER (WHERE u.posted_date > (p.d - 30) AND u.posted_date <= p.d) AS deals_30d,
            round(COALESCE(sum(u.annual_premium) FILTER (WHERE u.posted_date > (p.d - 30) AND u.posted_date <= p.d), 0::numeric), 2) AS alp_30d,
            count(*) FILTER (WHERE u.posted_date > (p.d - 60) AND u.posted_date <= (p.d - 30)) AS deals_prior_30d,
            round(COALESCE(sum(u.annual_premium) FILTER (WHERE u.posted_date > (p.d - 60) AND u.posted_date <= (p.d - 30)), 0::numeric), 2) AS alp_prior_30d,
            round(COALESCE(sum(u.annual_premium) FILTER (WHERE u.posted_date > (lp.last_posted - 30) AND u.posted_date <= lp.last_posted), 0::numeric), 2) AS blind_30d,
            count(*) FILTER (WHERE u.posted_date > (lp.last_posted - 30) AND u.posted_date <= lp.last_posted) AS blind_deals_30d
           FROM v_production_unified u
             CROSS JOIN p
             JOIN lp ON lp.origin = u.origin
          WHERE u.agent_id IS NOT NULL
          GROUP BY u.origin, lp.last_posted
        )
 SELECT origin,
    last_posted,
    (( SELECT p.d
           FROM p)) - last_posted AS days_dark,
    deals_30d,
    alp_30d,
    deals_prior_30d,
    alp_prior_30d,
        CASE
            WHEN deals_30d > 0 AND ((( SELECT p.d
               FROM p)) - last_posted) <= 14 THEN 'live'::text
            WHEN deals_30d > 0 THEN 'DYING'::text
            WHEN origin = ANY (ARRAY['agentlink'::text]) THEN
            CASE
                WHEN ((( SELECT p.d
                   FROM p)) - last_posted) <= 14 THEN 'idle'::text
                ELSE 'dormant'::text
            END
            WHEN blind_30d > 0::numeric THEN 'DARK'::text
            WHEN ((( SELECT p.d
               FROM p)) - last_posted) <= 14 THEN 'idle'::text
            ELSE 'dormant'::text
        END AS verdict,
    blind_30d,
    blind_deals_30d,
    origin = ANY (ARRAY['agentlink'::text]) AS is_retired
   FROM agg a
  ORDER BY blind_30d DESC;

create or replace view public.v_cfo_native_producer_falloff as
 WITH p AS (
         SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS d
        ), agr AS (
         SELECT u.agent_id,
            max(u.posted_date) AS last_native_write,
            count(*) FILTER (WHERE u.posted_date > (p.d - 30) AND u.posted_date <= p.d) AS deals_30d,
            round(COALESCE(sum(u.annual_premium) FILTER (WHERE u.posted_date > (p.d - 30) AND u.posted_date <= p.d), 0::numeric), 2) AS alp_30d,
            count(*) FILTER (WHERE u.posted_date > (p.d - 60) AND u.posted_date <= (p.d - 30)) AS deals_prior_30d,
            round(COALESCE(sum(u.annual_premium) FILTER (WHERE u.posted_date > (p.d - 60) AND u.posted_date <= (p.d - 30)), 0::numeric), 2) AS alp_prior_30d
           FROM v_production_unified u
             CROSS JOIN p
          WHERE u.origin = 'apex_native'::text AND u.agent_id IS NOT NULL
          GROUP BY u.agent_id
        )
 SELECT agr.agent_id,
    a.display_name,
    a.status AS roster_status,
    a.license_status,
    a.user_id IS NOT NULL AS has_login,
    agr.last_native_write,
    (( SELECT p.d
           FROM p)) - agr.last_native_write AS days_since_write,
    agr.deals_prior_30d,
    agr.alp_prior_30d,
    agr.deals_30d,
    agr.alp_30d,
    agr.alp_30d - agr.alp_prior_30d AS delta_alp,
        CASE
            WHEN agr.alp_prior_30d > 0::numeric THEN round((agr.alp_30d - agr.alp_prior_30d) / agr.alp_prior_30d * 100::numeric, 1)
            ELSE NULL::numeric
        END AS pct_change,
        CASE
            WHEN agr.alp_prior_30d >= 5000::numeric AND agr.alp_30d = 0::numeric THEN 'WENT_DARK'::text
            WHEN agr.alp_prior_30d >= 5000::numeric AND ((agr.alp_30d - agr.alp_prior_30d) / agr.alp_prior_30d) <= '-0.40'::numeric THEN 'CRATERING'::text
            WHEN (agr.alp_30d - agr.alp_prior_30d) < 0::numeric THEN 'slipping'::text
            WHEN (agr.alp_30d - agr.alp_prior_30d) > 0::numeric THEN 'growing'::text
            ELSE 'flat'::text
        END AS falloff_verdict,
    'Native WRITTEN-ALP run-rate per producer over two EQUAL 30-day Phoenix windows: current = the 30 days ending today, prior = the 30 days before those. delta_alp is a FORWARD run-rate signal (new business that stopped being written), NOT recoverable past revenue and NOT a collection loss. SUM(delta_alp) ties to v_production_run_rate_truth native MoM change to the cent. WENT_DARK = stopped cold (re-activation call #1); CRATERING = still writing but pace >=40% down; slipping/growing = normal variance. Floor $5000 prior-30d ALP.'::text AS data_caveat
   FROM agr
     JOIN agents a ON a.id = agr.agent_id
  WHERE agr.alp_30d <> 0::numeric OR agr.alp_prior_30d <> 0::numeric
  ORDER BY (agr.alp_30d - agr.alp_prior_30d);

create or replace view public.v_production_run_rate_truth as
 WITH o AS (
         SELECT v_production_origin_freshness.origin,
            v_production_origin_freshness.verdict,
            v_production_origin_freshness.alp_30d,
            v_production_origin_freshness.alp_prior_30d,
            v_production_origin_freshness.deals_30d::integer AS deals_30d,
            v_production_origin_freshness.days_dark
           FROM v_production_origin_freshness
        ), agg AS (
         SELECT COALESCE(sum(o.alp_30d) FILTER (WHERE o.origin = 'apex_native'::text), 0::numeric) AS native_alp_30d,
            COALESCE(sum(o.alp_prior_30d) FILTER (WHERE o.origin = 'apex_native'::text), 0::numeric) AS native_alp_prior_30d,
            COALESCE(sum(o.deals_30d) FILTER (WHERE o.origin = 'apex_native'::text), 0::bigint) AS native_deals_30d,
            COALESCE(sum(o.alp_30d) FILTER (WHERE o.origin <> 'apex_native'::text AND o.alp_30d > 0::numeric), 0::numeric) AS external_live_alp_30d,
            COALESCE(sum(o.alp_prior_30d) FILTER (WHERE o.origin <> 'apex_native'::text AND (o.verdict = ANY (ARRAY['DARK'::text, 'DYING'::text]))), 0::numeric) AS external_dark_prior_alp,
            COALESCE(sum(o.alp_30d), 0::numeric) AS blended_alp_30d,
            COALESCE(sum(o.alp_prior_30d), 0::numeric) AS blended_alp_prior_30d,
            string_agg(
                CASE
                    WHEN o.origin <> 'apex_native'::text AND (o.verdict = ANY (ARRAY['DARK'::text, 'DYING'::text])) THEN ((((((o.origin || '('::text) || o.verdict) || ','::text) || o.days_dark) || 'd,$'::text) || round(o.alp_prior_30d)) || ')'::text
                    ELSE NULL::text
                END, ', '::text ORDER BY o.alp_prior_30d DESC) AS dead_feeds
           FROM o
        ), nat AS (
         SELECT COALESCE(round(sum(u.annual_premium) FILTER (WHERE u.posted_date > ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 90) AND u.posted_date <= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)) / 2.0, 2), 0::numeric) AS native_baseline_monthly_avg
           FROM v_production_unified u
          WHERE u.origin = 'apex_native'::text AND u.agent_id IS NOT NULL
        )
 SELECT agg.native_alp_30d,
    agg.native_alp_prior_30d,
    round(
        CASE
            WHEN agg.native_alp_prior_30d > 0::numeric THEN (agg.native_alp_30d - agg.native_alp_prior_30d) / agg.native_alp_prior_30d * 100::numeric
            ELSE NULL::numeric
        END, 1) AS native_pct_change,
    agg.external_live_alp_30d,
    agg.external_dark_prior_alp,
    agg.blended_alp_30d,
    agg.blended_alp_prior_30d,
    round(
        CASE
            WHEN agg.blended_alp_prior_30d > 0::numeric THEN (agg.blended_alp_30d - agg.blended_alp_prior_30d) / agg.blended_alp_prior_30d * 100::numeric
            ELSE NULL::numeric
        END, 1) AS blended_pct_change,
    agg.blended_alp_prior_30d - agg.blended_alp_30d AS blended_drop_alp,
        CASE
            WHEN (agg.blended_alp_prior_30d - agg.blended_alp_30d) > 0::numeric THEN round(agg.external_dark_prior_alp / (agg.blended_alp_prior_30d - agg.blended_alp_30d) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS pct_of_drop_from_dead_feeds,
    agg.dead_feeds,
        CASE
            WHEN agg.native_alp_prior_30d > 0::numeric AND (abs(agg.native_alp_30d - agg.native_alp_prior_30d) / agg.native_alp_prior_30d) <= 0.15 AND (agg.blended_alp_prior_30d - agg.blended_alp_30d) > 0::numeric AND agg.external_dark_prior_alp >= (0.5 * (agg.blended_alp_prior_30d - agg.blended_alp_30d)) THEN 'NATIVE_FLAT_HEADLINE_DROP_IS_DEAD_FEEDS'::text
            WHEN agg.native_alp_prior_30d > 0::numeric AND ((agg.native_alp_30d - agg.native_alp_prior_30d) / agg.native_alp_prior_30d) < '-0.15'::numeric AND (nat.native_baseline_monthly_avg <= 0::numeric OR ((agg.native_alp_30d - nat.native_baseline_monthly_avg) / nat.native_baseline_monthly_avg) < '-0.15'::numeric) THEN 'NATIVE_BOOK_GENUINELY_DOWN'::text
            WHEN agg.native_alp_prior_30d > 0::numeric AND ((agg.native_alp_30d - agg.native_alp_prior_30d) / agg.native_alp_prior_30d) < '-0.15'::numeric THEN 'NATIVE_SOFTENING_PRIOR_MONTH_PEAK'::text
            WHEN agg.native_alp_prior_30d > 0::numeric AND ((agg.native_alp_30d - agg.native_alp_prior_30d) / agg.native_alp_prior_30d) > 0.15 THEN 'NATIVE_BOOK_GROWING'::text
            ELSE 'NATIVE_FLAT_FEEDS_HEALTHY'::text
        END AS verdict,
    now() AS measured_at,
    nat.native_baseline_monthly_avg,
        CASE
            WHEN nat.native_baseline_monthly_avg > 0::numeric THEN round((agg.native_alp_30d - nat.native_baseline_monthly_avg) / nat.native_baseline_monthly_avg * 100::numeric, 1)
            ELSE NULL::numeric
        END AS native_vs_baseline_pct
   FROM agg
     CROSS JOIN nat;

-- ---------------------------------------------------------------------------
-- 6) ONE age for an issued-not-paid native deal: Phoenix today minus the
--    Phoenix posted date. The CFO view and every CFO script call this.
-- ---------------------------------------------------------------------------
create or replace function public.fn_cfo_native_age_days(p_posted_at timestamptz, p_created_at timestamptz)
returns integer
language sql stable
as $$
  select ((now() at time zone 'America/Phoenix')::date
        - (coalesce(p_posted_at, p_created_at) at time zone 'America/Phoenix')::date)::integer
$$;
comment on function public.fn_cfo_native_age_days(timestamptz, timestamptz) is
  'Age in whole Phoenix calendar days of a native deal: Phoenix today minus the Phoenix date of coalesce(posted_at, created_at). The single age used by v_cfo_native_payment_reconciliation and the CFO issued-not-paid generators; never mix a UTC date into it.';
grant execute on function public.fn_cfo_native_age_days(timestamptz, timestamptz) to authenticated, service_role;

create or replace view public.v_cfo_native_payment_reconciliation as
 WITH native AS (
         SELECT d.id,
            d.annual_premium,
            COALESCE(NULLIF(btrim(d.policy_status_standard), ''::text), d.status) AS pss,
            public.fn_cfo_native_age_days(d.posted_at, d.created_at) AS age_days,
            d.updated_at > (d.created_at + '00:02:00'::interval) AS touched_after_create,
            d.status_updated_at IS NOT NULL AND d.status_updated_at > (d.created_at + '00:02:00'::interval) AS status_progressed
           FROM deals d
          WHERE d.source::text = 'apex_native'::text AND d.annual_premium IS NOT NULL
        ), cls AS (
         SELECT native.id,
            native.annual_premium,
            native.pss,
            native.age_days,
            native.touched_after_create,
            native.status_progressed,
                CASE
                    WHEN lower(native.pss) = ANY (ARRAY['active'::text, 'in force'::text, 'in_force'::text, 'inforce'::text, 'paid'::text]) THEN 'confirmed_paid'::text
                    WHEN lower(native.pss) = ANY (ARRAY['issued, not paid'::text, 'issued not paid'::text, 'issued_not_paid'::text]) THEN 'issued_unpaid'::text
                    WHEN lower(native.pss) = ANY (ARRAY['pending'::text, 'approved'::text, 'in review'::text, 'in_review'::text, 'underwriting'::text, 'submitted'::text]) THEN 'in_underwriting'::text
                    WHEN lower(native.pss) = ANY (ARRAY['lapsed'::text, 'cancelled'::text, 'canceled'::text, 'charged_back'::text, 'chargeback'::text, 'declined'::text, 'withdrawn'::text, 'not_taken'::text, 'not_in_force'::text, 'surrendered'::text, 'terminated'::text]) THEN 'fell_off'::text
                    ELSE 'other'::text
                END AS pay_class
           FROM native
        )
 SELECT count(*) AS native_deals,
    COALESCE(sum(annual_premium), 0::numeric)::numeric(14,2) AS alp_gross_written,
    count(*) FILTER (WHERE pay_class = 'confirmed_paid'::text) AS paid_n,
    COALESCE(sum(annual_premium) FILTER (WHERE pay_class = 'confirmed_paid'::text), 0::numeric)::numeric(14,2) AS paid_alp,
    count(*) FILTER (WHERE pay_class = 'issued_unpaid'::text) AS issued_unpaid_n,
    COALESCE(sum(annual_premium) FILTER (WHERE pay_class = 'issued_unpaid'::text), 0::numeric)::numeric(14,2) AS issued_unpaid_alp,
    count(*) FILTER (WHERE pay_class = 'in_underwriting'::text) AS underwriting_n,
    COALESCE(sum(annual_premium) FILTER (WHERE pay_class = 'in_underwriting'::text), 0::numeric)::numeric(14,2) AS underwriting_alp,
    count(*) FILTER (WHERE pay_class = 'fell_off'::text) AS fell_off_n,
    COALESCE(sum(annual_premium) FILTER (WHERE pay_class = 'fell_off'::text), 0::numeric)::numeric(14,2) AS fell_off_alp,
    count(*) FILTER (WHERE pay_class = 'other'::text) AS other_n,
    count(*) FILTER (WHERE pay_class = 'issued_unpaid'::text AND age_days >= 46 AND age_days <= 60) AS inp_aging_46_60_n,
    count(*) FILTER (WHERE pay_class = 'issued_unpaid'::text AND age_days > 60) AS inp_over_60d_n,
    COALESCE(sum(annual_premium) FILTER (WHERE pay_class = 'issued_unpaid'::text AND age_days > 60), 0::numeric)::numeric(14,2) AS inp_over_60d_alp,
    max(age_days) FILTER (WHERE pay_class = 'issued_unpaid'::text) AS oldest_unpaid_days,
    round(100.0 * count(*) FILTER (WHERE touched_after_create)::numeric / NULLIF(count(*), 0)::numeric, 1) AS pct_touched_after_create,
    round(100.0 * count(*) FILTER (WHERE status_progressed)::numeric / NULLIF(count(*), 0)::numeric, 1) AS pct_status_progressed,
    'GROSS WRITTEN, not collected. Ages are whole Phoenix calendar days (fn_cfo_native_age_days), never a UTC date minus a Phoenix date. The outcome field policy_status_standard has NEVER progressed on these rows: pct_status_progressed is the share whose status_updated_at ever advanced past creation (0.0 = not one native deal, ever). pct_touched_after_create (~10%) counts ANY row edit, NOT a status change, and must not be read as status follow-up. confirmed_paid is the ONLY realized-revenue bucket; issued_unpaid aging past ~45-60d is the chargeback / never-in-force precursor. NO $-at-risk is claimed - the reconciliation feed is DARK. The MANUAL remedy is NOT a naive button (VERIFIED 2026-11-16): all 224 native deals are frozen at deals.status=''submitted'' v1, and transition_apex_deal_status cannot reach a paid state from ''submitted'' in one hop - it must pass through ''approved'', whose ''approved''/''issued''/''in_force'' hops UNCONDITIONALLY fire outbox_events (discord, skool, insuracloud ''deal.approved'') and insert a production_ledger ''approved_alp'' row with NO source=''apex_native'' guard. Native deals have 0 production_ledger rows today, so wiring that RPC as-is would blast stale new-deal celebrations to Discord, push months-old imports to InsuraCloud, and inject 224 deals of fresh qualifying production (double-count). SAFE remedies: (1) a native-only write path (new RPC reconcile_native_deal_payment, or a source=''apex_native'' special-case in transition_apex_deal_status) that updates ONLY policy_status_standard + status_updated_at + deal_status_history + audit_log, with NO outbox_events and NO production_ledger write, surfaced as a Mark-Paid/Lapsed control on BookOfBusiness / My Deals (RLS admin+manager) - the view buckets on lower(pss) so its writes re-bucket correctly; or (2) restore a carrier/InsuraCloud payment-status feed. UPDATE 2026-11-21 (MP-CFO-NATIVE-RECONCILE-WRITE-PATH): remedy (1) IS SHIPPED - reconcile_native_deal_payment(deal_id, outcome paid|lapsed|not_taken, reason, expected_version) updates ONLY policy_status_standard+status_updated_at+version, fires ZERO outbox_events/production_ledger (proven against every deals trigger; admin OR manager-over-agent). UPDATE 2026-11-25 (MP-PROJ-INP-TRUTH): the Mark paid / Lapsed / Not taken control is live on My Deals for admins and managers (NativePaymentReconcile, fn_native_deal_reconcile_context supplies the row version). REMAINING for this cohort to self-clear: the per-policy producer confirms, or a restored carrier/InsuraCloud payment-status feed (dark since AgentLink retired 2026-10-17).'::text AS data_caveat,
    now() AS as_of
   FROM cls;

-- ---------------------------------------------------------------------------
-- 7) The row context the Mark-paid control needs (deals.version for the RPC's
--    optimistic lock) under the SAME authorization as reconcile_native_deal_payment:
--    admin, or a manager who can read this agent. Managers have no RLS read on
--    public.deals, so without this they could never obtain the version.
-- ---------------------------------------------------------------------------
create or replace function public.fn_native_deal_reconcile_context(p_deal_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_deal record;
  v_is_admin boolean;
  v_is_manager boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select d.id, d.version, d.source, d.status, d.policy_status_standard, d.status_updated_at, d.agent_id
    into v_deal
    from public.deals d
   where d.id = p_deal_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  v_is_admin   := public.apex_is_admin();
  v_is_manager := public.apex_has_any_role(array['manager']);
  if not v_is_admin and not (v_is_manager and public.apex_can_read_agent(v_deal.agent_id)) then
    raise exception 'Not permitted to reconcile this deal' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'found', true,
    'deal_id', v_deal.id,
    'version', v_deal.version,
    'source', v_deal.source,
    'status', v_deal.status,
    'policy_status_standard', coalesce(nullif(btrim(v_deal.policy_status_standard), ''), v_deal.status),
    'status_updated_at', v_deal.status_updated_at,
    'reconcilable', coalesce(v_deal.source, '') = 'apex_native'
  );
end;
$$;
revoke all on function public.fn_native_deal_reconcile_context(uuid) from public, anon;
grant execute on function public.fn_native_deal_reconcile_context(uuid) to authenticated, service_role;

commit;
