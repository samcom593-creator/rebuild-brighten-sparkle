-- One finance truth for dashboards, the Finance page, leaderboards, profiles,
-- and exports. Every estimate starts with the deduped unified production ledger.

begin;

create or replace view public.v_production_comp_truth
with (security_invoker = on) as
with canonical_agents as (
  select
    coalesce(m.canonical_agent_id, a.id) as canon,
    max(coalesce(p.full_name, a.display_name)) as display_name,
    max(a.contract_percentage) filter (
      where a.contract_percentage between 0 and 200
        and a.contract_percentage <> 120
    ) as explicit_comp,
    max(a.contract_percentage) filter (
      where a.contract_percentage = 120
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = a.user_id
            and ur.role::text in ('admin', 'super_admin', 'owner')
        )
    ) as owner_comp
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  left join public.profiles p on p.id = a.user_id
  group by 1
), comp_by_name as (
  select lower(btrim(agent_name)) as name_key, max(avg_comp_pct) as avg_comp_pct
  from public.agent_comp_levels
  where avg_comp_pct between 0 and 200
  group by 1
)
select
  u.row_key,
  u.origin,
  u.agent_id as raw_agent_id,
  coalesce(m.canonical_agent_id, u.agent_id) as agent_id,
  coalesce(ca.display_name, u.agent_name) as agent_name,
  u.client_name,
  u.carrier,
  u.product,
  u.policy_number,
  u.annual_premium,
  u.posted_date,
  u.effective_date,
  u.status,
  u.synced_at,
  coalesce(ca.explicit_comp, cbn.avg_comp_pct, ca.owner_comp, 60)::numeric as seller_comp_pct,
  u.annual_premium * coalesce(ca.explicit_comp, cbn.avg_comp_pct, ca.owner_comp, 60) / 100.0
    as direct_estimate
from public.v_production_unified u
left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
left join canonical_agents ca on ca.canon = coalesce(m.canonical_agent_id, u.agent_id)
left join comp_by_name cbn on cbn.name_key = lower(btrim(u.agent_name));

grant select on public.v_production_comp_truth to authenticated, service_role;

comment on view public.v_production_comp_truth is
  'Canonical deduped production with one resolved comp percentage and per-deal direct estimate. Resolution: explicit non-placeholder account comp, AgentLink average, owner 120, then 60.';

create or replace function public.finances_overview(
  p_scope text default 'agency',
  p_month date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date;
  v_scope text := lower(coalesce(p_scope, 'agency'));
  v_is_admin boolean := public.apex_is_admin();
  v_is_manager boolean := public.apex_has_any_role(array['manager']);
  v_personal_ids uuid[];
  v_scope_ids uuid[];
  v_caller_comp numeric;
  v_caller_name text;
  v_kpis jsonb;
  v_team_kpis jsonb;
  v_quad jsonb;
  v_forecast jsonb;
  v_payouts jsonb;
  v_breakdown jsonb;
  v_production jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if v_scope not in ('mine', 'agency', 'imo') then v_scope := 'agency'; end if;
  if not v_is_admin and not v_is_manager then v_scope := 'mine'; end if;
  if v_scope = 'imo' and not v_is_admin then v_scope := 'agency'; end if;

  v_month_start := coalesce(date_trunc('month', p_month)::date, date_trunc('month', v_today)::date);

  with caller_canon as (
    select distinct coalesce(m.canonical_agent_id, a.id) as id
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where a.user_id = auth.uid()
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_personal_ids from caller_canon;

  select
    coalesce(
      max(a.contract_percentage) filter (
        where a.contract_percentage between 0 and 200
          and a.contract_percentage <> 120
      ),
      max(a.contract_percentage) filter (
        where v_is_admin and a.contract_percentage = 120
      )
    ),
    max(coalesce(p.full_name, a.display_name))
  into v_caller_comp, v_caller_name
  from public.agents a
  left join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid();

  if v_caller_comp is null then
    select max(c.avg_comp_pct) into v_caller_comp
    from public.agent_comp_levels c
    where lower(btrim(c.agent_name)) = lower(btrim(v_caller_name));
  end if;
  v_caller_comp := coalesce(v_caller_comp, 60);

  if v_scope = 'mine' then
    v_scope_ids := v_personal_ids;
  elsif v_is_admin then
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    with recursive roots as (
      select a.id
      from public.agents a
      left join public.v_agent_canonical_map m on m.agent_id = a.id
      where coalesce(m.canonical_agent_id, a.id) = any(v_personal_ids)
    ), hierarchy(id) as (
      select id from roots
      union
      select child.id
      from public.agents child
      join hierarchy parent
        on child.manager_id = parent.id
        or child.invited_by_manager_id = parent.id
        or child.switched_to_manager_id = parent.id
    )
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, h.id)), '{}'::uuid[])
    into v_scope_ids
    from hierarchy h
    left join public.v_agent_canonical_map m on m.agent_id = h.id
    where not public.fn_agent_is_roster_excluded(h.id);
  end if;

  drop table if exists _apex_finance_truth;
  create temp table _apex_finance_truth on commit drop as
  select
    t.*,
    coalesce(t.agent_id = any(v_personal_ids), false) as is_mine,
    case
      when v_scope = 'imo' then t.direct_estimate
      when coalesce(t.agent_id = any(v_personal_ids), false)
        then t.annual_premium * v_caller_comp / 100.0
      else t.annual_premium * greatest(v_caller_comp - t.seller_comp_pct, 0) / 100.0
    end as viewer_estimate,
    case
      when v_scope = 'imo' then 'team_direct'
      when coalesce(t.agent_id = any(v_personal_ids), false) then 'direct'
      else 'override'
    end as component
  from public.v_production_comp_truth t
  where t.agent_id = any(v_scope_ids);

  select jsonb_build_object(
    'today', coalesce(round(sum(viewer_estimate) filter (where posted_date = v_today), 2), 0),
    'forecast_90d', coalesce(round(sum(viewer_estimate) filter (where posted_date >= v_today - 89), 2), 0),
    'mtd', coalesce(round(sum(viewer_estimate) filter (where posted_date >= date_trunc('month', v_today)::date), 2), 0),
    'ytd', coalesce(round(sum(viewer_estimate) filter (where posted_date >= date_trunc('year', v_today)::date), 2), 0)
  ) into v_kpis from _apex_finance_truth;

  select jsonb_build_object(
    'today', coalesce(round(sum(direct_estimate) filter (where posted_date = v_today), 2), 0),
    'mtd', coalesce(round(sum(direct_estimate) filter (where posted_date >= date_trunc('month', v_today)::date), 2), 0),
    'ytd', coalesce(round(sum(direct_estimate) filter (where posted_date >= date_trunc('year', v_today)::date), 2), 0)
  ) into v_team_kpis from _apex_finance_truth;

  select jsonb_build_object(
    'policies', count(*)::int,
    'alp', coalesce(sum(annual_premium), 0),
    'producers', count(distinct agent_id)::int,
    'last_synced_at', max(synced_at)
  ) into v_production from _apex_finance_truth;

  select jsonb_build_object(
    'direct_ytd', coalesce(round(sum(viewer_estimate) filter (
      where component in ('direct', 'team_direct')
        and posted_date >= date_trunc('year', v_today)::date), 2), 0),
    'override_pending', coalesce(round(sum(viewer_estimate) filter (
      where component = 'override'
        and posted_date >= date_trunc('year', v_today)::date), 2), 0),
    'trail_pending', coalesce(round(sum(viewer_estimate * 0.25) filter (
      where posted_date > v_today - 365
        and lower(coalesce(status, '')) not in ('lapsed','cancelled','charged_back','withdrawn','not_taken')), 2), 0),
    'renewal_pending', coalesce(round(sum(viewer_estimate * 0.05) filter (
      where posted_date <= v_today - 730), 2), 0)
  ) into v_quad from _apex_finance_truth;

  with run as (
    select
      coalesce(sum(viewer_estimate) filter (
        where component in ('direct', 'team_direct') and posted_date >= v_today - 89), 0) / 3.0 as direct_m,
      coalesce(sum(viewer_estimate) filter (
        where component = 'override' and posted_date >= v_today - 89), 0) / 3.0 as override_m
    from _apex_finance_truth
  ), cohorts as (
    select date_trunc('month', posted_date)::date as cm,
      sum(viewer_estimate) * 0.25 / 3.0 as trail_slice
    from _apex_finance_truth
    where posted_date > v_today - 365
    group by 1
  ), months as (
    select (date_trunc('month', v_today)::date + interval '1 month' * gs)::date as m
    from generate_series(0, 11) gs
  )
  select jsonb_agg(jsonb_build_object(
    'month', to_char(months.m, 'YYYY-MM'),
    'direct', round(run.direct_m),
    'override', round(run.override_m),
    'trail', round(coalesce((
      select sum(c.trail_slice) from cohorts c
      where months.m >= (c.cm + interval '9 months')::date
        and months.m < (c.cm + interval '12 months')::date
    ), 0)),
    'renewal', 0
  ) order by months.m)
  into v_forecast
  from months cross join run;

  with month_rows as (
    select * from _apex_finance_truth
    where posted_date >= v_month_start
      and posted_date < (v_month_start + interval '1 month')::date
    order by posted_date desc, viewer_estimate desc
    limit 500
  )
  select jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'total', coalesce(round(sum(viewer_estimate), 2), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'date', posted_date,
      'agent', agent_name,
      'client', client_name,
      'carrier', carrier,
      'product', product,
      'ap', annual_premium,
      'est', round(viewer_estimate, 2),
      'component', component
    ) order by posted_date desc, viewer_estimate desc), '[]'::jsonb)
  ) into v_payouts from month_rows;

  select jsonb_build_object(
    'by_carrier', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select coalesce(nullif(btrim(carrier), ''), 'Carrier N/A') as name,
        count(*)::int as deals, round(sum(annual_premium)) as ap, round(sum(viewer_estimate)) as est
      from _apex_finance_truth where posted_date > v_today - 365
      group by 1 order by sum(viewer_estimate) desc limit 20
    ) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select coalesce(nullif(btrim(product), ''), 'Product N/A') as name,
        count(*)::int as deals, round(sum(annual_premium)) as ap, round(sum(viewer_estimate)) as est
      from _apex_finance_truth where posted_date > v_today - 365
      group by 1 order by sum(viewer_estimate) desc limit 20
    ) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
      select to_char(date_trunc('month', posted_date), 'YYYY-MM') as name,
        count(*)::int as deals, round(sum(annual_premium)) as ap, round(sum(viewer_estimate)) as est
      from _apex_finance_truth where posted_date > v_today - 365
      group by 1
    ) x), '[]'::jsonb),
    'by_agent_overrides', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select agent_name as name, count(*)::int as deals,
        round(sum(annual_premium)) as ap, round(sum(viewer_estimate)) as est
      from _apex_finance_truth
      where component = 'override' and posted_date > v_today - 365
      group by 1 having sum(viewer_estimate) > 0
      order by sum(viewer_estimate) desc limit 30
    ) x), '[]'::jsonb)
  ) into v_breakdown;

  return jsonb_build_object(
    'scope', v_scope,
    'as_of', v_today,
    'comp_note', 'Unified posted production. Comp order: explicit saved rate, AgentLink average, owner rate, then 60%. Agency income is your direct commission plus positive downline comp spread.',
    'kpis', v_kpis,
    'team_kpis', v_team_kpis,
    'production', v_production,
    'commission_types', v_quad,
    'forecast', coalesce(v_forecast, '[]'::jsonb),
    'payouts', v_payouts,
    'breakdown', v_breakdown
  );
end;
$fn$;

revoke all on function public.finances_overview(text, date) from public, anon;
grant execute on function public.finances_overview(text, date) to authenticated, service_role;

create or replace function public.scoped_production_scoreboard(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_start date := coalesce(p_start, v_today);
  v_end date := coalesce(p_end, v_today + 1);
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[];
  v_scope_ids uuid[];
  v_downline_count integer := 0;
  v_caller_comp numeric;
  v_caller_name text;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if v_end <= v_start then raise exception 'end date must be after start date'; end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid()) into v_has_profile;

  with caller_canon as (
    select distinct coalesce(m.canonical_agent_id, a.id) as id
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where a.user_id = auth.uid()
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_personal_ids from caller_canon;

  select
    coalesce(
      max(a.contract_percentage) filter (
        where a.contract_percentage between 0 and 200 and a.contract_percentage <> 120
      ),
      max(a.contract_percentage) filter (where v_is_admin and a.contract_percentage = 120)
    ),
    max(coalesce(p.full_name, a.display_name))
  into v_caller_comp, v_caller_name
  from public.agents a
  left join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid();

  if v_caller_comp is null then
    select max(c.avg_comp_pct) into v_caller_comp
    from public.agent_comp_levels c
    where lower(btrim(c.agent_name)) = lower(btrim(v_caller_name));
  end if;
  v_caller_comp := coalesce(v_caller_comp, 60);

  if v_is_admin then
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    with recursive roots as (
      select a.id
      from public.agents a
      left join public.v_agent_canonical_map m on m.agent_id = a.id
      where coalesce(m.canonical_agent_id, a.id) = any(v_personal_ids)
    ), hierarchy(id) as (
      select id from roots
      union
      select child.id
      from public.agents child
      join hierarchy parent
        on child.manager_id = parent.id
        or child.invited_by_manager_id = parent.id
        or child.switched_to_manager_id = parent.id
    )
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, h.id)), '{}'::uuid[])
    into v_scope_ids
    from hierarchy h
    left join public.v_agent_canonical_map m on m.agent_id = h.id
    where not public.fn_agent_is_roster_excluded(h.id);
  end if;

  v_downline_count := greatest(
    coalesce(cardinality(v_scope_ids), 0) - coalesce(cardinality(v_personal_ids), 0), 0
  );

  with production as (
    select * from public.v_production_comp_truth t
    where t.posted_date >= v_start
      and t.posted_date < v_end
      and t.agent_id = any(v_scope_ids)
  ), totals as (
    select
      coalesce(sum(annual_premium) filter (where agent_id = any(v_personal_ids)), 0) as personal_ap,
      count(*) filter (where agent_id = any(v_personal_ids))::int as personal_policies,
      coalesce(sum(annual_premium), 0) as team_ap,
      count(*)::int as team_policies,
      max(synced_at) as last_synced_at
    from production
  ), earnings as (
    select
      coalesce(round(sum(annual_premium * v_caller_comp / 100.0) filter (
        where agent_id = any(v_personal_ids)), 2), 0) as direct,
      coalesce(round(sum(annual_premium * greatest(v_caller_comp - seller_comp_pct, 0) / 100.0) filter (
        where not (agent_id = any(v_personal_ids))), 2), 0) as override,
      coalesce(round(sum(direct_estimate), 2), 0) as team_estimated
    from production
  )
  select jsonb_build_object(
    'as_of', v_today,
    'window', jsonb_build_object('start', v_start, 'end_exclusive', v_end),
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when v_downline_count = 0 then 'Personal book'
      else 'You + ' || v_downline_count || ' downline'
    end,
    'downline_agents', v_downline_count,
    'personal', jsonb_build_object(
      'ap', (select personal_ap from totals),
      'policies', (select personal_policies from totals)
    ),
    'team', jsonb_build_object(
      'ap', (select team_ap from totals),
      'policies', (select team_policies from totals)
    ),
    'earnings', jsonb_build_object(
      'estimated', (select direct + override from earnings),
      'direct', (select direct from earnings),
      'override', (select override from earnings),
      'team_estimated', (select team_estimated from earnings),
      'basis', 'Unified production and resolved compensation truth'
    ),
    'last_synced_at', (select last_synced_at from totals),
    'source', 'v_production_comp_truth'
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.scoped_production_scoreboard(date, date) from public, anon;
grant execute on function public.scoped_production_scoreboard(date, date) to authenticated, service_role;

create or replace function public.leaderboard_board(p_start date, p_end date)
returns table(
  agent_key text, agent_id uuid, agent_name text, avatar_url text,
  deals bigint, ap numeric, est_earnings numeric, lead_cost numeric,
  first_policy_date date, tenure_label text, weeks_with_agency integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  with grouped as (
    select
      coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key,
      t.agent_id,
      min(t.agent_name) as raw_name,
      count(*) as deals,
      sum(t.annual_premium) as ap,
      sum(t.direct_estimate) as est_earnings,
      min(t.posted_date) as first_policy_date
    from public.v_production_comp_truth t
    where t.posted_date >= p_start and t.posted_date < p_end
    group by 1, 2
  )
  select g.agent_key, g.agent_id,
    coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name,
    pr.avatar_url, g.deals, g.ap, g.est_earnings,
    coalesce((select value::numeric from public.system_settings where key = 'board_lead_cost'), 750),
    g.first_policy_date,
    case
      when g.first_policy_date is null then 'New'
      when current_date - g.first_policy_date < 7 then (current_date - g.first_policy_date)::int || ' days in'
      when current_date - g.first_policy_date < 56 then ((current_date - g.first_policy_date) / 7)::int || ' weeks in'
      when current_date - g.first_policy_date < 365 then ((current_date - g.first_policy_date) / 30)::int || ' months in'
      else round(((current_date - g.first_policy_date) / 365.0)::numeric, 1)::text || ' yrs in'
    end,
    greatest(((current_date - g.first_policy_date) / 7)::int, 0)
  from grouped g
  left join public.agents a on a.id = g.agent_id
  left join public.profiles pr on pr.id = a.profile_id
  order by g.ap desc, g.deals desc, agent_name asc;
$fn$;

revoke all on function public.leaderboard_board(date, date) from public, anon;
grant execute on function public.leaderboard_board(date, date) to authenticated, service_role;

create or replace view public.v_earnings_estimate
with (security_invoker = on) as
select
  t.agent_id,
  min(t.agent_name) as agent_name,
  max(coalesce(mgr.display_name, 'unassigned')) as manager,
  round(max(t.seller_comp_pct), 1) as contract_pct,
  count(*)::bigint as in_force_deals,
  round(sum(t.direct_estimate), 0) as est_earned_in_force,
  round(sum(t.direct_estimate) filter (
    where lower(coalesce(t.status, '')) in ('submitted', 'pending', 'in review', 'approved')
  ), 0) as est_pending_if_issued,
  round(sum(t.direct_estimate) filter (
    where t.posted_date >= (now() at time zone 'America/Phoenix')::date - 30
  ), 0) as est_earned_30d,
  round(sum(t.direct_estimate) filter (
    where t.posted_date >= date_trunc('month', now() at time zone 'America/Phoenix')::date
  ), 0) as est_earned_mtd,
  'ESTIMATE — unified valid annual premium x resolved comp. This is not a carrier-paid statement.'::text as basis,
  count(*) filter (
    where lower(coalesce(t.status, '')) in ('active', 'issued', 'approved')
  )::bigint as confirmed_active_deals,
  round(sum(t.direct_estimate) filter (
    where lower(coalesce(t.status, '')) in ('active', 'issued', 'approved')
  ), 0) as est_confirmed_active
from public.v_production_comp_truth t
left join public.agents a on a.id = t.agent_id
left join public.agents mgr on mgr.id = a.manager_id
group by t.agent_id;

grant select on public.v_earnings_estimate to authenticated, service_role;

commit;
