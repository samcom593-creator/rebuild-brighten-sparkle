-- PL-WIB-BUSINESS-ANALYTICS-CANONICAL (2026-10-16)
--
-- v_business_analytics_summary, v_business_analytics_insights and
-- v_business_analytics_carriers feed the header tiles, the insight cards and
-- the carrier table on /dashboard/analytics (BusinessAnalytics.tsx), and the
-- summary + insights rows are read into Ask APEX (AskApex.tsx), which states
-- them as fact. All three read the raw agentlink_book, and nobody has posted a
-- deal in AgentLink since 2026-08-31 (newest raw row 2026-10-02). Measured as
-- Sam through the authenticated role before the change:
--
--   field                    raw book                 canonical
--   deals MTD / premium MTD  2 / $1,821,600           50 / $86,843.84
--   premium last month       $0 (growth shown 0%)     $182,832.12
--   active producers 30d     1                        13
--   team 30d deals / premium 2 / $1,821,600           112 / $194,801.32
--   top carrier              Newbridge, 100%          Ethos (native + Discord)
--
-- October was two Willard Herald rows with no agent_id, one 1000x the other;
-- canonical already drops them. The page read one producer averaging $910,800
-- a deal.
--
-- All three now read v_production_canonical (which already drops is_dead rows)
-- and roll sellers up through v_agent_canonical_map. Windows are unchanged.
-- Carriers are grouped by the label on the deal; carrier_id is the
-- agentlink_carriers id when the label matches one, otherwise a stable
-- negative id from the label, so key={c.carrier_id} stays unique for carriers
-- the table does not list (Ethos, Chubb). Labels are not normalised ("Trans"
-- on two Discord deals stays its own row). Columns, types, owner, grants and
-- the is_owner() gate are unchanged.
--
-- Proof (business-ops/website-integrity-bot/scripts/prove-business-analytics-
-- canonical.sh, rolled back): candidate 8/8. M1 injects the pre-image and
-- flips the five canonical-match probes while carrier-key uniqueness, the
-- non-owner zero read and owner/grants hold.

CREATE OR REPLACE VIEW public.v_business_analytics_summary AS
 SELECT total_deals_mtd, total_premium_mtd, active_producers_30d, avg_deal_size, premium_last_month, growth_pct_mom
   FROM ( WITH ph AS (
                 SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS today,
                    date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date AS month_start,
                    (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) + '1 mon'::interval)::date AS month_end,
                    (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) - '1 mon'::interval)::date AS last_month_start,
                    ((now() AT TIME ZONE 'America/Phoenix'::text)::date - '30 days'::interval)::date AS days_30_ago
                ), mtd AS (
                 SELECT COALESCE(sum(b.annual_premium), 0::numeric) AS ap, count(*) AS dc
                   FROM v_production_canonical b, ph
                  WHERE b.posted_date >= ph.month_start AND b.posted_date < ph.month_end
                ), lm AS (
                 SELECT COALESCE(sum(b.annual_premium), 0::numeric) AS ap
                   FROM v_production_canonical b, ph
                  WHERE b.posted_date >= ph.last_month_start AND b.posted_date < ph.month_start
                ), prod AS (
                 SELECT count(DISTINCT COALESCE(COALESCE(m.canonical_agent_id, b.agent_id)::text, 'name:'::text || lower(TRIM(BOTH FROM b.agent_name)))) AS n
                   FROM v_production_canonical b
                     LEFT JOIN v_agent_canonical_map m ON m.agent_id = b.agent_id, ph
                  WHERE b.posted_date >= ph.days_30_ago AND b.posted_date < ph.month_end
                )
         SELECT mtd.dc AS total_deals_mtd,
            mtd.ap AS total_premium_mtd,
            prod.n AS active_producers_30d,
            mtd.ap / NULLIF(mtd.dc, 0)::numeric AS avg_deal_size,
            lm.ap AS premium_last_month,
                CASE
                    WHEN lm.ap > 0::numeric THEN round((mtd.ap - lm.ap) / lm.ap * 100::numeric, 1)
                    ELSE 0::numeric
                END AS growth_pct_mom
           FROM mtd, lm, prod) t
  WHERE is_owner();

CREATE OR REPLACE VIEW public.v_business_analytics_insights AS
 SELECT top_carrier_name, top_carrier_share_pct, top_carrier_deals, top3_producer_share_pct, team_producers, team_deals_30d, team_premium_30d, streak_days, days_in_month_elapsed
   FROM ( WITH s AS (
                 SELECT p.annual_premium, p.posted_date,
                    COALESCE(m.canonical_agent_id, p.agent_id) AS seller_id,
                    COALESCE(ac.name, NULLIF(btrim(p.carrier), ''::text)) AS carrier_name
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map m ON m.agent_id = p.agent_id
                     LEFT JOIN LATERAL ( SELECT c.name FROM agentlink_carriers c
                          WHERE lower(btrim(c.name)) = lower(btrim(p.carrier)) ORDER BY c.id LIMIT 1) ac ON true
                ), t AS (
                 SELECT sum(s.annual_premium) AS team_premium, count(*) AS team_deals, count(DISTINCT s.seller_id) AS team_producers
                   FROM s
                  WHERE s.posted_date >= (now() - '30 days'::interval)::date
                ), top_carrier AS (
                 SELECT s.carrier_name, sum(s.annual_premium) AS premium, count(*) AS deals,
                    round(sum(s.annual_premium) * 100::numeric / NULLIF(( SELECT t_1.team_premium FROM t t_1), 0::numeric), 1) AS share_pct
                   FROM s
                  WHERE s.posted_date >= (now() - '30 days'::interval)::date
                  GROUP BY s.carrier_name
                  ORDER BY (sum(s.annual_premium)) DESC NULLS LAST
                 LIMIT 1
                ), top3 AS (
                 SELECT sum(x.p) AS top3_premium
                   FROM ( SELECT s.seller_id, sum(s.annual_premium) AS p
                           FROM s
                          WHERE s.posted_date >= (now() - '30 days'::interval)::date AND s.seller_id IS NOT NULL
                          GROUP BY s.seller_id
                          ORDER BY (sum(s.annual_premium)) DESC
                         LIMIT 3) x
                ), streak AS (
                 SELECT count(DISTINCT s.posted_date) AS days_with_deals,
                    EXTRACT(day FROM (now() AT TIME ZONE 'America/Phoenix'::text)) AS days_in_month_so_far
                   FROM s
                  WHERE s.posted_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date AND s.posted_date <= (now() AT TIME ZONE 'America/Phoenix'::text)::date
                )
         SELECT ( SELECT top_carrier.carrier_name FROM top_carrier) AS top_carrier_name,
            ( SELECT top_carrier.share_pct FROM top_carrier) AS top_carrier_share_pct,
            ( SELECT top_carrier.deals FROM top_carrier) AS top_carrier_deals,
            ( SELECT round(top3.top3_premium * 100::numeric / NULLIF(( SELECT t_1.team_premium FROM t t_1), 0::numeric), 1) AS round FROM top3) AS top3_producer_share_pct,
            ( SELECT t_1.team_producers FROM t t_1) AS team_producers,
            ( SELECT t_1.team_deals FROM t t_1) AS team_deals_30d,
            ( SELECT t_1.team_premium FROM t t_1) AS team_premium_30d,
            ( SELECT streak.days_with_deals FROM streak) AS streak_days,
            ( SELECT streak.days_in_month_so_far FROM streak) AS days_in_month_elapsed) t
  WHERE is_owner();

CREATE OR REPLACE VIEW public.v_business_analytics_carriers AS
 SELECT carrier_id, carrier_name, deal_count, total_premium, avg_deal_size
   FROM ( SELECT COALESCE(min(ac.id), (-1 - (hashtext(lower(btrim(p.carrier)))::bigint & 2147483646))::integer) AS carrier_id,
            COALESCE(min(ac.name), min(btrim(p.carrier))) AS carrier_name,
            count(*)::integer AS deal_count,
            COALESCE(sum(p.annual_premium), 0::numeric) AS total_premium,
            COALESCE(avg(p.annual_premium), 0::numeric)::numeric(12,2) AS avg_deal_size
           FROM v_production_canonical p
             LEFT JOIN LATERAL ( SELECT c.id, c.name FROM agentlink_carriers c
                  WHERE lower(btrim(c.name)) = lower(btrim(p.carrier)) ORDER BY c.id LIMIT 1) ac ON true
          WHERE NULLIF(btrim(p.carrier), ''::text) IS NOT NULL AND p.posted_date >= (now() - '30 days'::interval)::date
          GROUP BY (lower(btrim(p.carrier)))
          ORDER BY (COALESCE(sum(p.annual_premium), 0::numeric)) DESC) t
  WHERE is_owner();
