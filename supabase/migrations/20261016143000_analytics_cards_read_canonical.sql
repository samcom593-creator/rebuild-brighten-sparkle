-- PL-WIB-ANALYTICS-CARDS-CANONICAL
-- Proof: business-ops/website-integrity-bot/scripts/prove-analytics-cards-canonical.sh (rolled back).
-- Owner, grants, column names/types and the is_owner() gates are unchanged (CREATE OR REPLACE).
-- Four cards on /dashboard/analytics read raw agentlink_book, which has no rows after 2026-10-02
-- and none for September. "Licensed agents inactive 30d" listed 106 people, including Jontay Taylor
-- (21 deals, $44,102) and Edwin Ac-lumor (28 deals, $42,015), the two top producers. "Learn from"
-- was empty, "Needs attention" told Sam to coach producing agents, and the trophy cabinet counted
-- 1 day with a deal this month instead of 12.
-- Production now reads v_production_canonical rolled up through v_agent_canonical_map on the
-- Phoenix day, the same rule as v_team_analytics_producers. A merged-away agent row is not a
-- second person, so the roster cards count only rows that are their own canonical.
CREATE OR REPLACE VIEW public.v_agents_learn_from AS
 SELECT user_id,
    display_name,
    agent_code,
    deals_30d,
    premium_30d,
    pct_above_avg
   FROM ( WITH prod AS (
                 SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS seller_id,
                    p.annual_premium
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p.agent_id
                  WHERE p.agent_id IS NOT NULL AND p.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)
                ), producer_totals AS (
                 SELECT prod.seller_id,
                    count(*) AS deals_30d,
                    sum(prod.annual_premium) AS premium_30d
                   FROM prod
                  GROUP BY prod.seller_id
                ), team_avg AS (
                 SELECT avg(producer_totals.premium_30d) AS team_avg
                   FROM producer_totals
                )
         SELECT a.al_user_id AS user_id,
            a.display_name,
            a.agent_code,
            pt.deals_30d,
            pt.premium_30d::text AS premium_30d,
            round((pt.premium_30d - ta.team_avg) / NULLIF(ta.team_avg, 0::numeric) * 100::numeric, 0) AS pct_above_avg
           FROM producer_totals pt
             CROSS JOIN team_avg ta
             LEFT JOIN agents a ON a.id = pt.seller_id
          WHERE pt.premium_30d > (ta.team_avg * 1.5)
          ORDER BY pt.premium_30d DESC
         LIMIT 3) t
  WHERE is_owner();

CREATE OR REPLACE VIEW public.v_agents_needs_attention AS
 SELECT id,
    display_name,
    agent_code,
    deals_30d,
    premium_30d,
    potential_30d,
    recommendation
   FROM ( WITH prod AS (
                 SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS seller_id,
                    p.annual_premium
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p.agent_id
                  WHERE p.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)
                ), team_avg AS (
                 SELECT COALESCE(avg(prod.annual_premium), 1200::numeric) AS avg_deal
                   FROM prod
                ), per_seller AS (
                 SELECT prod.seller_id,
                    count(*) AS deals_30d,
                    sum(prod.annual_premium) AS premium_30d
                   FROM prod
                  WHERE prod.seller_id IS NOT NULL
                  GROUP BY prod.seller_id
                ), producers AS (
                 SELECT a.id,
                    a.display_name,
                    a.agent_code,
                    a.license_status,
                    a.created_at,
                    COALESCE(ps.deals_30d, 0::bigint) AS deals_30d,
                    COALESCE(ps.premium_30d, 0::numeric) AS premium_30d
                   FROM agents a
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = a.id
                     LEFT JOIN per_seller ps ON ps.seller_id = COALESCE(cm.canonical_agent_id, a.id)
                  WHERE a.is_deactivated = false AND COALESCE(cm.canonical_agent_id, a.id) = a.id
                )
         SELECT producers.id,
            producers.display_name,
            producers.agent_code,
            producers.deals_30d,
            producers.premium_30d::text AS premium_30d,
            ((( SELECT team_avg.avg_deal
                   FROM team_avg)) * 5::numeric)::numeric(12,2) AS potential_30d,
                CASE
                    WHEN producers.deals_30d = 0 AND producers.license_status = 'licensed'::license_status THEN 'Licensed · 0 deals in 30 days · schedule a 1-on-1 coaching session this week'::text
                    WHEN producers.deals_30d = 0 THEN 'No deals in 30 days · ride along on next call to identify the block'::text
                    WHEN producers.deals_30d < 3 THEN 'Below team pace · check-in this week'::text
                    ELSE 'Active'::text
                END AS recommendation
           FROM producers
          WHERE producers.deals_30d = 0 AND producers.created_at < (now() - '14 days'::interval)
          ORDER BY producers.license_status DESC NULLS LAST, producers.display_name
         LIMIT 50) t
  WHERE is_owner();

CREATE OR REPLACE VIEW public.v_inactive_agents_summary AS
 SELECT inactive_count,
    sample_names
   FROM ( WITH active_recently AS (
                 SELECT DISTINCT COALESCE(cm.canonical_agent_id, p.agent_id) AS seller_id
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p.agent_id
                  WHERE p.agent_id IS NOT NULL AND p.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)
                ), inactive AS (
                 SELECT a.id,
                    a.display_name
                   FROM agents a
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = a.id
                  WHERE a.is_deactivated = false AND a.license_status = 'licensed'::license_status
                    AND COALESCE(cm.canonical_agent_id, a.id) = a.id
                    AND NOT (EXISTS ( SELECT 1
                           FROM active_recently ar
                          WHERE ar.seller_id = a.id))
                    AND a.created_at < (now() - '14 days'::interval)
                )
         SELECT ( SELECT count(*) AS count
                   FROM inactive) AS inactive_count,
            ( SELECT array_agg(x.display_name) AS array_agg
                   FROM ( SELECT inactive.display_name
                           FROM inactive
                          ORDER BY inactive.display_name
                         LIMIT 12) x) AS sample_names) t
  WHERE is_owner();

CREATE OR REPLACE VIEW public.v_trophy_cabinet AS
 WITH ph AS (
         SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS today,
            date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date AS month_start,
            date_trunc('year'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date AS year_start
        ), prod AS (
         SELECT p.posted_date,
            p.annual_premium
           FROM v_production_canonical p,
            ph
          WHERE p.posted_date >= (ph.year_start - '1 year'::interval)
        ), daily_wins AS (
         SELECT count(DISTINCT prod.posted_date)::integer AS n
           FROM prod,
            ph
          WHERE prod.posted_date >= ph.month_start AND prod.posted_date <= ph.today
        ), weekly_wins AS (
         SELECT count(*)::integer AS n
           FROM ( SELECT date_trunc('week'::text, prod.posted_date::timestamp with time zone) AS wk,
                    count(*) AS deals
                   FROM prod,
                    ph
                  WHERE prod.posted_date >= ph.year_start AND prod.posted_date <= ph.today
                  GROUP BY (date_trunc('week'::text, prod.posted_date::timestamp with time zone))) x
          WHERE x.deals >= 5
        ), monthly_wins AS (
         SELECT count(*)::integer AS n
           FROM ( SELECT date_trunc('month'::text, prod.posted_date::timestamp with time zone) AS mo,
                    sum(prod.annual_premium) AS prem,
                    lag(sum(prod.annual_premium)) OVER (ORDER BY (date_trunc('month'::text, prod.posted_date::timestamp with time zone))) AS prev_prem
                   FROM prod,
                    ph
                  WHERE prod.posted_date >= ph.year_start
                  GROUP BY (date_trunc('month'::text, prod.posted_date::timestamp with time zone))) x
          WHERE x.prem > COALESCE(x.prev_prem, 0::numeric)
        ), quarterly_wins AS (
         SELECT count(*)::integer AS n
           FROM ( SELECT date_trunc('quarter'::text, prod.posted_date::timestamp with time zone) AS qt,
                    sum(prod.annual_premium) AS prem,
                    lag(sum(prod.annual_premium)) OVER (ORDER BY (date_trunc('quarter'::text, prod.posted_date::timestamp with time zone))) AS prev_prem
                   FROM prod
                  GROUP BY (date_trunc('quarter'::text, prod.posted_date::timestamp with time zone))) x
          WHERE x.prem > COALESCE(x.prev_prem, 0::numeric)
        )
 SELECT ( SELECT daily_wins.n
           FROM daily_wins) AS daily_wins,
    ( SELECT weekly_wins.n
           FROM weekly_wins) AS weekly_wins,
    ( SELECT monthly_wins.n
           FROM monthly_wins) AS monthly_wins,
    ( SELECT quarterly_wins.n
           FROM quarterly_wins) AS quarterly_wins,
    (( SELECT daily_wins.n
           FROM daily_wins)) + (( SELECT weekly_wins.n
           FROM weekly_wins)) + (( SELECT monthly_wins.n
           FROM monthly_wins)) + (( SELECT quarterly_wins.n
           FROM quarterly_wins)) AS total_wins;