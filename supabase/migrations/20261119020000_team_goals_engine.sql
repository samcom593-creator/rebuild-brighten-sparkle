-- MP-303 — Galaxy goals engine: team_goals + fn_goal_scorecard + fn_owner_goal_board.
-- Additive, idempotent. Money model = the scoreboard's first-hop override (MP-328):
-- Sam's income from a manager's tree = team_AP * (sam_pct - mgr_pct)/100; never seller-comp.
-- Production truth = v_production_canonical.posted_date (NOT agentlink_book, retired).
-- mv_hierarchy_hops is root->member and EXCLUDES self, so team = personal + hops members.

create table if not exists public.team_goals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete cascade,
  subject_name text,                       -- for whiteboard names with no agent row yet
  period_start date not null,
  period_end date not null,
  label text,
  personal_ap_goal numeric not null default 0,
  team_ap_goal numeric not null default 0,  -- total tree production target (incl. personal)
  recruit_goal integer not null default 0,
  income_goal numeric,                      -- optional manual override of the projection
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_goals_subject_ck check (agent_id is not null or subject_name is not null),
  constraint team_goals_period_ck check (period_end >= period_start)
);
create unique index if not exists team_goals_agent_period_uq
  on public.team_goals(agent_id, period_start, period_end) where agent_id is not null;
create index if not exists team_goals_period_idx on public.team_goals(period_start, period_end);

alter table public.team_goals enable row level security;
drop policy if exists team_goals_admin_all on public.team_goals;
create policy team_goals_admin_all on public.team_goals for all
  using ((select public.has_role((select auth.uid()),'admin'::public.app_role)))
  with check ((select public.has_role((select auth.uid()),'admin'::public.app_role)));
drop policy if exists team_goals_self_read on public.team_goals;
create policy team_goals_self_read on public.team_goals for select
  using (exists (select 1 from public.agents a where a.id = team_goals.agent_id and a.user_id = (select auth.uid())));

grant select on public.team_goals to authenticated;

-- updated_at touch
create or replace function public.tg_team_goals_touch() returns trigger
  language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_team_goals_touch on public.team_goals;
create trigger trg_team_goals_touch before update on public.team_goals
  for each row execute function public.tg_team_goals_touch();

-- One computor. Self-or-admin-or-direct-upline gate; returns the full pacing + projection payload.
create or replace function public.fn_goal_scorecard(
  p_agent_id uuid, p_period_start date, p_period_end date
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
  v_goal record;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_days_total int; v_days_elapsed int; v_days_remaining int; v_frac numeric;
  v_personal_actual numeric := 0; v_team_actual numeric := 0; v_downline_actual numeric := 0;
  v_recruit_actual int := 0; v_team_members int := 0; v_producing int := 0;
  v_downline_frac numeric; v_override_spread numeric;
  v_personal_at_goal numeric; v_downline_at_goal numeric;
  v_mgr_income numeric; v_sam_income numeric; v_total_proj numeric;
  v_pace numeric; v_needed_day numeric; v_proj_eom numeric; v_status text;
begin
  -- resolve goal (by agent or, if none, nothing)
  select * into v_goal from public.team_goals g
   where g.agent_id = p_agent_id and g.period_start = p_period_start and g.period_end = p_period_end limit 1;

  select display_name, manager_id into v_name, v_mgr_id from public.agents where id = p_agent_id;
  -- access: admin, self, or direct manager of the subject
  v_allowed := v_is_admin
    or (v_caller_agent is not null and v_caller_agent = p_agent_id)
    or (v_caller_agent is not null and v_caller_agent = v_mgr_id);
  if not v_allowed then
    return jsonb_build_object('error','forbidden');
  end if;

  v_own_pct := coalesce((select pct from public.fn_agent_contract_pct(p_agent_id) limit 1), 60);
  v_own_prov := coalesce((select provenance from public.fn_agent_contract_pct(p_agent_id) limit 1), 'assumed_base');

  -- actuals in the period (posted_date, Phoenix-bounded like v_manager_hierarchy_mtd)
  select coalesce(sum(annual_premium),0) into v_personal_actual
    from public.v_production_canonical
   where agent_id = p_agent_id and posted_date >= p_period_start and posted_date <= p_period_end;

  select coalesce(sum(p.annual_premium),0), count(distinct h.member),
         count(distinct p.agent_id) filter (where p.agent_id is not null)
    into v_downline_actual, v_team_members, v_producing
    from public.mv_hierarchy_hops h
    left join public.v_production_canonical p
      on p.agent_id = h.member and p.posted_date >= p_period_start and p.posted_date <= p_period_end
   where h.root = p_agent_id;

  v_team_actual := v_personal_actual + v_downline_actual;

  -- recruits added in the period
  select count(*) into v_recruit_actual from public.agents
   where manager_id = p_agent_id and status <> 'terminated'
     and created_at >= p_period_start::timestamptz
     and created_at < (p_period_end + 1)::timestamptz;

  -- time pacing
  v_days_total := greatest((p_period_end - p_period_start) + 1, 1);
  v_days_elapsed := least(greatest((v_today - p_period_start) + 1, 0), v_days_total);
  v_days_remaining := greatest(v_days_total - v_days_elapsed, 0);
  v_frac := round(v_days_elapsed::numeric / v_days_total, 4);

  -- projection math (first-hop override, MP-328). team_goal splits by observed downline share.
  v_downline_frac := case when v_team_actual > 0 then round(v_downline_actual / v_team_actual, 4) else 0 end;
  v_override_spread := greatest(v_own_pct - coalesce((
      select avg(coalesce((select pct from public.fn_agent_contract_pct(d.id) limit 1), 60))
        from public.agents d where d.manager_id = p_agent_id and d.status <> 'terminated'), v_own_pct), 0);

  if v_goal.id is not null then
    v_personal_at_goal := v_goal.team_ap_goal * (1 - v_downline_frac);
    v_downline_at_goal := v_goal.team_ap_goal * v_downline_frac;
    v_mgr_income := round(v_personal_at_goal * v_own_pct/100 + v_downline_at_goal * v_override_spread/100, 2);
    v_total_proj := coalesce(v_goal.income_goal, v_mgr_income);
    v_sam_income := round(v_goal.team_ap_goal * greatest(v_sam_pct - v_own_pct, 0)/100, 2);
    v_pace := case when v_goal.team_ap_goal > 0 and v_frac > 0
                   then round(v_team_actual / (v_goal.team_ap_goal * v_frac) * 100, 1) else null end;
    v_needed_day := case when v_days_remaining > 0
                   then round(greatest(v_goal.team_ap_goal - v_team_actual, 0) / v_days_remaining, 2) else 0 end;
    v_proj_eom := case when v_frac > 0 then round(v_team_actual / v_frac, 2) else null end;
    v_status := case when v_pace is null then 'no_goal'
                     when v_pace >= 105 then 'ahead'
                     when v_pace >= 90 then 'on_track'
                     else 'behind' end;
  end if;

  return jsonb_build_object(
    'agent_id', p_agent_id, 'name', v_name,
    'period_start', p_period_start, 'period_end', p_period_end,
    'has_goal', v_goal.id is not null,
    'own_pct', v_own_pct, 'own_prov', v_own_prov, 'sam_pct', v_sam_pct,
    'days_total', v_days_total, 'days_elapsed', v_days_elapsed, 'days_remaining', v_days_remaining, 'frac', v_frac,
    'personal_ap_actual', round(v_personal_actual,2), 'downline_ap_actual', round(v_downline_actual,2),
    'team_ap_actual', round(v_team_actual,2),
    'team_members', v_team_members, 'producing_members', v_producing, 'recruit_actual', v_recruit_actual,
    'personal_ap_goal', v_goal.personal_ap_goal, 'team_ap_goal', v_goal.team_ap_goal,
    'recruit_goal', coalesce(v_goal.recruit_goal,0), 'label', v_goal.label,
    'override_spread', v_override_spread, 'downline_frac', v_downline_frac,
    'projected_mgr_income', v_mgr_income, 'projected_total_income', v_total_proj,
    'projected_sam_override', v_sam_income,
    'pace_pct', v_pace, 'needed_per_day', v_needed_day, 'projected_eom', v_proj_eom, 'status', coalesce(v_status,'no_goal')
  );
end $$;

revoke all on function public.fn_goal_scorecard(uuid,date,date) from public;
grant execute on function public.fn_goal_scorecard(uuid,date,date) to authenticated;

-- Owner board: every manager goal in the window + Sam's projected override + grand totals.
create or replace function public.fn_owner_goal_board(p_period_start date, p_period_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_caller uuid := (select auth.uid());
  v_rows jsonb := '[]'::jsonb; r record; card jsonb;
  t_team_goal numeric := 0; t_team_actual numeric := 0; t_sam numeric := 0; t_mgr numeric := 0;
begin
  if not (public.is_sam() or public.has_role(v_caller,'admin'::public.app_role)) then
    return jsonb_build_object('error','forbidden');
  end if;
  for r in
    select g.agent_id, g.subject_name, g.team_ap_goal, g.recruit_goal
      from public.team_goals g
     where g.period_start = p_period_start and g.period_end = p_period_end
     order by g.team_ap_goal desc nulls last
  loop
    if r.agent_id is not null then
      card := public.fn_goal_scorecard(r.agent_id, p_period_start, p_period_end);
      t_team_goal := t_team_goal + coalesce((card->>'team_ap_goal')::numeric,0);
      t_team_actual := t_team_actual + coalesce((card->>'team_ap_actual')::numeric,0);
      t_sam := t_sam + coalesce((card->>'projected_sam_override')::numeric,0);
      t_mgr := t_mgr + coalesce((card->>'projected_total_income')::numeric,0);
      v_rows := v_rows || jsonb_build_array(card);
    else
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'agent_id', null, 'name', r.subject_name, 'unmatched', true,
        'team_ap_goal', r.team_ap_goal, 'recruit_goal', r.recruit_goal,
        'period_start', p_period_start, 'period_end', p_period_end, 'status','unmatched'));
      t_team_goal := t_team_goal + coalesce(r.team_ap_goal,0);
    end if;
  end loop;
  return jsonb_build_object(
    'period_start', p_period_start, 'period_end', p_period_end,
    'managers', v_rows,
    'total_team_goal', t_team_goal, 'total_team_actual', round(t_team_actual,2),
    'total_projected_sam_override', round(t_sam,2), 'total_projected_mgr_income', round(t_mgr,2));
end $$;

revoke all on function public.fn_owner_goal_board(date,date) from public;
grant execute on function public.fn_owner_goal_board(date,date) to authenticated;
