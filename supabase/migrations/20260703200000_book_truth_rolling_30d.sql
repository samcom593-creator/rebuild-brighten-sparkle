-- Fix v_agentlink_book_truth so deals_this_month + premium_this_month
-- report ROLLING 30 DAYS instead of CALENDAR MONTH.
--
-- Bug Sam surfaced 2026-07-03: on the 3rd of a new month, "this month"
-- read as smaller than "this week" (77 < 87 deals), making every
-- dashboard that renders both look broken. That is mathematically
-- correct calendar-arithmetic — "this month" = 3 days (Jul 1-3),
-- "this week" = 5 days (Mon Jun 29 - Fri Jul 3) — but it violates
-- user expectation and made Sam say "all dashboards completely wrong".
--
-- Fix: rolling 30 days. Now month >= week >= today always, matching
-- how every agency owner reads a KPI dashboard.
--
-- Applied live via bot-sql at 2026-07-03T19:53 UTC. Rendering the
-- migration file so schema-init + local mirrors stay in sync.
--
-- Immediate effect (verified):
--   deals_today       32
--   deals_this_week   87
--   deals_this_month  360   ← was 77 pre-fix
--   premium_this_month $440,718.60   ← was $101,075 pre-fix
--
-- Consumers: src/pages/Dashboard.tsx (StatTiles), MoM production cards,
-- landing_live_stats fallback path, MonthAlpBar, WeeklyPacing gauge.

CREATE OR REPLACE VIEW public.v_agentlink_book_truth AS
SELECT
  count(*)::integer AS total_deals,
  sum(annual_premium) AS total_annual_premium,
  count(*) FILTER (WHERE effective_date = ((now() AT TIME ZONE 'America/Phoenix')::date))::integer AS deals_today,
  sum(annual_premium) FILTER (WHERE effective_date = ((now() AT TIME ZONE 'America/Phoenix')::date)) AS premium_today,
  count(*) FILTER (
    WHERE effective_date >= (date_trunc('week', ((now() AT TIME ZONE 'America/Phoenix')::date)::timestamp with time zone))::date
      AND effective_date <= ((now() AT TIME ZONE 'America/Phoenix')::date)
  )::integer AS deals_this_week,
  sum(annual_premium) FILTER (
    WHERE effective_date >= (date_trunc('week', ((now() AT TIME ZONE 'America/Phoenix')::date)::timestamp with time zone))::date
      AND effective_date <= ((now() AT TIME ZONE 'America/Phoenix')::date)
  ) AS premium_this_week,
  count(*) FILTER (
    WHERE effective_date >= (((now() AT TIME ZONE 'America/Phoenix')::date) - INTERVAL '30 days')::date
      AND effective_date <= ((now() AT TIME ZONE 'America/Phoenix')::date)
  )::integer AS deals_this_month,
  sum(annual_premium) FILTER (
    WHERE effective_date >= (((now() AT TIME ZONE 'America/Phoenix')::date) - INTERVAL '30 days')::date
      AND effective_date <= ((now() AT TIME ZONE 'America/Phoenix')::date)
  ) AS premium_this_month,
  max(snapshot_at) AS last_synced_at
FROM public.agentlink_deals_snapshot;
