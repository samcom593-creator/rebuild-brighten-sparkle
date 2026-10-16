-- PL-WIB-SALES-CHALLENGES-CANONICAL (2026-10-16)
--
-- v_sales_challenges feeds the Daily / Weekly / Monthly challenge strip on
-- /dashboard/analytics (BusinessAnalytics) and the "sales challenges" answer
-- in Ask APEX (AskApex.tsx), which states the numbers as fact. Its three
-- premium lanes read the raw agentlink_book, and nobody has entered a deal in
-- AgentLink since 2026-08-31. Measured 2026-10-16 as service:
--
--   lane      before (raw book)                    canonical
--   daily     $0 today, target $121,440/day        $3,752.28 today (2 deals),
--                                                  target $5,539.44 (3)
--   weekly    $0 this week, target $0              $32,882.88 (22 deals),
--                                                  last week $14,218.08 (8)
--   monthly   $1,821,600 (2 deals), target $0      $86,843.84 (50 deals),
--                                                  Sept x 1.1 = $201,115.33 (117)
--
-- The $1,821,600 month is two Willard Herald book rows with no agent_id
-- ($1,800,000, a 1000x twin of the $21,600 row); canonical already drops them.
-- The $121,440 daily target is the same two rows divided over 15 days.
--
-- Change: the three premium lanes read v_production_canonical (dead and
-- status-excluded rows are filtered there, so the is_dead filter goes).
-- Window and target rules are unchanged. The quarterly lane is a recruit
-- count by design (ChallengeTile: "current_premium IS the agent count") and
-- is untouched. CREATE OR REPLACE keeps owner and grants; the view stays
-- owner-run with no reloptions, as before, because it emits four
-- agency-aggregate rows with no names and the page is requireAdmin
-- allowManagers. Proof: business-ops/website-integrity-bot/scripts/
-- prove-sales-challenges-canonical.sh (rolled back).
CREATE OR REPLACE VIEW public.v_sales_challenges AS
 WITH ph AS (
         SELECT ((now() AT TIME ZONE 'America/Phoenix'::text))::date AS today,
            (date_trunc('day'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone))::date AS day_start,
            (date_trunc('week'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone))::date AS week_start,
            (date_trunc('month'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone))::date AS month_start,
            (date_trunc('quarter'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone))::date AS quarter_start,
            ((date_trunc('month'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone) - '1 mon'::interval))::date AS last_month_start,
            ((date_trunc('month'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone) - '1 day'::interval))::date AS last_month_end,
            ((date_trunc('quarter'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone) - '3 mons'::interval))::date AS last_quarter_start,
            ((date_trunc('quarter'::text, (((now() AT TIME ZONE 'America/Phoenix'::text))::date)::timestamp with time zone) - '1 day'::interval))::date AS last_quarter_end
        )
 SELECT 'daily'::text AS period,
    COALESCE(sum(agentlink_deals_snapshot.annual_premium) FILTER (WHERE (agentlink_deals_snapshot.posted_date = ph.today)), (0)::numeric) AS current_premium,
    (COALESCE(sum(agentlink_deals_snapshot.annual_premium) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.month_start) AND (agentlink_deals_snapshot.posted_date <= (ph.today - '1 day'::interval)))), (0)::numeric) / GREATEST((EXTRACT(day FROM ph.today) - (1)::numeric), (1)::numeric)) AS target_premium,
    (COALESCE(count(*) FILTER (WHERE (agentlink_deals_snapshot.posted_date = ph.today)), (0)::bigint))::integer AS current_deals,
    (GREATEST((1)::numeric, round(((COALESCE(count(*) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.month_start) AND (agentlink_deals_snapshot.posted_date <= (ph.today - '1 day'::interval)))), (0)::bigint))::numeric / GREATEST((EXTRACT(day FROM ph.today) - (1)::numeric), (1)::numeric)))))::integer AS target_deals,
    ((ph.today + '1 day'::interval))::timestamp with time zone AS period_end_at
   FROM v_production_canonical agentlink_deals_snapshot,
    ph
  GROUP BY ph.today, ph.month_start
UNION ALL
 SELECT 'weekly'::text AS period,
    COALESCE(sum(agentlink_deals_snapshot.annual_premium) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.week_start) AND (agentlink_deals_snapshot.posted_date <= ph.today))), (0)::numeric) AS current_premium,
    COALESCE(sum(agentlink_deals_snapshot.annual_premium) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= (ph.week_start - '7 days'::interval)) AND (agentlink_deals_snapshot.posted_date <= (ph.week_start - '1 day'::interval)))), (0)::numeric) AS target_premium,
    (COALESCE(count(*) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.week_start) AND (agentlink_deals_snapshot.posted_date <= ph.today))), (0)::bigint))::integer AS current_deals,
    (GREATEST((1)::bigint, COALESCE(count(*) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= (ph.week_start - '7 days'::interval)) AND (agentlink_deals_snapshot.posted_date <= (ph.week_start - '1 day'::interval)))), (0)::bigint)))::integer AS target_deals,
    ((ph.week_start + '7 days'::interval))::timestamp with time zone AS period_end_at
   FROM v_production_canonical agentlink_deals_snapshot,
    ph
  GROUP BY ph.today, ph.week_start
UNION ALL
 SELECT 'monthly'::text AS period,
    COALESCE(sum(agentlink_deals_snapshot.annual_premium) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.month_start) AND (agentlink_deals_snapshot.posted_date <= ph.today))), (0)::numeric) AS current_premium,
    (COALESCE(sum(agentlink_deals_snapshot.annual_premium) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.last_month_start) AND (agentlink_deals_snapshot.posted_date <= ph.last_month_end))), (0)::numeric) * 1.1) AS target_premium,
    (COALESCE(count(*) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.month_start) AND (agentlink_deals_snapshot.posted_date <= ph.today))), (0)::bigint))::integer AS current_deals,
    (GREATEST((1)::numeric, round(((COALESCE(count(*) FILTER (WHERE ((agentlink_deals_snapshot.posted_date >= ph.last_month_start) AND (agentlink_deals_snapshot.posted_date <= ph.last_month_end))), (0)::bigint))::numeric * 1.1))))::integer AS target_deals,
    (date_trunc('month'::text, (ph.today)::timestamp with time zone) + '1 mon'::interval) AS period_end_at
   FROM v_production_canonical agentlink_deals_snapshot,
    ph
  GROUP BY ph.today, ph.month_start, ph.last_month_start, ph.last_month_end
UNION ALL
 SELECT 'quarterly'::text AS period,
    (( SELECT count(*) AS count
           FROM agents
          WHERE ((agents.created_at >= ph.quarter_start) AND (agents.is_deactivated IS NOT TRUE) AND (agents.is_inactive IS NOT TRUE) AND (agents.status = 'active'::agent_status) AND (agents.canonical_agent_id IS NULL) AND (agents.display_name IS NOT NULL) AND ((agents.agent_code IS NULL) OR (agents.agent_code !~~ 'GHOST_%'::text)))))::numeric AS current_premium,
    GREATEST((10)::numeric, round(((( SELECT count(*) AS count
           FROM agents
          WHERE ((agents.created_at >= ph.last_quarter_start) AND (agents.created_at <= ph.last_quarter_end) AND (agents.is_deactivated IS NOT TRUE) AND (agents.is_inactive IS NOT TRUE) AND (agents.status = 'active'::agent_status) AND (agents.canonical_agent_id IS NULL) AND (agents.display_name IS NOT NULL) AND ((agents.agent_code IS NULL) OR (agents.agent_code !~~ 'GHOST_%'::text)))))::numeric * 1.1))) AS target_premium,
    (( SELECT count(*) AS count
           FROM agents
          WHERE ((agents.created_at >= ph.quarter_start) AND (agents.is_deactivated IS NOT TRUE) AND (agents.is_inactive IS NOT TRUE) AND (agents.status = 'active'::agent_status) AND (agents.canonical_agent_id IS NULL) AND (agents.display_name IS NOT NULL) AND ((agents.agent_code IS NULL) OR (agents.agent_code !~~ 'GHOST_%'::text)))))::integer AS current_deals,
    (GREATEST((10)::numeric, round(((( SELECT count(*) AS count
           FROM agents
          WHERE ((agents.created_at >= ph.last_quarter_start) AND (agents.created_at <= ph.last_quarter_end) AND (agents.is_deactivated IS NOT TRUE) AND (agents.is_inactive IS NOT TRUE) AND (agents.status = 'active'::agent_status) AND (agents.canonical_agent_id IS NULL) AND (agents.display_name IS NOT NULL) AND ((agents.agent_code IS NULL) OR (agents.agent_code !~~ 'GHOST_%'::text)))))::numeric * 1.1))))::integer AS target_deals,
    (date_trunc('quarter'::text, (ph.today)::timestamp with time zone) + '3 mons'::interval) AS period_end_at
   FROM ph;
