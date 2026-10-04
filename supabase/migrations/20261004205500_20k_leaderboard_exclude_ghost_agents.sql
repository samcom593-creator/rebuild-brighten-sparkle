-- MP: the $20K Pace Board rendered another agency's producers as Apex new hires.
--
-- v_agent_20k_target_leaderboard is NOT a dead view. It is queried live by
-- src/components/dashboard/Target20kPaceWidget.tsx:48 (rendered at
-- src/pages/DashboardCommandCenter.tsx:663 as the "$20K Pace Board") and by
-- src/components/dashboard/AgentProfileDrawer.tsx:470 for pace_verdict. The
-- 2026-10-03 ledger entry claiming this view "is referenced by NOTHING -- not
-- src/" was wrong; that claim is what downgraded apex-doctor's duplicate-name
-- CRITICAL to cosmetic. It is not cosmetic.
--
-- Measured 2026-10-04: 6 of 28 rows (21.4%) were GHOST_AYRO_* placeholders --
-- one of them literally named "snow flake" -- each rendered with
-- pace_verdict='new_hire_grace', $0 ap_mtd and ap_to_20k=$20,000, i.e. as a
-- real Apex hire who has sold nothing. They are not hires: ingest_ayro_sales_deal()
-- mints them status='active', has_production_access=true purely to attribute
-- Ayro Financial deals, and its own metadata says 'deal-attribution only'.
-- They evade this view's wave-94 canonical filter because canonical_agent_id
-- IS NULL on every one of them.
--
-- NOT self-clearing: these 6 enter only via the `hired > now()-30d` clause and
-- would age out, but the importer is an ongoing writer (mints on 2026-09-23,
-- 09-28 and 09-30), so new placeholders keep entering the window. The fix is
-- the predicate, not waiting for the calendar.
--
-- The NULL-safe form is load-bearing, not decoration: 17 of the 24 agents in
-- this view's 30-day window carry agent_code IS NULL (43 of 89 across the whole
-- active canonical set). A bare `agent_code NOT LIKE 'GHOST%'` evaluates NULL
-- on those rows and excludes them, which would drop 17 real new hires off Sam's
-- board to remove 6 ghosts. Spelling is kept byte-identical to the
-- landing_live_stats precedent (20261003182000) so there is one convention here,
-- not two.
--
-- Deal attribution is unaffected: v_production_canonical and
-- v_production_comp_truth were measured and neither filters agents.status or
-- agent_code, so the Ayro deals stay attributed. This changes who is shown a
-- PACE verdict, never who is paid.

DROP VIEW IF EXISTS public.v_agent_20k_target_leaderboard;

CREATE VIEW public.v_agent_20k_target_leaderboard AS
 WITH canonical_agents AS (
         SELECT a.id,
            a.profile_id,
            a.agent_code,
            a.display_name,
            a.license_status,
            a.created_at
           FROM agents a
          WHERE a.canonical_agent_id IS NULL
            AND a.status = 'active'::agent_status
            AND (a.agent_code IS NULL OR a.agent_code NOT LIKE 'GHOST%')
        ), deals_canon AS (
         SELECT COALESCE(m.canonical_agent_id, d.agent_id) AS canon_agent_id,
            d.id,
            d.annual_premium,
            d.posted_at,
            d.policy_number
           FROM deals d
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
          WHERE d.status = ANY (ARRAY['submitted'::text, 'active'::text])
        ), base AS (
         SELECT ca.id AS agent_id,
            COALESCE(NULLIF(p.full_name, ''::text), NULLIF(ca.display_name, ''::text), NULLIF(ca.agent_code, ''::text), 'Agent '::text || "left"(ca.id::text, 8)) AS name,
            p.email,
            ca.license_status,
            ca.created_at::date AS hired,
            count(dc.id) FILTER (WHERE dc.posted_at >= date_trunc('month'::text, now())) AS deals_mtd,
            COALESCE(sum(dc.annual_premium) FILTER (WHERE dc.posted_at >= date_trunc('month'::text, now())), 0::numeric)::integer AS ap_mtd,
            count(dc.id) FILTER (WHERE dc.posted_at >= date_trunc('month'::text, now()) AND (dc.policy_number IS NULL OR dc.policy_number = ''::text)) AS deals_no_policy_mtd,
            COALESCE(sum(dc.annual_premium) FILTER (WHERE dc.posted_at >= date_trunc('month'::text, now()) AND (dc.policy_number IS NULL OR dc.policy_number = ''::text)), 0::numeric)::integer AS ap_at_risk_mtd
           FROM canonical_agents ca
             LEFT JOIN profiles p ON p.id = ca.profile_id
             LEFT JOIN deals_canon dc ON dc.canon_agent_id = ca.id
          GROUP BY ca.id, ca.agent_code, ca.display_name, p.full_name, p.email, ca.license_status, ca.created_at
        )
 SELECT agent_id,
    name,
    email,
    license_status,
    hired,
    deals_mtd,
    ap_mtd,
    deals_no_policy_mtd,
    ap_at_risk_mtd,
    GREATEST(20000 - ap_mtd, 0) AS ap_to_20k,
        CASE
            WHEN EXTRACT(day FROM now())::integer = 0 THEN 0
            ELSE round(ap_mtd::numeric / EXTRACT(day FROM now()) * EXTRACT(day FROM date_trunc('month'::text, now()) + '1 mon -1 days'::interval))::integer
        END AS projected_eom_ap,
        CASE
            WHEN ap_mtd >= 20000 THEN 'hit_20k'::text
            WHEN ap_mtd > 0 AND (ap_mtd::numeric / NULLIF(EXTRACT(day FROM now()), 0::numeric) * EXTRACT(day FROM date_trunc('month'::text, now()) + '1 mon -1 days'::interval)) >= 20000::numeric THEN 'on_pace_20k'::text
            WHEN ap_mtd > 0 THEN 'below_pace'::text
            WHEN hired > (now() - '30 days'::interval)::date THEN 'new_hire_grace'::text
            ELSE 'zero_mtd'::text
        END AS pace_verdict
   FROM base
  WHERE deals_mtd > 0 OR ap_mtd > 0 OR hired > (now() - '30 days'::interval)::date
  ORDER BY ap_mtd DESC NULLS LAST, (
        CASE
            WHEN EXTRACT(day FROM now())::integer = 0 THEN 0
            ELSE round(ap_mtd::numeric / EXTRACT(day FROM now()) * EXTRACT(day FROM date_trunc('month'::text, now()) + '1 mon -1 days'::interval))::integer
        END) DESC;

COMMENT ON VIEW public.v_agent_20k_target_leaderboard IS
  'Per-agent MTD pace vs the $20K target. Rendered live on the $20K Pace Board (DashboardCommandCenter) and AgentProfileDrawer. Excludes GHOST% agent_codes (external deal-attribution placeholders minted by ingest_ayro_sales_deal) NULL-safely -- 43 of 89 active canonical agents have agent_code IS NULL and a bare NOT LIKE would silently drop them.';
