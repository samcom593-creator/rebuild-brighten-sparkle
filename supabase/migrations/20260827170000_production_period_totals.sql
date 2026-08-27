-- 2026-08-27 (MP-329): the command-center production card read a table that
-- does not exist, and rendered the failure as $0.
--
-- ProductionAnalyticsCard queried `.from("production")`. There is no relation
-- named `production` in ANY schema of this database. PostgREST resolves such a
-- read with {data: null, error} rather than rejecting, and the card's
-- `sum(rows ?? null)` helper turned that null into 0 — so /dashboard/admin
-- displayed a confident "$0 / $0 / $0" for week / MTD / YTD while the real YTD
-- was $1,733,745.44 across 1,315 deals. The card never showed an error; it
-- showed a number, which is the more expensive failure.
--
-- This function is the replacement source. Two properties matter:
--
--   1. CANONICAL SEMANTICS, SINGLE-SOURCED. The filter
--      (v_production_unified, origin <> 'external_daily_gap', agent_id not
--      null) is copied from agent_lifetime_production so the command-center
--      headline cannot drift from the lifetime metric. Two surfaces deriving
--      one number independently is how the week-over-week tile came to report
--      -1.66% against a same-source truth of -26.79%.
--
--   2. REFUSAL NAMES ITSELF. The first cut of this function ended in
--      `where public.is_agency_staff()`. An aggregate under a false WHERE
--      returns ONE ROW OF ZEROS, not zero rows — so a non-staff caller would
--      have been handed "$0 production", reproducing the exact fake-success
--      this migration exists to remove. It now RAISES 42501 instead, and the
--      card renders "—" rather than a number it cannot stand behind.
--
-- Windows are Phoenix-dated to match the card's own MTD/YTD labels.

create or replace function public.production_period_totals()
returns table (
  week_alp numeric, week_deals integer,
  month_alp numeric, month_deals integer,
  year_alp numeric, year_deals integer
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_agency_staff() then
    raise exception 'production_period_totals: caller is not agency staff'
      using errcode = '42501';
  end if;

  return query
  with b as (
    select (now() at time zone 'America/Phoenix')::date as d
  ),
  bounds as (
    select
      d - extract(dow from d)::int as week_start,
      date_trunc('month', d)::date as month_start,
      date_trunc('year',  d)::date as year_start
    from b
  ),
  u as (
    select annual_premium, posted_date
    from public.v_production_unified
    where origin <> 'external_daily_gap'
      and agent_id is not null
  )
  select
    coalesce(sum(u.annual_premium) filter (where u.posted_date >= bounds.week_start), 0)::numeric,
    count(*) filter (where u.posted_date >= bounds.week_start)::integer,
    coalesce(sum(u.annual_premium) filter (where u.posted_date >= bounds.month_start), 0)::numeric,
    count(*) filter (where u.posted_date >= bounds.month_start)::integer,
    coalesce(sum(u.annual_premium) filter (where u.posted_date >= bounds.year_start), 0)::numeric,
    count(*) filter (where u.posted_date >= bounds.year_start)::integer
  from u cross join bounds;
end;
$fn$;

revoke all on function public.production_period_totals() from public, anon;
grant execute on function public.production_period_totals() to authenticated;
