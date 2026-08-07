-- wave-wow-source-mismatch — closes apex-platform-audit-2026-07-21.md:76
--
-- Dashboard's "Vs prior matched week" tile divided an AgentLink-truth numerator
-- by a legacy `deals`-table denominator:
--   weekAlp         = v_agentlink_book_truth.premium_this_week   (truth)
--   previousWeekAlp = sum(deals.annual_premium) for the prior week (legacy)
-- Two sources, one percentage, rendered in green/amber as if it were real growth.
--
-- Live receipt 2026-08-07 09:50Z (matched window Mon 2026-07-27 .. Fri 2026-07-31):
--   legacy  deals prior week: 35 deals / $46,571.88  -> card renders  -1.66%  "flat"
--   truth  book  prior week: 46 deals / $62,552.04  -> reality       -26.79%
-- The legacy table is missing 11 deals / $15,980 of the baseline, so a 27% drop
-- in agency production reads as noise on Sam's landing surface.
--
-- Fix: give the truth view its own matched-prior-week bucket so both operands
-- share a source AND a timezone (America/Phoenix, week starts Monday). The
-- window matches deals_this_week exactly: same weekday span, shifted back 7 days.
-- New columns are appended last so the single dependent view (v_today_dashboard)
-- and every existing consumer keep their column positions.

create or replace view public.v_agentlink_book_truth as
 with p as (
   select (now() at time zone 'America/Phoenix'::text)::date as d
 )
 select count(*)::integer as total_deals,
    sum(b.annual_premium) as total_annual_premium,
    count(*) filter (where b.posted_date = p.d)::integer as deals_today,
    coalesce(sum(b.annual_premium) filter (where b.posted_date = p.d), 0::numeric) as premium_today,
    count(*) filter (where b.posted_date >= date_trunc('week'::text, p.d::timestamp without time zone)::date and b.posted_date <= p.d)::integer as deals_this_week,
    coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('week'::text, p.d::timestamp without time zone)::date and b.posted_date <= p.d), 0::numeric) as premium_this_week,
    count(*) filter (where b.posted_date >= date_trunc('month'::text, p.d::timestamp without time zone)::date and b.posted_date <= p.d)::integer as deals_this_month,
    coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('month'::text, p.d::timestamp without time zone)::date and b.posted_date <= p.d), 0::numeric) as premium_this_month,
    max(b.imported_at) as last_synced_at,
    -- matched prior week: same elapsed weekday span as deals_this_week, minus 7 days
    count(*) filter (
      where b.posted_date >= (date_trunc('week'::text, p.d::timestamp without time zone)::date - 7)
        and b.posted_date <= (p.d - 7)
    )::integer as deals_prior_week,
    coalesce(sum(b.annual_premium) filter (
      where b.posted_date >= (date_trunc('week'::text, p.d::timestamp without time zone)::date - 7)
        and b.posted_date <= (p.d - 7)
    ), 0::numeric) as premium_prior_week
   from agentlink_book b,
    p
  where b.is_dead is not true;

comment on view public.v_agentlink_book_truth is
  'AgentLink book of business, agency-wide, Phoenix business dates, week starts Monday. '
  'deals_prior_week / premium_prior_week are the MATCHED prior week (same weekday span as '
  'this_week, shifted -7d) added 2026-08-07 by wave-wow-source-mismatch so week-over-week '
  'comparisons never divide a truth-view numerator by a legacy deals-table denominator.';
