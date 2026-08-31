-- MP-355: the Leaderboard headline and the list under it were counting
-- different populations, and every producer's tenure was capped by the window.
--
-- 1) HERO vs BOARD PARITY. leaderboard_book_hero() summed v_production_unified
--    INCLUDING origin='external_daily_gap' -- synthetic generate_series rows
--    standing in for another agency's (Vantage) reported-but-unattributed
--    production. leaderboard_board() excludes that origin, and no row on the
--    board can carry it, because it belongs to no producer. Measured on
--    2026-08-31 as Sam: hero $151,929.44 / 97 deals over a list totalling
--    $135,943.44 / 87 deals -- $15,986.00 and 10 "deals" that the page states
--    and cannot account for. It also poisoned "Avg / producer", which divided
--    an AP that included the gap by a producer count that excluded it.
--    The gap is real and worth seeing, so it is RETURNED SEPARATELY rather
--    than deleted: total_ap/deal_count now describe exactly the rows the board
--    lists, and external_gap_ap/external_gap_deals get their own labelled line.
--    prior_ap is filtered the same way, or the pace % would compare a
--    gap-excluded month against a gap-included one.
--
-- 2) TENURE. leaderboard_board() derived first_policy_date from min(posted_date)
--    INSIDE the requested window, so on a monthly board every producer's
--    "N weeks in" was measured from their first deal THAT MONTH. Measured:
--    Samuel James rendered "3 weeks in" against a true first policy of
--    2025-12-04, Aisha Kebbeh "4 weeks in" against 2025-12-17, Chudi Ifediora
--    "4 weeks in" against 2026-01-20. Tenure now comes from an unwindowed
--    lifetime scan under the same visibility predicate.

begin;

-- Return signature grows by two columns, so replace-in-place is not available.
drop function if exists public.leaderboard_book_hero();

create or replace function public.leaderboard_book_hero()
returns table(
  total_ap numeric,
  producers bigint,
  deal_count bigint,
  prior_ap numeric,
  day_of_month integer,
  days_in_month integer,
  external_gap_ap numeric,
  external_gap_deals bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with nowp as (
    select (now() at time zone 'America/Phoenix')::date d
  ), bounds as (
    select date_trunc('month', d)::date cur_start,
      (date_trunc('month', d) + interval '1 month')::date cur_end,
      (date_trunc('month', d) - interval '1 month')::date prior_start,
      date_trunc('month', d)::date prior_end,
      extract(day from d)::int dom,
      extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int dim
    from nowp
  ), visible as (
    select u.*
    from public.v_production_unified u
    where (
      u.origin = 'external_daily_gap' and public.apex_is_admin()
    ) or (
      u.origin is distinct from 'external_daily_gap'
      and (
        public.apex_is_admin()
        or (u.agent_id is not null and public.crm_can_read_agent_scope(u.agent_id))
      )
    )
  ), cur as (
    select
      coalesce(sum(u.annual_premium) filter (
        where u.origin is distinct from 'external_daily_gap'), 0) ap,
      count(*) filter (
        where u.origin is distinct from 'external_daily_gap') dc,
      count(distinct coalesce(m.canonical_agent_id, u.agent_id))
        filter (where u.origin is distinct from 'external_daily_gap') prod,
      coalesce(sum(u.annual_premium) filter (
        where u.origin = 'external_daily_gap'), 0) gap_ap,
      count(*) filter (where u.origin = 'external_daily_gap') gap_dc
    from visible u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    cross join bounds
    where u.posted_date >= bounds.cur_start and u.posted_date < bounds.cur_end
  ), prior as (
    select coalesce(sum(u.annual_premium) filter (
      where u.origin is distinct from 'external_daily_gap'), 0) ap
    from visible u cross join bounds
    where u.posted_date >= bounds.prior_start and u.posted_date < bounds.prior_end
  )
  select cur.ap, cur.prod, cur.dc, prior.ap, bounds.dom, bounds.dim,
         cur.gap_ap, cur.gap_dc
  from cur, prior, bounds;
$fn$;

create or replace function public.leaderboard_board(p_start date, p_end date)
returns table(
  agent_key text,
  agent_id uuid,
  agent_name text,
  avatar_url text,
  deals bigint,
  ap numeric,
  est_earnings numeric,
  lead_cost numeric,
  first_policy_date date,
  tenure_label text,
  weeks_with_agency integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  with visible as (
    select t.*
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and (
        public.apex_is_admin()
        or (t.agent_id is not null and public.crm_can_read_agent_scope(t.agent_id))
      )
  ), grouped as (
    select
      coalesce(v.agent_id::text, 'name:' || lower(btrim(v.agent_name))) as agent_key,
      v.agent_id,
      min(v.agent_name) as raw_name,
      count(*) as deals,
      sum(v.annual_premium) as ap,
      sum(v.direct_estimate) as est_earnings
    from visible v
    where v.posted_date >= p_start
      and v.posted_date < p_end
    group by 1, 2
  ), lifetime as (
    -- Tenure is a property of the producer, not of the window being ranked.
    -- Restricted to keys `grouped` already authorized, so the lifetime scan
    -- adds no visibility and does not re-run the per-row scope predicate
    -- across all history (which cost a non-admin ~11s in testing).
    select
      coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key,
      min(t.posted_date) as first_policy_date
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name)))
          in (select g.agent_key from grouped g)
    group by 1
  )
  select
    g.agent_key,
    g.agent_id,
    coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name,
    pr.avatar_url,
    g.deals,
    g.ap,
    g.est_earnings,
    0::numeric as lead_cost,
    l.first_policy_date,
    case
      when l.first_policy_date is null then 'New'
      when current_date - l.first_policy_date < 7 then (current_date - l.first_policy_date)::int || ' days in'
      when current_date - l.first_policy_date < 56 then ((current_date - l.first_policy_date) / 7)::int || ' weeks in'
      when current_date - l.first_policy_date < 365 then ((current_date - l.first_policy_date) / 30)::int || ' months in'
      else round(((current_date - l.first_policy_date) / 365.0)::numeric, 1)::text || ' yrs in'
    end,
    greatest(((current_date - l.first_policy_date) / 7)::int, 0)
  from grouped g
  left join lifetime l on l.agent_key = g.agent_key
  left join public.agents a on a.id = g.agent_id
  left join public.profiles pr on pr.id = a.profile_id
  order by g.ap desc, g.deals desc, agent_name asc;
$fn$;

revoke all on function public.leaderboard_book_hero() from public, anon;
revoke all on function public.leaderboard_board(date, date) from public, anon;
grant execute on function public.leaderboard_book_hero() to authenticated, service_role;
grant execute on function public.leaderboard_board(date, date) to authenticated, service_role;

comment on function public.leaderboard_book_hero() is
  'Hierarchy-scoped production hero. total_ap/deal_count describe exactly the rows leaderboard_board lists; unattributed external-agency production is returned separately as external_gap_ap/external_gap_deals so it can never inflate the headline or the avg-per-producer math.';
comment on function public.leaderboard_board(date, date) is
  'Hierarchy-scoped individual production leaderboard. Admin sees the full IMO; non-admins see only self plus recursive downline. first_policy_date/tenure are lifetime, not window-capped.';

commit;
