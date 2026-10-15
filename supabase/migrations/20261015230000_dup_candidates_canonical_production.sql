-- PL-WIB-DUP-CANDIDATES-CANONICAL
--
-- /admin/agent-duplicates measured production from the raw `deals` table only.
-- The only open pair on the page (Tyler Krejcha, bd58ef59 + ce84cf2d) read
-- "0 deals · $0 ALP" on both rows and has_production_signal = false, while
-- v_production_canonical credits the pair 5 policies / $15,765 (4 Discord
-- externals on the ghost row, 1 on the login row). Same class as
-- PL-WIB-WEEKLY-PRODUCTION-CANONICAL: a surface reading a source the rest of
-- the site stopped treating as the truth.
--
-- The $0 was not cosmetic. The page proposes as canonical the row with the most
-- lifetime_alp; on a 0 = 0 tie the stable sort keeps the view order
-- (created_at), so it proposed the GHOST row (GHOST_AYRO_TKREJCHA, no user_id)
-- and offered "Merge into" on the row Tyler logs in as. Measured in a rolled-back
-- transaction: after that merge his login resolves to 0 canonical agent rows
-- (useScriptsUnlocked, interviews-pipeline and add-agent all filter
-- canonical_agent_id IS NULL) and 0 rows in v_agent_weekly_production; merged
-- the other way the login row carries all 12 weeks. Fixing only the ALP operand
-- would make that wrong proposal MORE confident ($14,354 vs $1,411), so this
-- view also publishes has_login and the page now ranks a loginable row first.
--
-- Production is rolled up through v_agent_canonical_map, so rows already merged
-- INTO a candidate count toward it. last_deal_at keeps its timestamptz type
-- (CREATE OR REPLACE cannot change it) and now carries the posted_date.
-- Columns, order, grants and the is_agency_staff() gate are unchanged; has_login
-- is appended.

CREATE OR REPLACE VIEW public.v_agent_duplicate_candidates AS
 SELECT group_key,
    dup_reason,
    group_display_name,
    agent_id,
    agent_code,
    display_name,
    status,
    canonical_agent_id,
    al_user_id,
    insuracloud_user_id,
    is_active,
    created_at,
    lifetime_deals,
    lifetime_alp,
    applications_assigned,
    applications_referred,
    last_deal_at,
    downline_count,
    has_production_signal,
    has_login
   FROM ( WITH unresolved AS (
                 SELECT a_1.id,
                    a_1.display_name,
                    a_1.al_user_id,
                    a_1.insuracloud_user_id,
                    lower(btrim(COALESCE(a_1.display_name, ''::text))) AS name_key
                   FROM agents a_1
                  WHERE a_1.canonical_agent_id IS NULL
                ), cand AS (
                 SELECT 'display_name'::text AS dup_reason,
                    'name:'::text || u.name_key AS group_key,
                    u.display_name AS group_label,
                    u.id AS agent_id
                   FROM unresolved u
                  WHERE u.name_key <> ''::text AND (u.name_key IN ( SELECT unresolved.name_key
                           FROM unresolved
                          WHERE unresolved.name_key <> ''::text
                          GROUP BY unresolved.name_key
                         HAVING count(*) > 1))
                UNION ALL
                 SELECT 'al_user_id'::text AS text,
                    'al:'::text || u.al_user_id::text,
                    'AgentLink #'::text || u.al_user_id::text,
                    u.id
                   FROM unresolved u
                  WHERE u.al_user_id IS NOT NULL AND (u.al_user_id IN ( SELECT unresolved.al_user_id
                           FROM unresolved
                          WHERE unresolved.al_user_id IS NOT NULL
                          GROUP BY unresolved.al_user_id
                         HAVING count(*) > 1))
                UNION ALL
                 SELECT 'insuracloud_user_id'::text AS text,
                    'ic:'::text || u.insuracloud_user_id::text,
                    'InsuraCloud #'::text || u.insuracloud_user_id::text,
                    u.id
                   FROM unresolved u
                  WHERE u.insuracloud_user_id IS NOT NULL AND (u.insuracloud_user_id IN ( SELECT unresolved.insuracloud_user_id
                           FROM unresolved
                          WHERE unresolved.insuracloud_user_id IS NOT NULL
                          GROUP BY unresolved.insuracloud_user_id
                         HAVING count(*) > 1))
                ), one_per_agent AS (
                 SELECT DISTINCT ON (cand.agent_id) cand.agent_id,
                    cand.dup_reason,
                    cand.group_key,
                    cand.group_label
                   FROM cand
                  ORDER BY cand.agent_id, (
                        CASE cand.dup_reason
                            WHEN 'al_user_id'::text THEN 1
                            WHEN 'insuracloud_user_id'::text THEN 2
                            ELSE 3
                        END)
                ), sized AS (
                 SELECT o.agent_id,
                    o.dup_reason,
                    o.group_key,
                    o.group_label,
                    count(*) OVER (PARTITION BY o.group_key) AS group_size
                   FROM one_per_agent o
                ), prod AS (
                 SELECT COALESCE(m.canonical_agent_id, p.agent_id) AS agent_id,
                    count(*)::integer AS n,
                    COALESCE(sum(p.annual_premium), 0::numeric)::numeric(12,2) AS alp,
                    max(p.posted_date)::timestamp with time zone AS last_at
                   FROM v_production_canonical p
                     LEFT JOIN v_agent_canonical_map m ON m.agent_id = p.agent_id
                  WHERE p.agent_id IS NOT NULL
                  GROUP BY (COALESCE(m.canonical_agent_id, p.agent_id))
                )
         SELECT s.group_key,
            s.dup_reason,
            s.group_label AS group_display_name,
            a.id AS agent_id,
            a.agent_code,
            a.display_name,
            a.status,
            a.canonical_agent_id,
            a.al_user_id,
            a.insuracloud_user_id,
            NOT COALESCE(a.is_deactivated, false) AS is_active,
            a.created_at,
            COALESCE(pr.n, 0) AS lifetime_deals,
            COALESCE(pr.alp, 0::numeric)::numeric(12,2) AS lifetime_alp,
            ( SELECT count(*)::integer AS count
                   FROM applications app
                  WHERE app.assigned_agent_id = a.id) AS applications_assigned,
            ( SELECT count(*)::integer AS count
                   FROM applications app
                  WHERE app.referrer_agent_id = a.id) AS applications_referred,
            pr.last_at AS last_deal_at,
            ( SELECT count(*)::integer AS count
                   FROM agents dl
                  WHERE dl.manager_id = a.id) AS downline_count,
            COALESCE(pr.n, 0) > 0 OR (( SELECT count(*) AS count
                   FROM applications app
                  WHERE app.assigned_agent_id = a.id)) > 0 OR (( SELECT count(*) AS count
                   FROM agents dl
                  WHERE dl.manager_id = a.id)) > 0 OR a.al_user_id IS NOT NULL AS has_production_signal,
            a.user_id IS NOT NULL AS has_login
           FROM sized s
             JOIN agents a ON a.id = s.agent_id
             LEFT JOIN prod pr ON pr.agent_id = a.id
          WHERE s.group_size > 1
          ORDER BY s.dup_reason, s.group_key, a.created_at) _g
  WHERE is_agency_staff() OR auth.uid() IS NULL;
