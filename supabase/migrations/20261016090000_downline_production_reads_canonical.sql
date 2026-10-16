-- PL-WIB-DOWNLINE-CANONICAL (2026-10-16)
--
-- The Team Hierarchy card on /dashboard/admin (TeamHierarchyWidget) lists
-- every recruiter with own, downline and team AP for the month, and its
-- header badge sums team MTD. v_agent_with_downline_production built the
-- month from the raw agentlink_book, and nobody has entered a deal in
-- AgentLink since 2026-08-31. Measured 2026-10-16, as Sam:
--
--   raw book, October       2 rows, both Willard Herald with no agent_id
--                           ($1,800,000 and $21,600), so neither joins
--   card                    96 rows, 7 recruiters, every own/downline/team
--                           figure $0, badge "$0 team MTD"
--   canonical, October      50 deals / $86,843.84 across 11 sellers, all
--                           attributed to an agent
--
-- The mtd CTE now reads v_production_canonical (dead and status-excluded
-- rows are already filtered there), keyed through the same canon CTE as
-- before. Nothing else changes: columns, types, the tree, the direct-recruit
-- count, owner (postgres) and grants.
--
-- WITH (security_invoker = true) is restated on purpose. CREATE OR REPLACE
-- VIEW without a WITH clause resets reloptions, and this view has no gate of
-- its own: it relies on the caller's RLS over agents' production and
-- profiles' emails. Without the option it runs as postgres and a bare
-- self-signup reads 75 agent emails (proof M2). v_production_canonical is
-- itself security_invoker, so the new source shows each caller only what
-- they could already read: Sam all 50 rows, a plain agent her own 4, a
-- stranger 0.
--
-- Proof: business-ops/website-integrity-bot/scripts/prove-downline-
-- production-canonical.sh (rolled back). Candidate 7/7; M1 (pre-image) flips
-- own MTD (11 rows), badge ($0) and downline MTD (11 rows) only; M2 (this
-- definition without security_invoker) flips the three gate probes only.

CREATE OR REPLACE VIEW public.v_agent_with_downline_production WITH (security_invoker = true) AS
 WITH canon AS (
         SELECT x.id AS agent_id,
            COALESCE(x.canonical_agent_id, x.id) AS canonical_id
           FROM agents x
        ), mtd AS (
         SELECT c.canonical_id,
            COALESCE(sum(d.annual_premium), 0::numeric) AS ap_mtd,
            count(d.row_key) AS deals_mtd
           FROM v_production_canonical d
             JOIN canon c ON c.agent_id = d.agent_id
          WHERE d.posted_date >= date_trunc('month'::text, now())::date
          GROUP BY c.canonical_id
        ), edges AS (
         SELECT p_1.ancestor_id,
            t.id AS descendant_id
           FROM v_team_hierarchy t
             CROSS JOIN LATERAL unnest(t.path) p_1(ancestor_id)
          WHERE p_1.ancestor_id <> t.id
        ), downline AS (
         SELECT e.ancestor_id,
            count(DISTINCT e.descendant_id) AS downline_size,
            COALESCE(sum(m.ap_mtd), 0::numeric) AS downline_ap_mtd
           FROM edges e
             LEFT JOIN mtd m ON m.canonical_id = e.descendant_id
          GROUP BY e.ancestor_id
        ), direct AS (
         SELECT ap.id AS agent_id,
            count(*) AS direct_recruits
           FROM agents ap
             JOIN agents r ON r.canonical_agent_id IS NULL AND (r.invited_by_manager_id = ap.id OR r.manager_id = ap.id)
          WHERE ap.canonical_agent_id IS NULL
          GROUP BY ap.id
        )
 SELECT a.id AS agent_id,
    COALESCE(NULLIF(TRIM(BOTH FROM p.full_name), ''::text), NULLIF(TRIM(BOTH FROM a.display_name), ''::text), NULLIF(TRIM(BOTH FROM a.agent_code), ''::text), '—'::text) AS name,
    p.email,
    a.invited_by_manager_id,
    a.manager_id,
    a.status,
    a.license_status,
    a.created_at::date AS hired,
    COALESCE(own.ap_mtd, 0::numeric)::integer AS own_ap_mtd,
    COALESCE(own.deals_mtd, 0::bigint) AS own_deals_mtd,
    COALESCE(dr.direct_recruits, 0::bigint) AS direct_recruits,
    COALESCE(dl.downline_size, 0::bigint) AS downline_size,
    COALESCE(dl.downline_ap_mtd, 0::numeric)::integer AS downline_ap_mtd,
    (COALESCE(own.ap_mtd, 0::numeric) + COALESCE(dl.downline_ap_mtd, 0::numeric))::integer AS team_ap_mtd
   FROM agents a
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN mtd own ON own.canonical_id = a.id
     LEFT JOIN downline dl ON dl.ancestor_id = a.id
     LEFT JOIN direct dr ON dr.agent_id = a.id
  WHERE a.canonical_agent_id IS NULL AND a.status = 'active'::agent_status;
