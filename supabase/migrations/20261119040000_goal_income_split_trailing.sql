-- MP-303.2 — manager "income at goal" split comes from trailing-120d production
-- mix, not the current period. In an upcoming month the current-period split is
-- 0, which credited the entire team goal as the manager's personal writing and
-- overstated income (Chudi read $510k vs a true ~$234k). Trailing mix is stable
-- and identical whether the period is upcoming or live. Money model unchanged.

create or replace function public.fn_goal_scorecard(
  p_agent_id uuid, p_period_start date default null, p_period_end date default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
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
      v_proj_eom := case when v_frac > 0 then round(v_team_actual / v_frac, 2) else null end;
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
end $$;

revoke all on function public.fn_goal_scorecard(uuid,date,date) from public;
grant execute on function public.fn_goal_scorecard(uuid,date,date) to authenticated;

-- Board unchanged from 030000, included so this migration reflects the full
-- current definition of the goal surfaces (guard reads one file).
create or replace function public.fn_owner_goal_board(p_period_start date default null, p_period_end date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_caller uuid := (select auth.uid());
  v_rows jsonb := '[]'::jsonb; r record; card jsonb;
  v_ps date := p_period_start; v_pe date := p_period_end;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  t_team_goal numeric := 0; t_team_actual numeric := 0; t_sam numeric := 0; t_mgr numeric := 0;
begin
  if not (public.is_sam() or public.has_role(v_caller,'admin'::public.app_role)) then
    return jsonb_build_object('error','forbidden');
  end if;
  -- resolve the active period across all goals when not given
  if v_ps is null or v_pe is null then
    select g.period_start, g.period_end into v_ps, v_pe
    from public.team_goals g
    group by g.period_start, g.period_end
    order by
      case when v_today between g.period_start and g.period_end then 0
           when g.period_start > v_today then 1 else 2 end,
      case when g.period_start > v_today then g.period_start end asc nulls last,
      g.period_start desc
    limit 1;
  end if;
  if v_ps is null then
    return jsonb_build_object('period_start', null, 'managers', '[]'::jsonb,
      'total_team_goal', 0, 'total_team_actual', 0, 'total_projected_sam_override', 0, 'total_projected_mgr_income', 0);
  end if;

  for r in
    select g.agent_id, g.subject_name, g.team_ap_goal, g.recruit_goal
      from public.team_goals g
     where g.period_start = v_ps and g.period_end = v_pe
     order by g.team_ap_goal desc nulls last
  loop
    if r.agent_id is not null then
      card := public.fn_goal_scorecard(r.agent_id, v_ps, v_pe);
      t_team_goal := t_team_goal + coalesce((card->>'team_ap_goal')::numeric,0);
      t_team_actual := t_team_actual + coalesce((card->>'team_ap_actual')::numeric,0);
      t_sam := t_sam + coalesce((card->>'projected_sam_override')::numeric,0);
      t_mgr := t_mgr + coalesce((card->>'projected_total_income')::numeric,0);
      v_rows := v_rows || jsonb_build_array(card);
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'agent_id', null, 'name', r.subject_name, 'unmatched', true,
        'team_ap_goal', r.team_ap_goal, 'recruit_goal', r.recruit_goal,
        'period_start', v_ps, 'period_end', v_pe, 'status','unmatched'));
      t_team_goal := t_team_goal + coalesce(r.team_ap_goal,0);
    end if;
  end loop;
  return jsonb_build_object(
    'period_start', v_ps, 'period_end', v_pe, 'period_label', trim(to_char(v_ps,'FMMonth YYYY')),
    'managers', v_rows,
    'total_team_goal', t_team_goal, 'total_team_actual', round(t_team_actual,2),
    'total_projected_sam_override', round(t_sam,2), 'total_projected_mgr_income', round(t_mgr,2));
end $$;

revoke all on function public.fn_owner_goal_board(date,date) from public;
grant execute on function public.fn_owner_goal_board(date,date) to authenticated;
