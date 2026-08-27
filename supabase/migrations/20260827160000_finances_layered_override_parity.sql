-- MP-328 — Finances income doctrine: flat/seller-comp override -> layered first-hop.
--
-- THE BUG (proven live 2026-08-27): finances_overview('agency') MTD reported
-- Sam's income at $60,037.95 while the dashboard's scoped_production_scoreboard
-- reported $35,424.12 for the identical window. Two surfaces, one person, one
-- month, a $24,613.83 disagreement on the single number Sam runs the business by.
--
-- ROOT CAUSE: finances_overview_base credited the viewer, on every downline
-- policy, the spread (viewer_comp - SELLER_comp). The seller sits at the BOTTOM
-- of the chain (~60-75%), so 120 - 65 = a 55-point override on production three
-- and four levels down -- double-counting every intermediate manager's spread,
-- which those managers actually earn. The layered truth (what the scoreboard
-- computes, and what an override actually pays) is the spread to your DIRECT
-- report only: (viewer_comp - FIRST_HOP_comp). For Sam over Vantage that is
-- 120 - 105 = 15 points, not 55. Intermediate spreads belong to the intermediate
-- managers, not rolled up whole to the top.
--
-- Also: the seller-comp model read comp from agents.contract_percentage (the
-- placeholder that is 120 for most rows) with an ad-hoc "<> 120 unless admin"
-- filter, NOT the canonical fn_agent_contract_pct the scoreboard trusts. And it
-- excluded the Vantage external_daily_gap entirely, so the agency's own daily
-- aggregate never reached the owner's income line.
--
-- THE FIX: rebuild _apex_finance_truth's per-row estimate to the scoreboard's
-- exact model -- first-hop override via fn_hierarchy_first_hops, canonical comp
-- via fn_agent_contract_pct, gap credited at the Vantage head. Every downstream
-- aggregate (kpis, commission_types, forecast, payouts, breakdown) reads
-- viewer_estimate/component, so fixing the two case expressions fixes all of
-- them in one pass -- no second scan, no delegation, no drift.
--
-- PROVEN before shipping: this scope + this model = $35,424.12 to the penny
-- (direct 792.00 + override 32,520.42 + gap 2,111.70), matching the scoreboard
-- exactly. 'mine' scope is unaffected (own rows only, all direct). 'imo' is a
-- separate agency-total lens and is left on direct_estimate untouched.

create or replace function public.finances_overview_base(p_scope text default 'agency'::text, p_month date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date;
  v_scope text := lower(coalesce(p_scope, 'agency'));
  v_is_admin boolean := public.apex_is_admin();
  v_is_manager boolean := public.apex_has_any_role(array['manager']);
  v_personal_ids uuid[];
  v_scope_ids uuid[];
  v_caller_comp numeric;
  -- Layered-override scaffolding, identical semantics to scoped_production_scoreboard.
  v_vantage_head constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  v_head_pct numeric;
  v_fallback constant numeric := 60;
  v_gap_visible boolean := false;
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

  -- Canonical caller comp (the scoreboard's viewer_pct), not the contract_percentage
  -- placeholder. Highest resolved pct across the caller's canonical agent rows.
  select max(p.pct) into v_caller_comp
  from unnest(v_personal_ids) as u(id)
  cross join lateral public.fn_agent_contract_pct(u.id) p;
  v_caller_comp := coalesce(v_caller_comp, v_fallback);

  select f.pct into v_head_pct from public.fn_agent_contract_pct(v_vantage_head) f;

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

  -- The Vantage daily gap is an agency aggregate: it belongs to the head and to
  -- whoever sits above the head, never to a leaf's "team". Same rule as the board.
  v_gap_visible := v_is_admin or (v_vantage_head = any(v_scope_ids));

  drop table if exists _apex_finance_truth;
  create temp table _apex_finance_truth on commit drop as
  with hops as (
    select h.member, h.first_hop
    from public.fn_hierarchy_first_hops(v_personal_ids) h
  )
  select
    t.*,
    coalesce(t.agent_id = any(v_personal_ids), false) as is_mine,
    case
      -- 'imo' is the agency-total lens: every seller's own full comp. Untouched.
      when v_scope = 'imo' then t.direct_estimate
      -- Vantage external daily gap, credited at the head like the scoreboard.
      when t.origin = 'external_daily_gap'
        then t.annual_premium * greatest(v_caller_comp - coalesce(v_head_pct, v_fallback), 0) / 100.0
      -- Own production: full comp.
      when coalesce(t.agent_id = any(v_personal_ids), false)
        then t.annual_premium * v_caller_comp / 100.0
      -- Downline not reachable from the caller earns the caller nothing.
      when h.first_hop is null then 0::numeric
      -- Layered override: spread to the DIRECT report only, never to the seller.
      else t.annual_premium * greatest(v_caller_comp - coalesce(fhp.pct, v_fallback), 0) / 100.0
    end as viewer_estimate,
    case
      when v_scope = 'imo' then 'team_direct'
      when t.origin = 'external_daily_gap' then 'gap'
      when coalesce(t.agent_id = any(v_personal_ids), false) then 'direct'
      else 'override'
    end as component
  from public.v_production_comp_truth t
  left join hops h on h.member = t.agent_id
  left join lateral (
    select p.pct from public.fn_agent_contract_pct(h.first_hop) p where h.first_hop is not null
  ) fhp on true
  where
    -- In-scope real production (all scopes).
    t.agent_id = any(v_scope_ids)
    -- Plus the Vantage gap, ONLY on the agency view. The gap is an agency-level
    -- aggregate credited at the head; it must never leak into a personal ('mine')
    -- commission total, and 'imo' carries its own direct_estimate lens.
    or (
      v_scope = 'agency'
      and t.origin = 'external_daily_gap'
      and v_gap_visible
      and public.fn_agent_subagency(t.raw_agent_id) = 'vantage'
    );

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
      where component in ('override', 'gap')
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
        where component in ('override', 'gap') and posted_date >= v_today - 89), 0) / 3.0 as override_m
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
    'comp_note', 'Unified posted production. Layered comp: your own production at your full contract, plus the positive spread to your DIRECT reports on their downline (first-hop override), plus the Vantage agency gap at the head. Identical basis to the production scoreboard.',
    'kpis', v_kpis,
    'team_kpis', v_team_kpis,
    'production', v_production,
    'commission_types', v_quad,
    'forecast', coalesce(v_forecast, '[]'::jsonb),
    'payouts', v_payouts,
    'breakdown', v_breakdown
  );
end;
$function$;

revoke all on function public.finances_overview_base(text, date) from public, anon, authenticated;
grant execute on function public.finances_overview_base(text, date) to service_role;
