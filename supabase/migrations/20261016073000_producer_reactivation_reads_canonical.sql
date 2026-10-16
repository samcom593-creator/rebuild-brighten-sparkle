-- PL-WIB-REACTIVATION-CANONICAL (2026-10-16)
--
-- /admin/producer-reactivation is a call list: producers who have gone dark,
-- ranked by what a win-back is worth, with a Call button on each row. It
-- opens on the Hot winback tab. v_producer_reactivation built it from the raw
-- agentlink_book, and nobody has entered a deal in AgentLink since
-- 2026-08-31, so every seller who moved to native posting read as dark.
-- Measured 2026-10-16, as Sam:
--
--   Hot winback tab (raw book)   5 rows; the top 3 are Chudi Ifediora (59d
--                                dark), Obiajulu Ifediora (56d) and Wendell
--                                Funderburg (46d). In canonical they last sold
--                                1, 4 and 1 days ago.
--   Whole list                   40 rows; 6 sold within 25 days (also Sam
--                                himself, Aisha Kebbeh, Michael Kayembe), and
--                                1 is Alyjah Rowland, whom Sam removed from the
--                                roster on 2026-08-22 (roster_exclusions).
--   Missing                      5 native sellers who really are dark: Marquay
--                                Vaughns (8 deals, 43d), Tre'va Tribble (5, 46d),
--                                Pranav Kodali, David Ladd, KJ Vaughn.
--
-- The book CTE now reads v_production_canonical, with twin agent ids rolled
-- up through v_agent_canonical_map (same rollup as v_manager_scorecard,
-- 20261016061500). Rows group by seller id; the 6 canonical rows with no
-- agent_id still group by name, as before. agent_name is now the agent's
-- display_name when the seller has an agents row, so a native seller never
-- shows as the literal "Agent". After: 38 rows, 0 sold within 25 days, Hot
-- winback holds only Marcos Castellanos (37d dark, was 56d).
--
-- Tiers, the score formula, column names and types are unchanged. Owner
-- (postgres), grants and the trailing is_agency_staff() gate carry over.
-- Proof: business-ops/website-integrity-bot/scripts/prove-producer-
-- reactivation-canonical.sh (rolled back).

CREATE OR REPLACE VIEW public.v_producer_reactivation AS
 SELECT agent_name,
    agent_id,
    display_name,
    agent_status,
    license_status,
    agent_phone,
    agent_email,
    agent_instagram,
    deals,
    lifetime_alp,
    avg_alp_per_deal,
    alp_per_month_when_active,
    last_deal_at,
    first_deal_at,
    days_dark,
    deals_90d,
    alp_90d,
    reactivation_tier,
    reactivation_score
   FROM ( WITH prod AS (
                 SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS seller_id,
                    btrim(p.agent_name) AS agent_name,
                    p.annual_premium,
                    p.posted_date
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p.agent_id
                  WHERE p.agent_id IS NOT NULL OR (p.agent_name IS NOT NULL AND btrim(p.agent_name) <> ''::text)
                ), book AS (
                 SELECT prod.seller_id,
                    CASE WHEN prod.seller_id IS NULL THEN lower(prod.agent_name) ELSE NULL::text END AS name_key,
                    min(prod.agent_name) AS book_name,
                    count(*) AS deals,
                    sum(prod.annual_premium) AS lifetime_alp,
                    max(prod.posted_date) AS last_deal_at,
                    min(prod.posted_date) AS first_deal_at,
                    count(*) FILTER (WHERE prod.posted_date >= (CURRENT_DATE - 90)) AS deals_90d,
                    sum(prod.annual_premium) FILTER (WHERE prod.posted_date >= (CURRENT_DATE - 90)) AS alp_90d
                   FROM prod
                  GROUP BY prod.seller_id, (CASE WHEN prod.seller_id IS NULL THEN lower(prod.agent_name) ELSE NULL::text END)
                ), scored AS (
                 SELECT b.seller_id,
                    b.book_name,
                    b.deals,
                    b.lifetime_alp,
                    b.last_deal_at,
                    b.first_deal_at,
                    b.deals_90d,
                    b.alp_90d,
                    CURRENT_DATE - b.last_deal_at AS days_dark,
                    round(b.lifetime_alp / NULLIF(b.deals, 0)::numeric) AS avg_alp_per_deal,
                    round(b.lifetime_alp / NULLIF(GREATEST(30, b.last_deal_at - b.first_deal_at)::numeric / 30.0, 0::numeric)) AS alp_per_month_when_active
                   FROM book b
                  WHERE b.deals > 0
                )
         SELECT COALESCE(a.display_name, s.book_name) AS agent_name,
            a.id AS agent_id,
            a.display_name,
            a.status AS agent_status,
            a.license_status,
            ap.phone AS agent_phone,
            ap.email AS agent_email,
            ap.instagram_handle AS agent_instagram,
            s.deals,
            round(s.lifetime_alp) AS lifetime_alp,
            s.avg_alp_per_deal,
            s.alp_per_month_when_active,
            s.last_deal_at,
            s.first_deal_at,
            s.days_dark,
            s.deals_90d,
            round(COALESCE(s.alp_90d, 0::numeric)) AS alp_90d,
                CASE
                    WHEN s.days_dark <= 25 THEN 'active'::text
                    WHEN s.deals >= 20 AND s.days_dark <= 60 THEN 'hot_winback'::text
                    WHEN s.deals >= 20 AND s.days_dark <= 120 THEN 'proven_cold'::text
                    WHEN s.deals >= 5 AND s.days_dark <= 60 THEN 'warm_winback'::text
                    WHEN s.deals >= 5 THEN 'long_dormant'::text
                    ELSE 'light_producer'::text
                END AS reactivation_tier,
            round(COALESCE(s.alp_per_month_when_active, 0::numeric) * exp('-1.0'::numeric * GREATEST(0, s.days_dark)::numeric / 90.0) * (s.deals::numeric / (s.deals + 5)::numeric)) AS reactivation_score
           FROM scored s
             LEFT JOIN LATERAL ( SELECT g.id,
                    g.display_name,
                    g.status,
                    g.license_status
                   FROM agents g
                  WHERE g.id = s.seller_id
                     OR (s.seller_id IS NULL AND lower(btrim(g.display_name)) = lower(s.book_name))
                  ORDER BY (g.id = s.seller_id) DESC NULLS LAST, (g.status = 'active'::agent_status) DESC, g.id
                 LIMIT 1) a ON true
             LEFT JOIN LATERAL ( SELECT p.phone,
                    p.email,
                    p.instagram_handle
                   FROM applications p
                  WHERE lower(btrim((p.first_name || ' '::text) || p.last_name)) = lower(btrim(COALESCE(a.display_name, s.book_name)))
                  ORDER BY p.created_at DESC
                 LIMIT 1) ap ON true
          WHERE s.days_dark > 25
          ORDER BY (round(COALESCE(s.alp_per_month_when_active, 0::numeric) * exp('-1.0'::numeric * GREATEST(0, s.days_dark)::numeric / 90.0) * (s.deals::numeric / (s.deals + 5)::numeric))) DESC) t
  WHERE is_agency_staff();
