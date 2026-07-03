-- Rewrite all MTD/monthly dashboard views to use rolling 30-day window.
-- Sam feedback 2026-07-03: 'How am I at $100k plus in three days?'
-- Root cause: date_trunc('month', now()) returned first-of-current-month
-- collapsing 'Month' KPI to 3 days worth vs Week's 5 days. Now every
-- 'Month' stat is rolling 30 days so Month >= Week >= Today always.
--
-- Applied live via bot-sql at 2026-07-03T20:11 UTC. Verified: month=360,
-- top_producers_mtd=14, ceo_mtd=282 (all rolling 30d).


-- ============================================================
-- v_top_producers_mtd
-- ============================================================
CREATE OR REPLACE VIEW public.v_top_producers_mtd AS
 WITH book AS (
         SELECT s.user_id,
            (count(*))::integer AS deals_mtd,
            COALESCE(sum(s.annual_premium), (0)::numeric) AS alp_mtd
           FROM agentlink_deals_snapshot s
          WHERE (s.effective_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Chicago'::text)))
          GROUP BY s.user_id
        ), agent_match AS (
         SELECT b.user_id,
            b.deals_mtd,
            b.alp_mtd,
            a_1.id AS raw_agent_id
           FROM (book b
             JOIN agents a_1 ON ((a_1.al_user_id = b.user_id)))
        ), canon AS (
         SELECT m.canonical_agent_id AS agent_id,
            (sum(am.deals_mtd))::integer AS deals_mtd,
            sum(am.alp_mtd) AS alp_mtd
           FROM (agent_match am
             JOIN v_agent_canonical_map m ON ((m.agent_id = am.raw_agent_id)))
          GROUP BY m.canonical_agent_id
        )
 SELECT c.agent_id,
    a.display_name,
    c.deals_mtd,
    c.alp_mtd,
    COALESCE(mgr.display_name, '(direct to Sam)'::text) AS manager_name
   FROM ((canon c
     JOIN agents a ON ((a.id = c.agent_id)))
     LEFT JOIN agents mgr ON ((mgr.id = a.invited_by_manager_id)))
  WHERE ((COALESCE(a.is_inactive, false) = false) AND (COALESCE(a.is_deactivated, false) = false) AND (c.deals_mtd > 0))
  ORDER BY c.alp_mtd DESC
 LIMIT 20;;

-- ============================================================
-- v_manager_hierarchy_mtd
-- ============================================================
CREATE OR REPLACE VIEW public.v_manager_hierarchy_mtd AS
 WITH canonical_agents AS (
         SELECT a.id,
            a.invited_by_manager_id
           FROM agents a
          WHERE ((a.canonical_agent_id IS NULL) AND (COALESCE(a.is_inactive, false) = false) AND (COALESCE(a.is_deactivated, false) = false))
        ), deals_canon AS (
         SELECT COALESCE(m.canonical_agent_id, d.agent_id) AS canon_agent_id,
            d.id,
            d.annual_premium
           FROM (deals d
             LEFT JOIN v_agent_canonical_map m ON ((m.agent_id = d.agent_id)))
          WHERE ((d.posted_at > ((now() - INTERVAL '30 days'))) AND (d.status <> ALL (ARRAY['rejected'::text, 'cancelled'::text])))
        )
 SELECT COALESCE(mgr.id, '00000000-0000-0000-0000-000000000000'::uuid) AS manager_id,
    COALESCE(mgr.display_name, '(direct to Sam)'::text) AS manager_name,
    count(DISTINCT ca.id) AS team_size,
    COALESCE(sum(dc.annual_premium), (0)::numeric) AS team_alp_mtd,
    count(dc.id) AS team_deals_mtd,
    count(DISTINCT dc.canon_agent_id) AS producing_team_mtd
   FROM ((canonical_agents ca
     LEFT JOIN agents mgr ON ((mgr.id = ca.invited_by_manager_id)))
     LEFT JOIN deals_canon dc ON ((dc.canon_agent_id = ca.id)))
  GROUP BY mgr.id, mgr.display_name
 HAVING (count(DISTINCT ca.id) > 0)
  ORDER BY COALESCE(sum(dc.annual_premium), (0)::numeric) DESC;;

-- ============================================================
-- v_ceo_command_center
-- ============================================================
CREATE OR REPLACE VIEW public.v_ceo_command_center AS
 WITH totals AS (
         SELECT (count(*) FILTER (WHERE ((deals.posted_at)::date = CURRENT_DATE)))::integer AS deals_today,
            (count(*) FILTER (WHERE (deals.posted_at >= date_trunc('week'::text, now()))))::integer AS deals_wtd,
            (count(*) FILTER (WHERE (deals.posted_at >= ((now() - INTERVAL '30 days')))))::integer AS deals_mtd,
            (count(*) FILTER (WHERE (deals.posted_at >= (now() - '30 days'::interval))))::integer AS deals_30d,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE (deals.posted_at >= date_trunc('week'::text, now()))), (0)::numeric) AS ap_wtd,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE (deals.posted_at >= ((now() - INTERVAL '30 days')))), (0)::numeric) AS ap_mtd,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE (deals.posted_at >= (now() - '30 days'::interval))), (0)::numeric) AS ap_30d,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE ((deals.posted_at >= (now() - '60 days'::interval)) AND (deals.posted_at < (now() - '30 days'::interval)))), (0)::numeric) AS ap_prev_30d,
            ( SELECT (count(*))::integer AS count
                   FROM v_chargebacks_30d) AS chargebacks_30d,
            (count(*) FILTER (WHERE ((deals.status = 'lapsed'::text) AND (deals.status_updated_at >= (now() - '30 days'::interval)))))::integer AS lapses_30d
           FROM deals
        ), agent_counts AS (
         SELECT (count(*))::integer AS total_agents,
            (count(*) FILTER (WHERE (agents.status = 'active'::agent_status)))::integer AS active_agents,
            (count(*) FILTER (WHERE (agents.status = 'inactive'::agent_status)))::integer AS inactive_agents,
            (count(*) FILTER (WHERE (agents.license_status = 'licensed'::license_status)))::integer AS licensed_agents,
            (count(*) FILTER (WHERE (agents.license_status = 'unlicensed'::license_status)))::integer AS unlicensed_agents,
            (count(*) FILTER (WHERE (agents.onboarding_stage = ANY (ARRAY['onboarding'::onboarding_stage, 'training_online'::onboarding_stage, 'in_field_training'::onboarding_stage]))))::integer AS onboarding_agents,
            ( SELECT (count(DISTINCT COALESCE(cm.canonical_agent_id, d.agent_id)))::integer AS count
                   FROM (deals d
                     LEFT JOIN v_agent_canonical_map cm ON ((cm.agent_id = d.agent_id)))
                  WHERE (d.posted_at >= (now() - '30 days'::interval))) AS producing_agents_30d
           FROM agents
          WHERE ((agents.is_deactivated IS NOT TRUE) AND (agents.canonical_agent_id IS NULL))
        ), app_counts AS (
         SELECT (count(*))::integer AS total_applications,
            (count(*) FILTER (WHERE (applications.created_at >= CURRENT_DATE)))::integer AS apps_today,
            (count(*) FILTER (WHERE (applications.created_at >= date_trunc('week'::text, now()))))::integer AS apps_wtd,
            (count(*) FILTER (WHERE (applications.created_at >= ((now() - INTERVAL '30 days')))))::integer AS apps_mtd,
            (count(*) FILTER (WHERE ((applications.ica_paid = true) AND (applications.ica_paid_at >= ((now() - INTERVAL '30 days'))))))::integer AS paid_mtd,
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
            WHEN (totals.ap_prev_30d > (0)::numeric) THEN round((((totals.ap_30d - totals.ap_prev_30d) / totals.ap_prev_30d) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS ap_trend_pct,
    now() AS as_of
   FROM totals,
    agent_counts,
    app_counts,
    seminar_counts,
    referral_counts;;

-- ============================================================
-- v_agent_command_center
-- ============================================================
CREATE OR REPLACE VIEW public.v_agent_command_center AS
 WITH dp AS (
         SELECT COALESCE(cm.canonical_agent_id, a_1.id) AS agent_id,
            (sum(
                CASE
                    WHEN ((d.posted_at)::date = CURRENT_DATE) THEN 1
                    ELSE 0
                END))::integer AS deals_today,
            (sum(
                CASE
                    WHEN (d.posted_at >= date_trunc('week'::text, now())) THEN 1
                    ELSE 0
                END))::integer AS deals_wtd,
            (sum(
                CASE
                    WHEN (d.posted_at >= ((now() - INTERVAL '30 days'))) THEN 1
                    ELSE 0
                END))::integer AS deals_mtd,
            (sum(
                CASE
                    WHEN (d.posted_at >= (now() - '30 days'::interval)) THEN 1
                    ELSE 0
                END))::integer AS deals_30d,
            (sum(
                CASE
                    WHEN ((d.posted_at >= (now() - '60 days'::interval)) AND (d.posted_at < (now() - '30 days'::interval))) THEN 1
                    ELSE 0
                END))::integer AS deals_30_60d,
            COALESCE(sum(d.annual_premium) FILTER (WHERE (d.posted_at >= date_trunc('week'::text, now()))), (0)::numeric) AS ap_wtd,
            COALESCE(sum(d.annual_premium) FILTER (WHERE (d.posted_at >= ((now() - INTERVAL '30 days')))), (0)::numeric) AS ap_mtd,
            COALESCE(sum(d.annual_premium) FILTER (WHERE (d.posted_at >= (now() - '30 days'::interval))), (0)::numeric) AS ap_30d,
            COALESCE(sum(d.annual_premium) FILTER (WHERE ((d.posted_at >= (now() - '60 days'::interval)) AND (d.posted_at < (now() - '30 days'::interval)))), (0)::numeric) AS ap_30_60d,
            (COALESCE(sum(d.commission_cents), (0)::bigint))::integer AS commission_lifetime_cents,
            (sum(
                CASE
                    WHEN (d.chargeback_status = ANY (ARRAY['chargeback'::text, 'charged_back'::text])) THEN 1
                    ELSE 0
                END))::integer AS chargebacks,
            (sum(
                CASE
                    WHEN (d.status = 'lapsed'::text) THEN 1
                    ELSE 0
                END))::integer AS lapses
           FROM ((agents a_1
             LEFT JOIN v_agent_canonical_map cm ON ((cm.agent_id = a_1.id)))
             LEFT JOIN deals d ON ((d.agent_id = a_1.id)))
          GROUP BY COALESCE(cm.canonical_agent_id, a_1.id)
        ), prod AS (
         SELECT COALESCE(cm.canonical_agent_id, dpr.agent_id) AS agent_id,
            (sum(
                CASE
                    WHEN (dpr.production_date = CURRENT_DATE) THEN dpr.presentations
                    ELSE 0
                END))::integer AS pres_today,
            (sum(
                CASE
                    WHEN (dpr.production_date >= (date_trunc('week'::text, now()))::date) THEN dpr.presentations
                    ELSE 0
                END))::integer AS pres_wtd,
            (sum(
                CASE
                    WHEN (dpr.production_date >= (((now() - INTERVAL '30 days')))::date) THEN dpr.presentations
                    ELSE 0
                END))::integer AS pres_mtd,
            sum(
                CASE
                    WHEN (dpr.production_date = CURRENT_DATE) THEN dpr.hours_called
                    ELSE (0)::numeric
                END) AS hours_today,
            sum(
                CASE
                    WHEN (dpr.production_date >= (date_trunc('week'::text, now()))::date) THEN dpr.hours_called
                    ELSE (0)::numeric
                END) AS hours_wtd,
            sum(
                CASE
                    WHEN (dpr.production_date >= (((now() - INTERVAL '30 days')))::date) THEN dpr.hours_called
                    ELSE (0)::numeric
                END) AS hours_mtd,
            max(dpr.production_date) AS last_production_date,
            (sum(
                CASE
                    WHEN (dpr.production_date >= (CURRENT_DATE - '14 days'::interval)) THEN dpr.deals_closed
                    ELSE 0
                END))::integer AS deals_closed_14d
           FROM (daily_production dpr
             LEFT JOIN v_agent_canonical_map cm ON ((cm.agent_id = dpr.agent_id)))
          GROUP BY COALESCE(cm.canonical_agent_id, dpr.agent_id)
        ), apps AS (
         SELECT COALESCE(cm.canonical_agent_id, applications.assigned_agent_id) AS agent_id,
            (count(*))::integer AS apps_assigned,
            (count(*) FILTER (WHERE ((applications.status <> ALL (ARRAY['approved'::application_status, 'rejected'::application_status])) AND (applications.terminated_at IS NULL))))::integer AS apps_open,
            (count(*) FILTER (WHERE (applications.created_at >= (now() - '7 days'::interval))))::integer AS apps_new_7d,
            (count(*) FILTER (WHERE ((applications.last_contacted_at IS NULL) OR (applications.last_contacted_at < (now() - '24:00:00'::interval)))))::integer AS apps_needing_contact
           FROM (applications
             LEFT JOIN v_agent_canonical_map cm ON ((cm.agent_id = applications.assigned_agent_id)))
          WHERE (applications.assigned_agent_id IS NOT NULL)
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
           FROM (agents a_1
             LEFT JOIN dp dp_1 ON ((dp_1.agent_id = a_1.id)))
          WHERE (a_1.canonical_agent_id IS NULL)
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
            WHEN (COALESCE(prod.pres_mtd, 0) > 0) THEN round((((COALESCE(dp.deals_mtd, 0))::numeric / (prod.pres_mtd)::numeric) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS close_rate_mtd_pct,
        CASE
            WHEN (COALESCE(dp.ap_30_60d, (0)::numeric) > (0)::numeric) THEN round((((COALESCE(dp.ap_30d, (0)::numeric) - dp.ap_30_60d) / dp.ap_30_60d) * (100)::numeric), 1)
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
   FROM (((((((agents a
     LEFT JOIN profiles p ON ((p.id = a.profile_id)))
     LEFT JOIN agents mgr ON ((mgr.id = a.manager_id)))
     LEFT JOIN dp ON ((dp.agent_id = a.id)))
     LEFT JOIN prod ON ((prod.agent_id = a.id)))
     LEFT JOIN apps ON ((apps.agent_id = a.id)))
     LEFT JOIN ranks ON ((ranks.agent_id = a.id)))
     LEFT JOIN team_ranks ON ((team_ranks.agent_id = a.id)))
  WHERE ((a.is_deactivated IS NOT TRUE) AND (a.canonical_agent_id IS NULL));;

-- ============================================================
-- v_builder_operating_dashboard
-- ============================================================
CREATE OR REPLACE VIEW public.v_builder_operating_dashboard AS
 WITH RECURSIVE live_agents AS (
         SELECT agents.id,
            agents.user_id,
            agents.profile_id,
            agents.manager_id,
            agents.agent_code,
            agents.license_status,
            agents.license_states,
            agents.nipr_number,
            agents.status,
            agents.start_date,
            agents.total_policies,
            agents.total_premium,
            agents.total_earnings,
            agents.created_at,
            agents.updated_at,
            agents.verified_at,
            agents.verified_by,
            agents.invited_by_manager_id,
            agents.attendance_status,
            agents.performance_tier,
            agents.field_training_started_at,
            agents.has_training_course,
            agents.has_dialer_login,
            agents.has_discord_access,
            agents.potential_rating,
            agents.evaluation_result,
            agents.evaluated_at,
            agents.evaluated_by,
            agents.is_deactivated,
            agents.crm_setup_link,
            agents.weekly_10k_badges,
            agents.deactivation_reason,
            agents.switched_to_manager_id,
            agents.sort_order,
            agents.portal_password_set,
            agents.is_inactive,
            agents.password_required,
            agents.display_name,
            agents.has_production_access,
            agents.production_unlocked_at,
            agents.max_recruits,
            agents.ref_slug,
            agents.insuracloud_api_token,
            agents.onboarding_stage,
            agents.contract_percentage,
            agents.override_rate,
            agents.insuracloud_user_id,
            agents.is_presenting,
            agents.stage_changed_at,
            agents.contracted_at,
            agents.metadata,
            agents.onboarding_completed_at,
            agents.first_appointment_at,
            agents.first_appointment_set_by,
            agents.first_deal_at,
            agents.first_10k_at,
            agents.telegram_chat_id,
            agents.telegram_opt_out,
            agents.next_step_stage_key,
            agents.next_step_due_at,
            agents.canonical_agent_id,
            agents.builder_track,
            agents.agency_owner_qualified_at
           FROM agents
          WHERE ((COALESCE(agents.is_deactivated, false) = false) AND (agents.canonical_agent_id IS NULL))
        ), hierarchy AS (
         SELECT a.id AS root_agent_id,
            a.id AS agent_id,
            0 AS depth,
            ARRAY[a.id] AS path
           FROM live_agents a
        UNION ALL
         SELECT h.root_agent_id,
            child.id AS agent_id,
            (h.depth + 1) AS depth,
            (h.path || child.id) AS path
           FROM (hierarchy h
             JOIN live_agents child ON (((child.invited_by_manager_id = h.agent_id) OR (child.manager_id = h.agent_id))))
          WHERE ((child.id <> ALL (h.path)) AND (h.depth < 8))
        ), agent_rollup AS (
         SELECT h.root_agent_id,
            (count(*) FILTER (WHERE (h.depth = 1)))::integer AS direct_agent_count,
            (count(*) FILTER (WHERE (h.depth > 0)))::integer AS total_downline_count,
            (count(*) FILTER (WHERE ((h.depth > 0) AND (child.status = 'active'::agent_status) AND (COALESCE(child.is_inactive, false) = false))))::integer AS active_agent_count,
            (count(*) FILTER (WHERE ((h.depth > 0) AND (child.license_status = 'licensed'::license_status))))::integer AS licensed_agent_count,
            (count(*) FILTER (WHERE ((h.depth > 0) AND (child.license_status <> 'licensed'::license_status))))::integer AS unlicensed_agent_count,
            (count(*) FILTER (WHERE ((h.depth > 0) AND (child.created_at >= ((now() - INTERVAL '30 days'))))))::integer AS hires_this_month,
            max(child.updated_at) FILTER (WHERE (h.depth > 0)) AS last_agent_activity_at
           FROM (hierarchy h
             LEFT JOIN live_agents child ON ((child.id = h.agent_id)))
          GROUP BY h.root_agent_id
        ), application_links AS (
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON ((m.canonical_agent_id = h.agent_id)))
             JOIN applications app ON ((app.referrer_agent_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON ((m.canonical_agent_id = h.agent_id)))
             JOIN applications app ON ((app.referral_manager_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON ((m.canonical_agent_id = h.agent_id)))
             JOIN applications app ON ((app.recruiter_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON ((m.canonical_agent_id = h.agent_id)))
             JOIN applications app ON ((app.assigned_agent_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        ), application_rollup AS (
         SELECT al.root_agent_id,
            (count(DISTINCT app.id))::integer AS applicant_count,
            (count(DISTINCT app.id) FILTER (WHERE ((app.license_status = 'licensed'::license_status) OR (app.license_progress = 'licensed'::license_progress) OR (app.licensed_at IS NOT NULL) OR (app.license_approved_at IS NOT NULL))))::integer AS licensed_recruits,
            (count(DISTINCT app.id) FILTER (WHERE (((app.status)::text <> ALL (ARRAY['rejected'::text, 'disqualified'::text, 'lapsed'::text])) AND (NOT ((app.license_status = 'licensed'::license_status) OR (app.license_progress = 'licensed'::license_progress) OR (app.licensed_at IS NOT NULL) OR (app.license_approved_at IS NOT NULL))))))::integer AS unlicensed_recruits,
            (count(DISTINCT app.id) FILTER (WHERE (app.license_progress = ANY (ARRAY['finished_course'::license_progress, 'test_scheduled'::license_progress, 'passed_test'::license_progress, 'exam_passed'::license_progress, 'fingerprints_done'::license_progress, 'waiting_fingerprints'::license_progress, 'waiting_on_license'::license_progress, 'licensed'::license_progress, 'in_field_training'::license_progress]))))::integer AS coursework_completed_count,
            (count(DISTINCT app.id) FILTER (WHERE (((app.status)::text = ANY (ARRAY['paid'::text, 'onboarding'::text, 'producing'::text])) OR (COALESCE(app.ica_paid, false) = true) OR (app.ica_paid_at IS NOT NULL) OR (app.contracted_at IS NOT NULL) OR (app.first_deal_at IS NOT NULL))))::integer AS activation_count,
            (count(DISTINCT app.id) FILTER (WHERE (((app.status)::text <> ALL (ARRAY['rejected'::text, 'disqualified'::text, 'lapsed'::text])) AND ((COALESCE(app.is_ghosted, false) = true) OR (app.next_action_due_at < now()) OR (app.next_step_due_at < now()) OR ((app.license_status = 'unlicensed'::license_status) AND (app.created_at < (now() - '7 days'::interval)) AND (app.course_purchased_at IS NULL) AND (app.course_started_at IS NULL)) OR ((app.license_progress = ANY (ARRAY['unlicensed'::license_progress, 'course_purchased'::license_progress])) AND (app.updated_at < (now() - '10 days'::interval)))))))::integer AS stuck_applicants,
            (count(DISTINCT app.id) FILTER (WHERE (app.created_at >= ((now() - INTERVAL '30 days')))))::integer AS applicants_this_month,
            max(app.updated_at) AS last_application_activity_at
           FROM (application_links al
             JOIN applications app ON ((app.id = al.application_id)))
          GROUP BY al.root_agent_id
        ), personal_referral_rollup AS (
         SELECT a.id AS root_agent_id,
            (count(DISTINCT app.id))::integer AS applicants_from_referral_link,
            (count(DISTINCT app.id) FILTER (WHERE ((app.license_status = 'licensed'::license_status) OR (app.license_progress = 'licensed'::license_progress) OR (app.licensed_at IS NOT NULL) OR (app.license_approved_at IS NOT NULL))))::integer AS licensed_from_referral_link,
            (count(DISTINCT app.id) FILTER (WHERE (((app.status)::text = ANY (ARRAY['paid'::text, 'onboarding'::text, 'producing'::text])) OR (COALESCE(app.ica_paid, false) = true) OR (app.ica_paid_at IS NOT NULL) OR (app.contracted_at IS NOT NULL) OR (app.first_deal_at IS NOT NULL))))::integer AS activated_from_referral_link
           FROM ((live_agents a
             LEFT JOIN v_agent_canonical_map m ON ((m.canonical_agent_id = a.id)))
             LEFT JOIN applications app ON ((((app.referrer_agent_id = m.agent_id) OR (app.referral_manager_id = m.agent_id) OR (app.recruiter_id = m.agent_id)) AND (COALESCE(app.is_duplicate, false) = false))))
          GROUP BY a.id
        ), production_rollup AS (
         SELECT h.root_agent_id,
            (count(dp.id) FILTER (WHERE (dp.production_date >= (((now() - INTERVAL '30 days')))::date)))::integer AS current_production_rows,
            COALESCE(sum(dp.aop) FILTER (WHERE (dp.production_date >= (((now() - INTERVAL '30 days')))::date)), (0)::numeric) AS current_month_aop,
            COALESCE(sum(dp.aop) FILTER (WHERE ((dp.production_date >= ((((now() - INTERVAL '30 days')) - '1 mon'::interval))::date) AND (dp.production_date < (((now() - INTERVAL '30 days')))::date))), (0)::numeric) AS previous_month_aop,
            max(dp.production_date) AS last_production_date
           FROM ((hierarchy h
             LEFT JOIN v_agent_canonical_map mdp ON ((mdp.canonical_agent_id = h.agent_id)))
             LEFT JOIN daily_production dp ON ((dp.agent_id = mdp.agent_id)))
          GROUP BY h.root_agent_id
        ), scored AS (
         SELECT a.id AS agent_id,
            COALESCE(p.full_name, a.display_name, p.email, 'Unknown'::text) AS builder_name,
            p.email,
            p.phone,
            p.state,
            a.user_id,
            a.profile_id,
            a.manager_id,
            COALESCE(a.invited_by_manager_id, a.manager_id) AS upline_id,
            a.invited_by_manager_id,
            a.builder_track,
            a.agency_owner_qualified_at,
            a.ref_slug,
            a.license_status,
            a.status,
            a.onboarding_stage,
            a.created_at,
            a.updated_at,
            COALESCE(ar.direct_agent_count, 0) AS direct_agent_count,
            COALESCE(ar.total_downline_count, 0) AS total_downline_count,
            COALESCE(ar.active_agent_count, 0) AS active_agent_count,
            COALESCE(ar.licensed_agent_count, 0) AS licensed_agent_count,
            COALESCE(ar.unlicensed_agent_count, 0) AS unlicensed_agent_count,
            COALESCE(ar.hires_this_month, 0) AS hires_this_month,
            COALESCE(ap.applicant_count, 0) AS applicant_count,
            COALESCE(ap.licensed_recruits, 0) AS licensed_recruits,
            COALESCE(ap.unlicensed_recruits, 0) AS unlicensed_recruits,
            COALESCE(ap.coursework_completed_count, 0) AS coursework_completed_count,
            COALESCE(ap.activation_count, 0) AS activation_count,
            COALESCE(ap.stuck_applicants, 0) AS stuck_applicants,
            COALESCE(ap.applicants_this_month, 0) AS applicants_this_month,
            COALESCE(pr.applicants_from_referral_link, 0) AS applicants_from_referral_link,
            COALESCE(pr.licensed_from_referral_link, 0) AS licensed_from_referral_link,
            COALESCE(pr.activated_from_referral_link, 0) AS activated_from_referral_link,
                CASE
                    WHEN (pr.applicants_from_referral_link > 0) THEN round((((pr.activated_from_referral_link)::numeric / (pr.applicants_from_referral_link)::numeric) * (100)::numeric), 1)
                    ELSE NULL::numeric
                END AS referral_conversion_rate,
                CASE
                    WHEN (ap.applicant_count > 0) THEN round((((ap.coursework_completed_count)::numeric / (ap.applicant_count)::numeric) * (100)::numeric), 1)
                    ELSE NULL::numeric
                END AS coursework_completion_rate,
                CASE
                    WHEN (ap.applicant_count > 0) THEN round((((ap.activation_count)::numeric / (ap.applicant_count)::numeric) * (100)::numeric), 1)
                    ELSE NULL::numeric
                END AS activation_rate,
                CASE
                    WHEN (prod.current_production_rows > 0) THEN prod.current_month_aop
                    ELSE NULL::numeric
                END AS monthly_production,
            (prod.current_production_rows > 0) AS monthly_production_available,
                CASE
                    WHEN ((prod.current_production_rows > 0) AND (prod.previous_month_aop > (0)::numeric)) THEN round((((prod.current_month_aop - prod.previous_month_aop) / prod.previous_month_aop) * (100)::numeric), 1)
                    ELSE NULL::numeric
                END AS growth_rate,
            prod.last_production_date,
            NULLIF(GREATEST(COALESCE(a.updated_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(ar.last_agent_activity_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(ap.last_application_activity_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE((prod.last_production_date)::timestamp with time zone, '1970-01-01 00:00:00+00'::timestamp with time zone)), '1970-01-01 00:00:00+00'::timestamp with time zone) AS last_activity_at,
            COALESCE(a.ref_slug, (a.id)::text) AS referral_code,
            ('https://apex-financial.org/apply?ref='::text || COALESCE(a.ref_slug, (a.id)::text)) AS referral_link,
            (('https://apex-financial.org/apply?ref='::text || COALESCE(a.ref_slug, (a.id)::text)) || '&utm_source=builder_referral&utm_medium=link&utm_campaign=recruiting'::text) AS application_link,
            ((COALESCE(ar.active_agent_count, 0) >= 10) AND (COALESCE(ar.total_downline_count, 0) >= 10)) AS qualifies_agency_owner
           FROM (((((live_agents a
             LEFT JOIN profiles p ON ((p.id = a.profile_id)))
             LEFT JOIN agent_rollup ar ON ((ar.root_agent_id = a.id)))
             LEFT JOIN application_rollup ap ON ((ap.root_agent_id = a.id)))
             LEFT JOIN personal_referral_rollup pr ON ((pr.root_agent_id = a.id)))
             LEFT JOIN production_rollup prod ON ((prod.root_agent_id = a.id)))
        )
 SELECT agent_id,
    builder_name,
    email,
    phone,
    state,
    user_id,
    profile_id,
    manager_id,
    upline_id,
    invited_by_manager_id,
    builder_track,
    agency_owner_qualified_at,
    ref_slug,
    license_status,
    status,
    onboarding_stage,
    created_at,
    updated_at,
    direct_agent_count,
    total_downline_count,
    active_agent_count,
    licensed_agent_count,
    unlicensed_agent_count,
    hires_this_month,
    applicant_count,
    licensed_recruits,
    unlicensed_recruits,
    coursework_completed_count,
    activation_count,
    stuck_applicants,
    applicants_this_month,
    applicants_from_referral_link,
    licensed_from_referral_link,
    activated_from_referral_link,
    referral_conversion_rate,
    coursework_completion_rate,
    activation_rate,
    monthly_production,
    monthly_production_available,
    growth_rate,
    last_production_date,
    last_activity_at,
    referral_code,
    referral_link,
    application_link,
    qualifies_agency_owner,
        CASE
            WHEN qualifies_agency_owner THEN 'Agency Owner'::text
            WHEN (builder_track = 'agency_owner_track'::text) THEN 'Agency Owner Track - Not Qualified Yet'::text
            WHEN ((builder_track = 'manager_track'::text) OR (direct_agent_count > 0) OR (total_downline_count > 0) OR (applicant_count > 0)) THEN 'Manager'::text
            ELSE 'Agent'::text
        END AS earned_title,
        CASE
            WHEN ((builder_track <> 'agent'::text) OR (direct_agent_count > 0) OR (total_downline_count > 0) OR (applicant_count > 0)) THEN true
            ELSE false
        END AS is_builder,
        CASE
            WHEN (monthly_production IS NULL) THEN NULL::boolean
            ELSE (monthly_production >= (100000)::numeric)
        END AS above_100k_monthly,
        CASE
            WHEN (stuck_applicants > 0) THEN 'Call stuck recruits'::text
            WHEN ((builder_track = 'agency_owner_track'::text) AND (NOT qualifies_agency_owner)) THEN (('Push to '::text || (GREATEST((10 - active_agent_count), 0))::text) || ' more active agents'::text)
            WHEN (unlicensed_recruits > licensed_recruits) THEN 'Push licensing'::text
            WHEN ((last_activity_at IS NULL) OR (last_activity_at < (now() - '14 days'::interval))) THEN 'Re-engage builder'::text
            WHEN ((hires_this_month = 0) AND (active_agent_count > 0)) THEN 'Ask for next hire'::text
            ELSE 'Support growth'::text
        END AS action_needed
   FROM scored s;;
