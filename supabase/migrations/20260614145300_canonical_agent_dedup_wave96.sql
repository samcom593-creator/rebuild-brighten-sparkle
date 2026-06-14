-- wave-96: canonicalize 4 more agent-aggregating views via v_agent_canonical_map
-- (1) v_team_hierarchy            — recursive CTE filtered to canonical agents only
-- (2) v_agent_command_center      — multi-CTE; canonicalize child agent_ids before GROUP BY
-- (3) v_ceo_command_center        — count distinct canonical agents
-- (4) v_agent_with_downline_production — base + deal join canonicalized
--
-- Pattern (per wave-93/94/95): resolve agent_id → COALESCE(canonical_agent_id, id) so
-- work attached to a dup row (e.g., SJAMES02) rolls up to the canonical row (SJAMES01).
-- v_agent_canonical_map already provides this mapping (cm.agent_id → cm.canonical_agent_id).

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. v_team_hierarchy — recursive descent over canonical agents only.
--    Dups (canonical_agent_id IS NOT NULL) never become tree nodes, so downstream
--    `path` arrays never reference phantom dup IDs.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_team_hierarchy AS
WITH RECURSIVE tree AS (
  SELECT a.id,
         a.invited_by_manager_id AS upline_id,
         a.manager_id,
         1 AS depth,
         ARRAY[a.id] AS path,
         a.id AS root_id
    FROM agents a
   WHERE a.canonical_agent_id IS NULL
     AND ((COALESCE(a.invited_by_manager_id, a.manager_id) IS NULL)
          OR NOT (a.id IN (SELECT agents.id
                             FROM agents
                            WHERE agents.id = COALESCE(a.invited_by_manager_id, a.manager_id))))
  UNION ALL
  SELECT a.id,
         a.invited_by_manager_id AS upline_id,
         a.manager_id,
         (t.depth + 1),
         (t.path || a.id),
         t.root_id
    FROM agents a
    JOIN tree t ON (COALESCE(a.invited_by_manager_id, a.manager_id) = t.id)
   WHERE a.canonical_agent_id IS NULL
     AND NOT (a.id = ANY (t.path))
)
SELECT id, upline_id, manager_id, depth, path, root_id
  FROM tree;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. v_agent_command_center — canonicalize child rows in each CTE before GROUP BY.
--    Outer SELECT joins from canonical agents only so dup rows disappear.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_command_center AS
WITH dp AS (
  SELECT COALESCE(cm.canonical_agent_id, a_1.id) AS agent_id,
         (sum(CASE WHEN ((d.posted_at)::date = CURRENT_DATE) THEN 1 ELSE 0 END))::integer AS deals_today,
         (sum(CASE WHEN (d.posted_at >= date_trunc('week'::text, now())) THEN 1 ELSE 0 END))::integer AS deals_wtd,
         (sum(CASE WHEN (d.posted_at >= date_trunc('month'::text, now())) THEN 1 ELSE 0 END))::integer AS deals_mtd,
         (sum(CASE WHEN (d.posted_at >= (now() - '30 days'::interval)) THEN 1 ELSE 0 END))::integer AS deals_30d,
         (sum(CASE WHEN ((d.posted_at >= (now() - '60 days'::interval)) AND (d.posted_at < (now() - '30 days'::interval))) THEN 1 ELSE 0 END))::integer AS deals_30_60d,
         COALESCE(sum(d.annual_premium) FILTER (WHERE (d.posted_at >= date_trunc('week'::text, now()))), (0)::numeric) AS ap_wtd,
         COALESCE(sum(d.annual_premium) FILTER (WHERE (d.posted_at >= date_trunc('month'::text, now()))), (0)::numeric) AS ap_mtd,
         COALESCE(sum(d.annual_premium) FILTER (WHERE (d.posted_at >= (now() - '30 days'::interval))), (0)::numeric) AS ap_30d,
         COALESCE(sum(d.annual_premium) FILTER (WHERE ((d.posted_at >= (now() - '60 days'::interval)) AND (d.posted_at < (now() - '30 days'::interval)))), (0)::numeric) AS ap_30_60d,
         (COALESCE(sum(d.commission_cents), (0)::bigint))::integer AS commission_lifetime_cents,
         (sum(CASE WHEN (d.chargeback_status = ANY (ARRAY['chargeback'::text, 'charged_back'::text])) THEN 1 ELSE 0 END))::integer AS chargebacks,
         (sum(CASE WHEN (d.status = 'lapsed'::text) THEN 1 ELSE 0 END))::integer AS lapses
    FROM agents a_1
    LEFT JOIN v_agent_canonical_map cm ON (cm.agent_id = a_1.id)
    LEFT JOIN deals d ON (d.agent_id = a_1.id)
   GROUP BY COALESCE(cm.canonical_agent_id, a_1.id)
), prod AS (
  SELECT COALESCE(cm.canonical_agent_id, dpr.agent_id) AS agent_id,
         (sum(CASE WHEN (dpr.production_date = CURRENT_DATE) THEN dpr.presentations ELSE 0 END))::integer AS pres_today,
         (sum(CASE WHEN (dpr.production_date >= (date_trunc('week'::text, now()))::date) THEN dpr.presentations ELSE 0 END))::integer AS pres_wtd,
         (sum(CASE WHEN (dpr.production_date >= (date_trunc('month'::text, now()))::date) THEN dpr.presentations ELSE 0 END))::integer AS pres_mtd,
         sum(CASE WHEN (dpr.production_date = CURRENT_DATE) THEN dpr.hours_called ELSE (0)::numeric END) AS hours_today,
         sum(CASE WHEN (dpr.production_date >= (date_trunc('week'::text, now()))::date) THEN dpr.hours_called ELSE (0)::numeric END) AS hours_wtd,
         sum(CASE WHEN (dpr.production_date >= (date_trunc('month'::text, now()))::date) THEN dpr.hours_called ELSE (0)::numeric END) AS hours_mtd,
         max(dpr.production_date) AS last_production_date,
         (sum(CASE WHEN (dpr.production_date >= (CURRENT_DATE - '14 days'::interval)) THEN dpr.deals_closed ELSE 0 END))::integer AS deals_closed_14d
    FROM daily_production dpr
    LEFT JOIN v_agent_canonical_map cm ON (cm.agent_id = dpr.agent_id)
   GROUP BY COALESCE(cm.canonical_agent_id, dpr.agent_id)
), apps AS (
  SELECT COALESCE(cm.canonical_agent_id, applications.assigned_agent_id) AS agent_id,
         (count(*))::integer AS apps_assigned,
         (count(*) FILTER (WHERE ((applications.status <> ALL (ARRAY['approved'::application_status, 'rejected'::application_status])) AND (applications.terminated_at IS NULL))))::integer AS apps_open,
         (count(*) FILTER (WHERE (applications.created_at >= (now() - '7 days'::interval))))::integer AS apps_new_7d,
         (count(*) FILTER (WHERE ((applications.last_contacted_at IS NULL) OR (applications.last_contacted_at < (now() - '24:00:00'::interval)))))::integer AS apps_needing_contact
    FROM applications
    LEFT JOIN v_agent_canonical_map cm ON (cm.agent_id = applications.assigned_agent_id)
   WHERE applications.assigned_agent_id IS NOT NULL
   GROUP BY COALESCE(cm.canonical_agent_id, applications.assigned_agent_id)
), ranks AS (
  SELECT dp_1.agent_id,
         (rank() OVER (ORDER BY dp_1.ap_mtd DESC NULLS LAST))::integer AS rank_agency_mtd,
         (rank() OVER (ORDER BY dp_1.ap_wtd DESC NULLS LAST))::integer AS rank_agency_wtd
    FROM dp dp_1
), team_ranks AS (
  SELECT a_1.id AS agent_id,
         a_1.manager_id,
         (rank() OVER (PARTITION BY a_1.manager_id ORDER BY COALESCE(dp_1.ap_mtd, (0)::numeric) DESC))::integer AS rank_team_mtd
    FROM agents a_1
    LEFT JOIN dp dp_1 ON (dp_1.agent_id = a_1.id)
   WHERE a_1.canonical_agent_id IS NULL
)
SELECT a.id AS agent_id,
       a.user_id,
       a.agent_code,
       a.display_name,
       p.full_name,
       p.email,
       (a.status)::text AS agent_status,
       (a.onboarding_stage)::text AS onboarding_stage,
       (a.license_status)::text AS license_status,
       a.manager_id,
       mgr.display_name AS manager_name,
       a.is_presenting,
       COALESCE(dp.deals_today, 0) AS deals_today,
       COALESCE(dp.deals_wtd, 0) AS deals_wtd,
       COALESCE(dp.deals_mtd, 0) AS deals_mtd,
       COALESCE(dp.deals_30d, 0) AS deals_30d,
       COALESCE(dp.ap_wtd, (0)::numeric) AS ap_wtd,
       COALESCE(dp.ap_mtd, (0)::numeric) AS ap_mtd,
       COALESCE(dp.ap_30d, (0)::numeric) AS ap_30d,
       COALESCE(dp.commission_lifetime_cents, 0) AS commission_lifetime_cents,
       COALESCE(dp.chargebacks, 0) AS chargebacks,
       COALESCE(dp.lapses, 0) AS lapses,
       COALESCE(prod.pres_today, 0) AS presentations_today,
       COALESCE(prod.pres_wtd, 0) AS presentations_wtd,
       COALESCE(prod.pres_mtd, 0) AS presentations_mtd,
       COALESCE(prod.hours_today, (0)::numeric) AS hours_called_today,
       COALESCE(prod.hours_wtd, (0)::numeric) AS hours_called_wtd,
       COALESCE(prod.hours_mtd, (0)::numeric) AS hours_called_mtd,
       prod.last_production_date,
       COALESCE(apps.apps_assigned, 0) AS apps_assigned,
       COALESCE(apps.apps_open, 0) AS apps_open,
       COALESCE(apps.apps_new_7d, 0) AS apps_new_7d,
       COALESCE(apps.apps_needing_contact, 0) AS apps_needing_contact,
       CASE
         WHEN (COALESCE(prod.pres_mtd, 0) > 0)
           THEN round((((COALESCE(dp.deals_mtd, 0))::numeric / (prod.pres_mtd)::numeric) * (100)::numeric), 1)
         ELSE NULL::numeric
       END AS close_rate_mtd_pct,
       CASE
         WHEN (COALESCE(dp.ap_30_60d, (0)::numeric) > (0)::numeric)
           THEN round((((COALESCE(dp.ap_30d, (0)::numeric) - dp.ap_30_60d) / dp.ap_30_60d) * (100)::numeric), 1)
         ELSE NULL::numeric
       END AS ap_trend_pct,
       ranks.rank_agency_mtd,
       ranks.rank_agency_wtd,
       team_ranks.rank_team_mtd,
       CASE
         WHEN (prod.last_production_date IS NULL) THEN 'never_dialed'::text
         WHEN (prod.last_production_date = CURRENT_DATE) THEN 'active_today'::text
         WHEN (prod.last_production_date >= (CURRENT_DATE - '2 days'::interval)) THEN 'active_recent'::text
         WHEN (prod.last_production_date >= (CURRENT_DATE - '7 days'::interval)) THEN 'slipping'::text
         ELSE 'inactive_warning'::text
       END AS activity_state,
       CASE
         WHEN (a.onboarding_stage = 'pre_licensed'::onboarding_stage) THEN 'Complete licensing course'::text
         WHEN (COALESCE(apps.apps_needing_contact, 0) > 0) THEN (('Contact '::text || apps.apps_needing_contact) || ' applicants'::text)
         WHEN ((COALESCE(prod.pres_today, 0) = 0) AND (a.status = 'active'::agent_status)) THEN 'Get on the phones'::text
         ELSE 'On track'::text
       END AS next_action
  FROM agents a
  LEFT JOIN profiles p ON (p.id = a.profile_id)
  LEFT JOIN agents mgr ON (mgr.id = a.manager_id)
  LEFT JOIN dp ON (dp.agent_id = a.id)
  LEFT JOIN prod ON (prod.agent_id = a.id)
  LEFT JOIN apps ON (apps.agent_id = a.id)
  LEFT JOIN ranks ON (ranks.agent_id = a.id)
  LEFT JOIN team_ranks ON (team_ranks.agent_id = a.id)
 WHERE (a.is_deactivated IS NOT TRUE)
   AND a.canonical_agent_id IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. v_ceo_command_center — agent_counts only count canonical agents;
--    producing_agents_30d counts DISTINCT canonical agents (work attached to a dup
--    is now attributed to its canonical row).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_ceo_command_center AS
WITH totals AS (
  SELECT (count(*) FILTER (WHERE ((deals.posted_at)::date = CURRENT_DATE)))::integer AS deals_today,
         (count(*) FILTER (WHERE (deals.posted_at >= date_trunc('week'::text, now()))))::integer AS deals_wtd,
         (count(*) FILTER (WHERE (deals.posted_at >= date_trunc('month'::text, now()))))::integer AS deals_mtd,
         (count(*) FILTER (WHERE (deals.posted_at >= (now() - '30 days'::interval))))::integer AS deals_30d,
         COALESCE(sum(deals.annual_premium) FILTER (WHERE (deals.posted_at >= date_trunc('week'::text, now()))), (0)::numeric) AS ap_wtd,
         COALESCE(sum(deals.annual_premium) FILTER (WHERE (deals.posted_at >= date_trunc('month'::text, now()))), (0)::numeric) AS ap_mtd,
         COALESCE(sum(deals.annual_premium) FILTER (WHERE (deals.posted_at >= (now() - '30 days'::interval))), (0)::numeric) AS ap_30d,
         COALESCE(sum(deals.annual_premium) FILTER (WHERE ((deals.posted_at >= (now() - '60 days'::interval)) AND (deals.posted_at < (now() - '30 days'::interval)))), (0)::numeric) AS ap_prev_30d,
         (SELECT (count(*))::integer FROM v_chargebacks_30d) AS chargebacks_30d,
         (count(*) FILTER (WHERE ((deals.status = 'lapsed'::text) AND (deals.status_updated_at >= (now() - '30 days'::interval)))))::integer AS lapses_30d
    FROM deals
), agent_counts AS (
  SELECT (count(*))::integer AS total_agents,
         (count(*) FILTER (WHERE (agents.status = 'active'::agent_status)))::integer AS active_agents,
         (count(*) FILTER (WHERE (agents.status = 'inactive'::agent_status)))::integer AS inactive_agents,
         (count(*) FILTER (WHERE (agents.license_status = 'licensed'::license_status)))::integer AS licensed_agents,
         (count(*) FILTER (WHERE (agents.license_status = 'unlicensed'::license_status)))::integer AS unlicensed_agents,
         (count(*) FILTER (WHERE (agents.onboarding_stage = ANY (ARRAY['onboarding'::onboarding_stage, 'training_online'::onboarding_stage, 'in_field_training'::onboarding_stage]))))::integer AS onboarding_agents,
         (count(DISTINCT COALESCE(cm.canonical_agent_id, d.agent_id))
            FILTER (WHERE d.agent_id IS NOT NULL))::integer AS producing_agents_30d
    FROM agents
    LEFT JOIN deals d ON (d.agent_id = agents.id AND d.posted_at >= (now() - '30 days'::interval))
    LEFT JOIN v_agent_canonical_map cm ON (cm.agent_id = d.agent_id)
   WHERE agents.is_deactivated IS NOT TRUE
     AND agents.canonical_agent_id IS NULL
), app_counts AS (
  SELECT (count(*))::integer AS total_applications,
         (count(*) FILTER (WHERE (applications.created_at >= CURRENT_DATE)))::integer AS apps_today,
         (count(*) FILTER (WHERE (applications.created_at >= date_trunc('week'::text, now()))))::integer AS apps_wtd,
         (count(*) FILTER (WHERE (applications.created_at >= date_trunc('month'::text, now()))))::integer AS apps_mtd,
         (count(*) FILTER (WHERE ((applications.ica_paid = true) AND (applications.ica_paid_at >= date_trunc('month'::text, now())))))::integer AS paid_mtd,
         (count(*) FILTER (WHERE (((applications.status)::text = ANY (ARRAY['new'::text, 'reviewing'::text])) AND (applications.created_at < (now() - '3 days'::interval)))))::integer AS stale_new_3d,
         (count(*) FILTER (WHERE ((applications.assigned_agent_id IS NULL) AND ((applications.status)::text <> ALL (ARRAY['approved'::text, 'rejected'::text])))))::integer AS unassigned_open,
         (count(*) FILTER (WHERE ((applications.last_contacted_at IS NULL) AND (applications.created_at < (now() - '24:00:00'::interval)) AND ((applications.status)::text <> ALL (ARRAY['approved'::text, 'rejected'::text])))))::integer AS uncontacted_24h
    FROM applications
), seminar_counts AS (
  SELECT (count(*))::integer AS sem_registrations_total,
         (count(*) FILTER (WHERE (seminar_registrations.seminar_date >= CURRENT_DATE)))::integer AS sem_upcoming,
         (count(*) FILTER (WHERE (seminar_registrations.attended = true)))::integer AS sem_attended,
         (count(*) FILTER (WHERE (seminar_registrations.paid_after = true)))::integer AS sem_paid_after
    FROM seminar_registrations
), referral_counts AS (
  SELECT (count(*))::integer AS ref_total,
         (count(*) FILTER (WHERE ((referrals.status)::text = 'submitted'::text)))::integer AS ref_open,
         (count(*) FILTER (WHERE (referrals.created_at >= (now() - '30 days'::interval))))::integer AS ref_30d,
         (count(*) FILTER (WHERE ((referrals.status)::text = ANY (ARRAY['contracted'::text, 'producing'::text]))))::integer AS ref_won
    FROM referrals
)
SELECT totals.deals_today,
       totals.deals_wtd,
       totals.deals_mtd,
       totals.deals_30d,
       totals.ap_wtd,
       totals.ap_mtd,
       totals.ap_30d,
       totals.ap_prev_30d,
       totals.chargebacks_30d,
       totals.lapses_30d,
       agent_counts.total_agents,
       agent_counts.active_agents,
       agent_counts.inactive_agents,
       agent_counts.licensed_agents,
       agent_counts.unlicensed_agents,
       agent_counts.onboarding_agents,
       agent_counts.producing_agents_30d,
       app_counts.total_applications,
       app_counts.apps_today,
       app_counts.apps_wtd,
       app_counts.apps_mtd,
       app_counts.paid_mtd,
       app_counts.stale_new_3d,
       app_counts.unassigned_open,
       app_counts.uncontacted_24h,
       seminar_counts.sem_registrations_total,
       seminar_counts.sem_upcoming,
       seminar_counts.sem_attended,
       seminar_counts.sem_paid_after,
       referral_counts.ref_total,
       referral_counts.ref_open,
       referral_counts.ref_30d,
       referral_counts.ref_won,
       '[]'::json AS top_producers_mtd,
       '[]'::json AS underperformers_30d,
       CASE
         WHEN (totals.ap_prev_30d > (0)::numeric)
           THEN round((((totals.ap_30d - totals.ap_prev_30d) / totals.ap_prev_30d) * (100)::numeric), 1)
         ELSE NULL::numeric
       END AS ap_trend_pct,
       now() AS as_of
  FROM totals,
       agent_counts,
       app_counts,
       seminar_counts,
       referral_counts;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. v_agent_with_downline_production — base filtered to canonical; deal join canonicalized.
--    v_team_hierarchy already canonicalized above so path/downline counts are clean.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_with_downline_production AS
WITH agent_prod AS (
  SELECT a.id AS agent_id,
         COALESCE(p.full_name, 'Unknown'::text) AS name,
         p.email,
         a.invited_by_manager_id,
         a.manager_id,
         a.status,
         a.license_status,
         (a.created_at)::date AS hired,
         (COALESCE(sum(d.annual_premium) FILTER (WHERE (d.created_at >= date_trunc('month'::text, now()))), (0)::numeric))::integer AS own_ap_mtd,
         count(d.id) FILTER (WHERE (d.created_at >= date_trunc('month'::text, now()))) AS own_deals_mtd
    FROM agents a
    LEFT JOIN profiles p ON (p.id = a.profile_id)
    LEFT JOIN deals d ON (d.agent_id IN (
            SELECT id FROM agents x
             WHERE COALESCE(x.canonical_agent_id, x.id) = a.id))
   WHERE a.canonical_agent_id IS NULL
   GROUP BY a.id, p.full_name, p.email, a.invited_by_manager_id, a.manager_id, a.status, a.license_status, a.created_at
)
SELECT agent_id,
       name,
       email,
       invited_by_manager_id,
       manager_id,
       status,
       license_status,
       hired,
       own_ap_mtd,
       own_deals_mtd,
       (SELECT count(*)
          FROM agents r
         WHERE r.canonical_agent_id IS NULL
           AND ((r.invited_by_manager_id = ap.agent_id) OR (r.manager_id = ap.agent_id))) AS direct_recruits,
       (SELECT count(DISTINCT t.id)
          FROM v_team_hierarchy t
         WHERE (ap.agent_id = ANY (t.path)) AND (t.id <> ap.agent_id)) AS downline_size,
       (SELECT (COALESCE(sum(d.annual_premium), (0)::numeric))::integer
          FROM v_team_hierarchy t
          LEFT JOIN deals d ON (d.agent_id IN (
                SELECT id FROM agents x
                 WHERE COALESCE(x.canonical_agent_id, x.id) = t.id))
         WHERE (ap.agent_id = ANY (t.path))
           AND (t.id <> ap.agent_id)
           AND (d.created_at >= date_trunc('month'::text, now()))) AS downline_ap_mtd,
       (own_ap_mtd + (SELECT (COALESCE(sum(d.annual_premium), (0)::numeric))::integer
          FROM v_team_hierarchy t
          LEFT JOIN deals d ON (d.agent_id IN (
                SELECT id FROM agents x
                 WHERE COALESCE(x.canonical_agent_id, x.id) = t.id))
         WHERE (ap.agent_id = ANY (t.path))
           AND (t.id <> ap.agent_id)
           AND (d.created_at >= date_trunc('month'::text, now())))) AS team_ap_mtd
  FROM agent_prod ap
 WHERE status = 'active'::agent_status;
