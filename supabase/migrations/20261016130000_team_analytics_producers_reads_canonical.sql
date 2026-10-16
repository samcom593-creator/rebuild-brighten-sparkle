-- PL-WIB-TEAM-PRODUCERS-CANONICAL
-- Proof: business-ops/website-integrity-bot/scripts/prove-team-producers-canonical.sh (rolled back).
-- Owner, grants, column names/types and the is_owner() gate are unchanged (CREATE OR REPLACE).
-- Ask APEX "who is my top producer?" reads the first row. It read raw agentlink_book, so a
-- $1,821,600 unassigned book row (Willard Herald, agent_id NULL) that canonical excludes
-- answered the question, and every seller with an AgentLink id but no 30d book rows vanished.
-- One row per canonical seller off v_production_canonical, the same population
-- v_business_analytics_insights counts. A deal with no agent stays visible, keyed by name.
-- monthly_30d is annual/12: agentlink_book and deals both store monthly = annual/12 on every
-- row measured (747 of 747 over 120d), and canonical carries annual only.
CREATE OR REPLACE VIEW public.v_team_analytics_producers AS
 SELECT user_id, agent_name, agent_code, deals_30d, premium_30d, monthly_30d, avg_deal_size, last_deal_date
   FROM ( WITH s AS (
                 SELECT COALESCE(m.canonical_agent_id, p.agent_id) AS seller_id,
                    CASE WHEN COALESCE(m.canonical_agent_id, p.agent_id) IS NULL
                         THEN 'name:' || lower(btrim(p.agent_name)) END AS name_key,
                    p.agent_name, p.annual_premium, p.posted_date
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map m ON m.agent_id = p.agent_id
                  WHERE p.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)
                ), g AS (
                 SELECT s.seller_id, s.name_key, min(s.agent_name) AS deal_name,
                    count(*)::integer AS deals_30d,
                    COALESCE(sum(s.annual_premium), 0::numeric) AS premium_30d,
                    round(COALESCE(sum(s.annual_premium), 0::numeric) / 12::numeric, 2) AS monthly_30d,
                    COALESCE(avg(s.annual_premium), 0::numeric)::numeric(12,2) AS avg_deal_size,
                    max(s.posted_date) AS last_deal_date
                   FROM s
                  GROUP BY s.seller_id, s.name_key
                )
         SELECT CASE WHEN g.seller_id IS NULL THEN NULL::integer ELSE COALESCE(a.al_user_id, '-1'::integer) END AS user_id,
            COALESCE(a.display_name, g.deal_name) AS agent_name,
            a.agent_code,
            g.deals_30d, g.premium_30d, g.monthly_30d, g.avg_deal_size, g.last_deal_date
           FROM g
             LEFT JOIN agents a ON a.id = g.seller_id
          ORDER BY g.premium_30d DESC NULLS LAST, g.deals_30d DESC, COALESCE(a.display_name, g.deal_name)) t
  WHERE is_owner();
