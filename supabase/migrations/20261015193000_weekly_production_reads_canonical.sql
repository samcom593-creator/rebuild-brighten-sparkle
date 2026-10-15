-- PL-WIB-WEEKLY-PRODUCTION-CANONICAL (2026-10-15)
--
-- /admin/producer-trends (12-week ALP sparkline, This Week / Prev Week, the
-- "Dropping 3 Weeks" and "No ALP 30D" tiles), ProducerDetailsDrawer's weekly
-- chart, the AgentProfileDrawer trend chip and AgentCommandDashboard's
-- producer risk board all read v_agent_weekly_production, directly or through
-- v_producer_trend_alert. It read the raw agentlink_book, and nobody has
-- entered a deal in AgentLink since 2026-08-31. Measured 2026-10-15 over the
-- same 84 days:
--
--   v_agent_weekly_production (raw book)   73 deals / $101,253, newest week 08-31
--   v_production_canonical                 258 deals / $418,439.72, through 10-15
--
-- Read as Sam, v_producer_trend_alert held 8 producers whose "current week"
-- ranged 08-03 .. 08-31. Nothing sold since September could trip any tile.
--
-- Second defect, same view: it emitted a row only for weeks that HAD deals.
-- v_producer_trend_alert takes row_number()/lag() over those rows, so its
-- "current week" was the producer's last productive week and its lags skipped
-- empty weeks. A producer who went to $0 kept showing their last good week as
-- "This Week", and the page's noAlp30 test (all four weeks zero) could never
-- be true. That is the Daniel case this page was built for. The drawer
-- sparkline is already written for a fixed-length 12-week series.
--
-- Now: a dense grid of 12 calendar weeks (current week + 11 prior, Monday
-- start) for every active canonical agent with any production in that span,
-- zero-filled. Source is v_production_canonical, with twin agent ids rolled up
-- through v_agent_canonical_map. Column names and types are unchanged, so
-- v_producer_trend_alert, its is_owner() gate and the grants carry over, and
-- its lag() becomes a calendar-week lag with no edit. Previewed read-only:
-- 20 producers x 12 weeks, 256 deals / $415,871 (every canonical row in the
-- window maps to an active non-twin agent; the agentlink leg alone is 73 /
-- $101,253, equal to the old view). 7 producers now read "No ALP 30D".
--
-- The current week is partial (week to date), as it was before for anyone
-- with a deal in it. security_invoker stays on: money still resolves through
-- the caller's RLS on deals / production_external_deals / agentlink_book, and
-- authenticated can already read v_production_canonical directly.

CREATE OR REPLACE VIEW public.v_agent_weekly_production
WITH (security_invoker = true) AS
WITH weeks AS (
  SELECT generate_series(
           date_trunc('week', now()) - interval '11 weeks',
           date_trunc('week', now()),
           interval '1 week'
         )::date AS week_start
), prod AS (
  SELECT COALESCE(m.canonical_agent_id, p.agent_id) AS agent_id,
         date_trunc('week', p.posted_date::timestamptz)::date AS week_start,
         p.annual_premium
    FROM public.v_production_canonical p
    LEFT JOIN public.v_agent_canonical_map m ON m.agent_id = p.agent_id
   WHERE p.agent_id IS NOT NULL
     AND p.posted_date >= (date_trunc('week', now()) - interval '11 weeks')::date
), producers AS (
  SELECT a.id, a.display_name
    FROM public.agents a
   WHERE a.status = 'active'::agent_status
     AND COALESCE(a.is_deactivated, false) = false
     AND a.canonical_agent_id IS NULL
     AND EXISTS (SELECT 1 FROM prod WHERE prod.agent_id = a.id)
)
SELECT a.id AS agent_id,
       a.display_name,
       w.week_start,
       count(p.agent_id)::integer AS deals,
       COALESCE(sum(p.annual_premium), 0::numeric)::integer AS alp
  FROM producers a
 CROSS JOIN weeks w
  LEFT JOIN prod p ON p.agent_id = a.id AND p.week_start = w.week_start
 GROUP BY a.id, a.display_name, w.week_start;

COMMENT ON VIEW public.v_agent_weekly_production IS
  'Dense 12-calendar-week ALP + deal count per active canonical producer, zero-filled, '
  'from v_production_canonical (book + apex_native deals + Discord externals). '
  'Feeds v_producer_trend_alert and /admin/producer-trends. '
  'See migration 20261015193000_weekly_production_reads_canonical.sql.';
