-- v26 fix: v_agentlink_book_truth was counting future-dated policies as "today"
--
-- BUG REPORT (Sam, 2026-06-10):
--   "/dashboard shows me at $117K for today, obviously incorrect."
--
-- ROOT CAUSE:
--   The view filtered with `effective_date >= today` for "today" / "this week"
--   / "this month" buckets. That means every policy with a CURRENT OR FUTURE
--   effective date was counted as "today's" deal — every day, forever.
--
-- IMPACT (measured at fix time):
--   ACTUAL today:           9 deals · $16,974.60
--   DISPLAYED today (bug):  102 deals · $120,389.64
--   PHANTOM "today" bleed:  93 deals · $103,415.04  ← future-dated policies
--
--   ACTUAL MTD:           150 deals · $185,482.08
--   DISPLAYED MTD (bug):  243 deals · $288,897.12
--   PHANTOM MTD bleed:    93 deals · $103,415.04  ← same 93 future deals
--
-- FIX:
--   Change `effective_date >= today` to `effective_date = today` for "today"
--   and `effective_date BETWEEN period_start AND today` for week/month.
--   Future-dated policies still count in `total_*` (whole book) but no longer
--   bleed into current-period counters.
--
-- VERIFY AFTER:
--   SELECT * FROM v_agentlink_book_truth;
--   should now return realistic numbers that don't include unwritten future revenue.

CREATE OR REPLACE VIEW v_agentlink_book_truth AS
SELECT
  count(*)::integer AS total_deals,
  sum(annual_premium) AS total_annual_premium,
  -- TODAY: was effective_date >= today (counted ALL future), now = today only
  count(*) FILTER (WHERE effective_date = (now() AT TIME ZONE 'America/Phoenix')::date)::integer AS deals_today,
  sum(annual_premium) FILTER (WHERE effective_date = (now() AT TIME ZONE 'America/Phoenix')::date) AS premium_today,
  -- THIS WEEK: between week-start AND today
  count(*) FILTER (
    WHERE effective_date BETWEEN
      date_trunc('week', (now() AT TIME ZONE 'America/Phoenix')::date::timestamptz)::date
      AND (now() AT TIME ZONE 'America/Phoenix')::date
  )::integer AS deals_this_week,
  sum(annual_premium) FILTER (
    WHERE effective_date BETWEEN
      date_trunc('week', (now() AT TIME ZONE 'America/Phoenix')::date::timestamptz)::date
      AND (now() AT TIME ZONE 'America/Phoenix')::date
  ) AS premium_this_week,
  -- THIS MONTH: between month-start AND today
  count(*) FILTER (
    WHERE effective_date BETWEEN
      date_trunc('month', (now() AT TIME ZONE 'America/Phoenix')::date::timestamptz)::date
      AND (now() AT TIME ZONE 'America/Phoenix')::date
  )::integer AS deals_this_month,
  sum(annual_premium) FILTER (
    WHERE effective_date BETWEEN
      date_trunc('month', (now() AT TIME ZONE 'America/Phoenix')::date::timestamptz)::date
      AND (now() AT TIME ZONE 'America/Phoenix')::date
  ) AS premium_this_month,
  max(snapshot_at) AS last_synced_at
FROM agentlink_deals_snapshot;
