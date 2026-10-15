-- PL-WIB-MTD-PANELS-CANONICAL (2026-10-15)
--
-- The Dashboard's Manager Hierarchy / Top Producers MTD panel read the raw
-- agentlink_book. Nobody has entered a deal in AgentLink since 2026-08-31;
-- production now lands as deals.source='apex_native' (148 rows, $236,436.60
-- since 08-24) plus Discord-reported external deals. Measured 2026-10-15:
--
--   v_today_dashboard (reads canonical)   43 deals / $74,183.72 MTD
--   v_top_producers_mtd (raw book)        1 row: "Willard Herald", 2 deals,
--                                         $1,821,600 ALP
--   v_manager_hierarchy_mtd (raw book)    every manager $0 / 0 deals
--
-- The only October rows in agentlink_book are two protest entries a departed
-- agent typed into AgentLink on 10-02 (policy numbers
-- "releasethecarrierandtakemeoffthisportal" and "kysdan&releasemycontracts",
-- $150,000/mo, $500M face, effective 2055, agent_id NULL). The raw-book view
-- ranked them #1 and only; the manager view dropped them (NULL agent_id joins
-- no roster row) and so showed $0 everywhere.
--
-- v_production_canonical already unions the scoped book, native deals and
-- Discord externals, de-duplicates across them, and drops unattributed book
-- rows whose name is not a known agent. Both views now read it, with column
-- names and types unchanged so CREATE OR REPLACE keeps grants and the
-- is_owner() gate on the manager view. Previewed read-only before applying:
-- both reconcile to exactly 43 deals / $74,183.72.
--
-- Unattributed rows (agent_id NULL) are grouped per name instead of lumped
-- under one NULL key with max(agent_name).

CREATE OR REPLACE VIEW public.v_top_producers_mtd AS
 WITH ph AS (
         SELECT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)))::date AS month_start
        ), prod AS (
         SELECT COALESCE(m.canonical_agent_id, p.agent_id) AS agent_id,
            p.agent_name,
            p.annual_premium
           FROM ((v_production_canonical p
             CROSS JOIN ph)
             LEFT JOIN v_agent_canonical_map m ON ((m.agent_id = p.agent_id)))
          WHERE (p.posted_date >= ph.month_start)
        ), canon AS (
         SELECT prod.agent_id,
            max(prod.agent_name) AS book_name,
            (count(*))::integer AS deals_mtd,
            sum(prod.annual_premium) AS alp_mtd
           FROM prod
          GROUP BY prod.agent_id, (CASE WHEN (prod.agent_id IS NULL) THEN lower(btrim(prod.agent_name)) ELSE NULL::text END)
        )
 SELECT c.agent_id,
    COALESCE(a.display_name, c.book_name) AS display_name,
    c.deals_mtd,
    c.alp_mtd,
    COALESCE(mgr.display_name, '(direct to Sam)'::text) AS manager_name
   FROM ((canon c
     LEFT JOIN agents a ON ((a.id = c.agent_id)))
     LEFT JOIN agents mgr ON ((mgr.id = a.invited_by_manager_id)))
  WHERE ((COALESCE(a.is_inactive, false) = false) AND (COALESCE(a.is_deactivated, false) = false) AND (c.deals_mtd > 0))
  ORDER BY c.alp_mtd DESC
 LIMIT 20
;

CREATE OR REPLACE VIEW public.v_manager_hierarchy_mtd AS
SELECT manager_id,
    manager_name,
    team_size,
    team_alp_mtd,
    team_deals_mtd,
    producing_team_mtd
   FROM ( WITH bounds AS (
                 SELECT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)))::date AS m_start,
                    ((date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)) + '1 mon'::interval))::date AS m_end
                ), roster AS (
                 SELECT r_1.id,
                    r_1.display_name,
                    r_1.manager_id
                   FROM v_apex_roster r_1
                ), prod AS (
                 SELECT COALESCE(m.canonical_agent_id, p.agent_id) AS canon,
                    sum(p.annual_premium) AS alp,
                    count(*) AS deals
                   FROM ((v_production_canonical p
                     LEFT JOIN v_agent_canonical_map m ON ((m.agent_id = p.agent_id)))
                     CROSS JOIN bounds)
                  WHERE ((p.posted_date >= bounds.m_start) AND (p.posted_date < bounds.m_end))
                  GROUP BY COALESCE(m.canonical_agent_id, p.agent_id)
                )
         SELECT COALESCE(r.manager_id, '00000000-0000-0000-0000-000000000000'::uuid) AS manager_id,
            COALESCE(mgr.display_name, '(direct to Sam)'::text) AS manager_name,
            count(*) AS team_size,
            COALESCE(sum(p.alp), (0)::numeric) AS team_alp_mtd,
            (COALESCE(sum(p.deals), (0)::numeric))::bigint AS team_deals_mtd,
            count(*) FILTER (WHERE (p.canon IS NOT NULL)) AS producing_team_mtd
           FROM ((roster r
             LEFT JOIN prod p ON ((p.canon = r.id)))
             LEFT JOIN agents mgr ON ((mgr.id = r.manager_id)))
          GROUP BY COALESCE(r.manager_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(mgr.display_name, '(direct to Sam)'::text)
          ORDER BY COALESCE(sum(p.alp), (0)::numeric) DESC) t
  WHERE is_owner();
