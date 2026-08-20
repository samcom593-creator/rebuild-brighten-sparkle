-- Finances page (AC-parity rebuild) server-side computation. ONE function owns
-- every number on /dashboard/finances so it can never disagree with itself, and
-- the est-earnings basis is IDENTICAL to leaderboard_board: annual_premium ×
-- agent_comp_levels.avg_comp_pct (default 63) / 100, posted-date windows,
-- is_dead excluded, canonical agent map applied. Phoenix dates (memory: UTC
-- drifts Sam's evening numbers).
--
-- Estimates are labeled estimates in the UI. Renewal pending is genuinely $0:
-- the book's oldest deal is ~4 months old, no policy has reached year 2.
create or replace function public.finances_overview(p_scope text default 'agency', p_month date default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date;
  v_scope text := lower(coalesce(p_scope, 'agency'));
  v_is_admin boolean := coalesce(public.has_role(auth.uid(), 'admin'::app_role), false);
  v_caller_agent uuid;
  v_caller_canon uuid;
  v_caller_alid int;
  v_caller_name text;
  v_caller_comp numeric;
  v_kpis jsonb; v_quad jsonb; v_forecast jsonb; v_payouts jsonb; v_breakdown jsonb;
begin
  v_month_start := coalesce(date_trunc('month', p_month)::date, date_trunc('month', v_today)::date);

  select a.id, coalesce(m.canonical_agent_id, a.id), a.insuracloud_user_id,
         coalesce(pr.full_name, a.display_name)
    into v_caller_agent, v_caller_canon, v_caller_alid, v_caller_name
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    left join public.profiles pr on pr.id = a.user_id
   where a.user_id = auth.uid()
   limit 1;

  -- non-admin, non-manager callers only ever see their own money
  if not v_is_admin and not coalesce(public.has_role(auth.uid(), 'manager'::app_role), false) then
    v_scope := 'mine';
  end if;

  select coalesce(c.avg_comp_pct, 63) into v_caller_comp
    from public.agent_comp_levels c where c.agent_name = v_caller_name limit 1;
  v_caller_comp := coalesce(v_caller_comp, 63);

  create temp table if not exists _fin_scoped on commit drop as select null::text as x limit 0;
  drop table if exists _fin_scoped;
  create temp table _fin_scoped on commit drop as
    select b.posted_date, b.annual_premium as ap, b.agent_name, b.client_name,
           b.carrier, b.product, b.status,
           coalesce(m.canonical_agent_id, b.agent_id) as canon,
           b.user_id as al_user_id,
           coalesce(c.avg_comp_pct, 63) as comp_pct,
           round(b.annual_premium * coalesce(c.avg_comp_pct, 63) / 100.0, 2) as est,
           (coalesce(m.canonical_agent_id, b.agent_id) = v_caller_canon
             or (v_caller_alid is not null and b.user_id = v_caller_alid)) as is_mine
    from public.agentlink_book b
    left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
    left join public.agent_comp_levels c on c.agent_name = b.agent_name
    where b.is_dead is not true
      and b.annual_premium is not null;

  if v_scope = 'mine' then
    delete from _fin_scoped where not is_mine;
  end if;

  -- KPI row: today / trailing-90d run rate (the 90-day forecast basis) / MTD / YTD
  select jsonb_build_object(
    'today',       coalesce(sum(est) filter (where posted_date = v_today), 0),
    'forecast_90d',coalesce(sum(est) filter (where posted_date >= v_today - 90), 0),
    'mtd',         coalesce(sum(est) filter (where posted_date >= date_trunc('month', v_today)::date), 0),
    'ytd',         coalesce(sum(est) filter (where posted_date >= date_trunc('year', v_today)::date), 0)
  ) into v_kpis from _fin_scoped;

  -- Commission types quad. direct = caller's own deals when the caller is an
  -- agent; in agency/imo scope it is the whole scope's direct est. override =
  -- comp spread (caller comp − producer comp, floored at 0) on OTHER agents'
  -- production — 0 in 'mine'. trail pending = the 25% as-earned tail (months
  -- 10-12) on deals younger than 12 months. renewal pending = deals 2+ years
  -- old (genuinely 0 today; becomes real when the book ages).
  select jsonb_build_object(
    'direct_ytd', coalesce(sum(est) filter (where (v_scope = 'mine' or is_mine)
                    and posted_date >= date_trunc('year', v_today)::date), 0),
    'override_pending', case when v_scope = 'mine' then 0 else
      coalesce(sum(round(ap * greatest(v_caller_comp - comp_pct, 0) / 100.0, 2))
        filter (where not is_mine and posted_date >= date_trunc('year', v_today)::date), 0) end,
    'trail_pending', coalesce(sum(round(est * 0.25, 2))
        filter (where posted_date > v_today - 365
                and lower(coalesce(status,'')) not in ('lapsed','cancelled','charged_back','withdrawn','not_taken')), 0),
    'renewal_pending', coalesce(sum(round(est * 0.05, 2))
        filter (where posted_date <= v_today - 730), 0)
  ) into v_quad from _fin_scoped;

  -- 12-month forward forecast: direct/override run on the trailing-90d monthly
  -- rate; trail unlocks land 10-12 months after each cohort month.
  with run as (
    select coalesce(sum(est) filter (where posted_date >= v_today - 90), 0) / 3.0 as direct_m,
           coalesce(sum(round(ap * greatest(v_caller_comp - comp_pct, 0) / 100.0, 2))
             filter (where not is_mine and posted_date >= v_today - 90), 0) / 3.0 as override_m
    from _fin_scoped
  ),
  cohorts as (
    select date_trunc('month', posted_date)::date as cm, sum(est) * 0.25 / 3.0 as trail_slice
    from _fin_scoped
    where posted_date > v_today - 365
    group by 1
  ),
  months as (
    select (date_trunc('month', v_today)::date + (interval '1 month' * gs))::date as m
    from generate_series(0, 11) gs
  )
  select jsonb_agg(jsonb_build_object(
    'month', to_char(m.m, 'YYYY-MM'),
    'direct', round((select direct_m from run)),
    'override', round(case when v_scope = 'mine' then 0 else (select override_m from run) end),
    'trail', round(coalesce((
       select sum(c.trail_slice) from cohorts c
       where m.m >= (c.cm + interval '9 months')::date
         and m.m <  (c.cm + interval '12 months')::date), 0)),
    'renewal', 0
  ) order by m.m) into v_forecast from months m;

  -- Scheduled payouts for the requested month: per-deal estimated advances.
  with mrows as (
    select posted_date, agent_name, client_name, carrier, product, ap, est
    from _fin_scoped
    where posted_date >= v_month_start
      and posted_date < (v_month_start + interval '1 month')::date
    order by posted_date desc, est desc
    limit 200
  )
  select jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'total', coalesce((select sum(est) from _fin_scoped
              where posted_date >= v_month_start
                and posted_date < (v_month_start + interval '1 month')::date), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'date', posted_date, 'agent', agent_name, 'client', client_name,
      'carrier', carrier, 'product', product, 'ap', ap, 'est', est)), '[]'::jsonb)
  ) into v_payouts from mrows;

  -- Breakdown: trailing 12 months, real aggregations.
  select jsonb_build_object(
    'by_carrier', coalesce((select jsonb_agg(t) from (
      select coalesce(nullif(trim(carrier), ''), 'Carrier N/A') as name,
             count(*) as deals, round(sum(ap)) as ap, round(sum(est)) as est
      from _fin_scoped where posted_date > v_today - 365
      group by 1 order by sum(est) desc limit 14) t), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(t) from (
      select coalesce(nullif(trim(product), ''), 'Product N/A') as name,
             count(*) as deals, round(sum(ap)) as ap, round(sum(est)) as est
      from _fin_scoped where posted_date > v_today - 365
      group by 1 order by sum(est) desc limit 14) t), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(t) from (
      select to_char(date_trunc('month', posted_date), 'YYYY-MM') as name,
             count(*) as deals, round(sum(ap)) as ap, round(sum(est)) as est
      from _fin_scoped where posted_date > v_today - 365
      group by 1 order by 1) t), '[]'::jsonb),
    'by_agent_overrides', case when v_scope = 'mine' then '[]'::jsonb else
      coalesce((select jsonb_agg(t) from (
      select agent_name as name, count(*) as deals, round(sum(ap)) as ap,
             round(sum(ap * greatest(v_caller_comp - comp_pct, 0) / 100.0)) as est
      from _fin_scoped
      where not is_mine and posted_date > v_today - 365
      group by 1 order by 3 desc limit 20) t), '[]'::jsonb) end
  ) into v_breakdown;

  return jsonb_build_object(
    'scope', v_scope,
    'as_of', v_today,
    'comp_note', 'Estimates use saved AgentLink comp levels (default 63%); overrides use your comp spread vs each producer.',
    'kpis', v_kpis,
    'commission_types', v_quad,
    'forecast', coalesce(v_forecast, '[]'::jsonb),
    'payouts', v_payouts,
    'breakdown', v_breakdown
  );
end;
$fn$;

grant execute on function public.finances_overview(text, date) to authenticated;
