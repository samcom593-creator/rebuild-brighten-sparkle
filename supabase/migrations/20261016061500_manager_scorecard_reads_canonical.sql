-- PL-WIB-MANAGER-SCORECARD-CANONICAL (2026-10-16)
--
-- /admin/producer-trends renders one card per manager from v_manager_scorecard.
-- Its "Deals 30d" and "ALP 30d" tiles go amber at zero. The book CTE behind
-- them read the raw agentlink_book, and nobody has entered a deal in
-- AgentLink since 2026-08-31 (the only two raw rows since then have no
-- agent_id, so they join to no manager). Measured 2026-10-16, as Sam:
--
--   v_manager_scorecard (raw book)   10 managers, all 0 deals / $0 in 30d, all amber
--   v_production_canonical           110 deals / $191,141 in 30d under a manager
--                                    (Samuel James 62 / $114,758, Chudi Ifediora
--                                    35 / $49,879, Aisha Kebbeh 13 / $26,504)
--
-- Now the book CTE reads v_production_canonical, with twin agent ids rolled
-- up through v_agent_canonical_map before the manager join, the same rollup
-- v_agent_weekly_production uses (20261015193000).
--
-- team_in_force_alp is deliberately still book-only (origin = 'agentlink',
-- status Active/Issued). Only the carrier book carries an issued/in-force
-- status; native deals are 'submitted' and Discord-reported deals use their
-- own vocabulary, so counting them as in force would be invented. Measured
-- unchanged: $112,949 across rendered managers, before and after.
--
-- Column names and types are unchanged. Owner (postgres), grants and the
-- trailing is_owner() gate carry over: owners only, as before.
--
-- Proof: business-ops/website-integrity-bot/scripts/prove-manager-scorecard-
-- canonical.sh, rolled back, 7/7 (rows, deals 30d, ALP 30d, in-force
-- unchanged, no false amber, non-owner agent gated, stranger gated). M1
-- injects the pre-image and flips exactly deals 30d (0 vs 110), ALP 30d
-- ($0 vs $191,141) and false amber (3 managers).

CREATE OR REPLACE VIEW public.v_manager_scorecard AS
 SELECT manager_agent_id,
    manager_name,
    reports_total,
    reports_activeroster,
    reports_licensed,
    reports_onboarding_incomplete,
    reports_no_first_sale,
    reports_licensed_no_first_sale,
    reports_licensed_inactive,
    reports_contracted,
    reports_appointment_set,
    pct_licensed,
    pct_licensed_producing,
    team_in_force_alp,
    team_deals_30d,
    team_alp_30d,
    retention_risk_pct,
    manager_deactivated
   FROM ( WITH mgr AS (
                 SELECT DISTINCT agents.manager_id AS id
                   FROM agents
                  WHERE agents.manager_id IS NOT NULL
                ), reports AS (
                 SELECT a.manager_id,
                    count(*) AS reports_total,
                    count(*) FILTER (WHERE a.is_deactivated IS NOT TRUE) AS reports_activeroster,
                    count(*) FILTER (WHERE a.license_status::text = 'licensed'::text AND a.is_deactivated IS NOT TRUE) AS reports_licensed,
                    count(*) FILTER (WHERE a.is_deactivated IS NOT TRUE AND a.onboarding_completed_at IS NULL AND a.onboarding_stage::text IS DISTINCT FROM 'live'::text) AS reports_onboarding_incomplete,
                    count(*) FILTER (WHERE a.is_deactivated IS NOT TRUE AND a.first_deal_at IS NULL) AS reports_no_first_sale,
                    count(*) FILTER (WHERE a.is_deactivated IS NOT TRUE AND a.license_status::text = 'licensed'::text AND a.first_deal_at IS NULL) AS reports_licensed_no_first_sale,
                    count(*) FILTER (WHERE a.is_deactivated IS NOT TRUE AND COALESCE(a.is_inactive, false) = true AND a.license_status::text = 'licensed'::text) AS reports_licensed_inactive,
                    count(*) FILTER (WHERE a.contracted_at IS NOT NULL AND a.is_deactivated IS NOT TRUE) AS reports_contracted,
                    count(*) FILTER (WHERE a.first_appointment_at IS NOT NULL AND a.is_deactivated IS NOT TRUE) AS reports_appointment_set
                   FROM agents a
                  GROUP BY a.manager_id
                ), book AS (
                 SELECT a.manager_id,
                    round(COALESCE(sum(p.annual_premium) FILTER (WHERE p.origin = 'agentlink'::text AND (p.status = ANY (ARRAY['Active'::text, 'Issued'::text]))), 0::numeric), 0) AS team_in_force_alp,
                    count(*) FILTER (WHERE p.posted_date >= (CURRENT_DATE - 30)) AS team_deals_30d,
                    round(COALESCE(sum(p.annual_premium) FILTER (WHERE p.posted_date >= (CURRENT_DATE - 30)), 0::numeric), 0) AS team_alp_30d
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p.agent_id
                     JOIN agents a ON a.id = COALESCE(cm.canonical_agent_id, p.agent_id)
                  WHERE p.agent_id IS NOT NULL
                  GROUP BY a.manager_id
                )
         SELECT m.id AS manager_agent_id,
            COALESCE(mp.display_name, pr.full_name, ('(manager '::text || "left"(m.id::text, 8)) || ')'::text) AS manager_name,
            r.reports_total,
            r.reports_activeroster,
            r.reports_licensed,
            r.reports_onboarding_incomplete,
            r.reports_no_first_sale,
            r.reports_licensed_no_first_sale,
            r.reports_licensed_inactive,
            r.reports_contracted,
            r.reports_appointment_set,
                CASE
                    WHEN r.reports_activeroster > 0 THEN round(100.0 * r.reports_licensed::numeric / r.reports_activeroster::numeric, 1)
                    ELSE NULL::numeric
                END AS pct_licensed,
                CASE
                    WHEN r.reports_licensed > 0 THEN round(100.0 * (r.reports_licensed - r.reports_licensed_no_first_sale)::numeric / r.reports_licensed::numeric, 1)
                    ELSE NULL::numeric
                END AS pct_licensed_producing,
            COALESCE(b.team_in_force_alp, 0::numeric) AS team_in_force_alp,
            COALESCE(b.team_deals_30d, 0::bigint) AS team_deals_30d,
            COALESCE(b.team_alp_30d, 0::numeric) AS team_alp_30d,
                CASE
                    WHEN r.reports_licensed > 0 THEN round(100.0 * r.reports_licensed_inactive::numeric / r.reports_licensed::numeric, 1)
                    ELSE 0::numeric
                END AS retention_risk_pct,
            mp.is_deactivated AS manager_deactivated
           FROM mgr m
             LEFT JOIN agents mp ON mp.id = m.id
             LEFT JOIN profiles pr ON pr.id = mp.profile_id
             JOIN reports r ON r.manager_id = m.id
             LEFT JOIN book b ON b.manager_id = m.id
          ORDER BY (COALESCE(b.team_in_force_alp, 0::numeric)) DESC) t
  WHERE is_owner();
