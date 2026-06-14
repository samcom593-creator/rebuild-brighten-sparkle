-- wave-98: canonicalize 4 more agent-aggregating views via v_agent_canonical_map
-- (1) v_builder_operating_dashboard  — Sam's recursive builder operating dashboard (16,620c monster)
--                                     pre-wave-98: 101 rows including 3 dup-agent rows (SJAMES02/JWANTROB01/JDIGNAN02)
--                                     appearing as separate builders with split-attribution downline counts
-- (2) v_manager_command_center       — manager-level command center; mgr_a join must filter to canonical managers
-- (3) v_recent_hires                 — public landing-page hires ticker (1 dup row currently appearing)
-- (4) v_recruiting_inbox             — admin recruiting inbox; owner_agent_id canonicalized so dup-routed
--                                     application assignments display the canonical owner
--
-- Same SWEEP-FOR-SAME-PATTERN as waves 93-97: every agent FK column resolved through
-- v_agent_canonical_map so work attached to a dup row rolls up to the canonical row.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. v_builder_operating_dashboard
--    Pre-wave-98: live_agents CTE contained all 3 dup agents (any live row, regardless of canonical_agent_id).
--    Hierarchy + rollups split downline credit between the dup and the canonical builder row.
--    Fix:
--      - live_agents filtered to canonical-only (canonical_agent_id IS NULL)
--      - application_links join applications via canonicalized FK columns through v_agent_canonical_map
--        so any application whose recruiter_id/referrer_agent_id/referral_manager_id/assigned_agent_id
--        points at a dup row attributes to the canonical builder
--      - personal_referral_rollup canonicalizes applicant-FK joins (same)
--      - production_rollup canonicalizes daily_production.agent_id (same)
-- ──────────────────────────────────────────────────────────────────────────────
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
          WHERE (COALESCE(agents.is_deactivated, false) = false)
            AND (agents.canonical_agent_id IS NULL)              -- wave-98: canonical-only base set
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
            (count(*) FILTER (WHERE ((h.depth > 0) AND (child.created_at >= date_trunc('month'::text, now())))))::integer AS hires_this_month,
            max(child.updated_at) FILTER (WHERE (h.depth > 0)) AS last_agent_activity_at
           FROM (hierarchy h
             LEFT JOIN live_agents child ON ((child.id = h.agent_id)))
          GROUP BY h.root_agent_id
        ), application_links AS (
         -- wave-98: canonicalize all 4 application→agent FK columns via v_agent_canonical_map
         -- so applications routed to a dup agent attribute to the canonical builder
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON (m.canonical_agent_id = h.agent_id))
             JOIN applications app ON ((app.referrer_agent_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON (m.canonical_agent_id = h.agent_id))
             JOIN applications app ON ((app.referral_manager_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON (m.canonical_agent_id = h.agent_id))
             JOIN applications app ON ((app.recruiter_id = m.agent_id)))
          WHERE (COALESCE(app.is_duplicate, false) = false)
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM ((hierarchy h
             JOIN v_agent_canonical_map m ON (m.canonical_agent_id = h.agent_id))
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
            (count(DISTINCT app.id) FILTER (WHERE (app.created_at >= date_trunc('month'::text, now()))))::integer AS applicants_this_month,
            max(app.updated_at) AS last_application_activity_at
           FROM (application_links al
             JOIN applications app ON ((app.id = al.application_id)))
          GROUP BY al.root_agent_id
        ), personal_referral_rollup AS (
         -- wave-98: canonicalize the per-builder personal-referral rollup the same way
         SELECT a.id AS root_agent_id,
            (count(DISTINCT app.id))::integer AS applicants_from_referral_link,
            (count(DISTINCT app.id) FILTER (WHERE ((app.license_status = 'licensed'::license_status) OR (app.license_progress = 'licensed'::license_progress) OR (app.licensed_at IS NOT NULL) OR (app.license_approved_at IS NOT NULL))))::integer AS licensed_from_referral_link,
            (count(DISTINCT app.id) FILTER (WHERE (((app.status)::text = ANY (ARRAY['paid'::text, 'onboarding'::text, 'producing'::text])) OR (COALESCE(app.ica_paid, false) = true) OR (app.ica_paid_at IS NOT NULL) OR (app.contracted_at IS NOT NULL) OR (app.first_deal_at IS NOT NULL))))::integer AS activated_from_referral_link
           FROM ((live_agents a
             LEFT JOIN v_agent_canonical_map m ON (m.canonical_agent_id = a.id))
             LEFT JOIN applications app ON ((((app.referrer_agent_id = m.agent_id) OR (app.referral_manager_id = m.agent_id) OR (app.recruiter_id = m.agent_id)) AND (COALESCE(app.is_duplicate, false) = false))))
          GROUP BY a.id
        ), production_rollup AS (
         -- wave-98: canonicalize daily_production.agent_id so dup-routed deals roll up
         SELECT h.root_agent_id,
            (count(dp.id) FILTER (WHERE (dp.production_date >= (date_trunc('month'::text, now()))::date)))::integer AS current_production_rows,
            COALESCE(sum(dp.aop) FILTER (WHERE (dp.production_date >= (date_trunc('month'::text, now()))::date)), (0)::numeric) AS current_month_aop,
            COALESCE(sum(dp.aop) FILTER (WHERE ((dp.production_date >= ((date_trunc('month'::text, now()) - '1 mon'::interval))::date) AND (dp.production_date < (date_trunc('month'::text, now()))::date))), (0)::numeric) AS previous_month_aop,
            max(dp.production_date) AS last_production_date
           FROM ((hierarchy h
             LEFT JOIN v_agent_canonical_map mdp ON (mdp.canonical_agent_id = h.agent_id))
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
   FROM scored s;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. v_manager_command_center
--    Pre-wave-98: joined agents to v_agent_command_center on acc.manager_id = mgr_a.id with
--    no canonical filter on mgr_a. v_agent_command_center is already canonicalized (wave-96)
--    so acc rows are canonical, but mgr_a could still be a dup agent listed as a manager.
--    Fix: filter mgr_a to canonical-only via v_agent_canonical_map.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_manager_command_center AS
 SELECT mgr_a.id AS manager_agent_id,
    mgr_a.user_id AS manager_user_id,
    mgr_a.display_name AS manager_name,
    acc.agent_id,
    acc.display_name AS agent_name,
    acc.agent_code,
    acc.agent_status,
    acc.onboarding_stage,
    acc.license_status,
    acc.activity_state,
    acc.deals_today,
    acc.deals_wtd,
    acc.deals_mtd,
    acc.deals_30d,
    acc.ap_wtd,
    acc.ap_mtd,
    acc.ap_30d,
    acc.presentations_today,
    acc.presentations_wtd,
    acc.presentations_mtd,
    acc.hours_called_today,
    acc.hours_called_wtd,
    acc.hours_called_mtd,
    acc.apps_assigned,
    acc.apps_open,
    acc.apps_new_7d,
    acc.apps_needing_contact,
    acc.close_rate_mtd_pct,
    acc.ap_trend_pct,
    acc.rank_team_mtd,
    acc.rank_agency_mtd,
    acc.next_action,
        CASE
            WHEN (acc.ap_trend_pct >= (25)::numeric) THEN 'trending_up'::text
            WHEN (acc.ap_trend_pct <= ('-25'::integer)::numeric) THEN 'trending_down'::text
            ELSE 'flat'::text
        END AS trend_tag,
        CASE
            WHEN ((acc.deals_30d = 0) AND (acc.agent_status = 'active'::text)) THEN 'stuck_no_deals_30d'::text
            WHEN (acc.activity_state = ANY (ARRAY['slipping'::text, 'inactive_warning'::text])) THEN 'stuck_no_activity'::text
            WHEN ((acc.onboarding_stage = ANY (ARRAY['pre_licensed'::text, 'onboarding'::text, 'training_online'::text])) AND (acc.deals_30d = 0)) THEN 'stuck_in_onboarding'::text
            ELSE NULL::text
        END AS stuck_reason
   FROM ((agents mgr_a
     JOIN v_agent_canonical_map mgr_map ON (mgr_map.agent_id = mgr_a.id AND mgr_map.canonical_agent_id = mgr_a.id))   -- wave-98: canonical-only managers
     JOIN v_agent_command_center acc ON ((acc.manager_id = mgr_a.id)))
  WHERE (mgr_a.is_deactivated IS NOT TRUE);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. v_recent_hires
--    Pre-wave-98: ordered by created_at over ALL agents (live + dup); 1 dup row appears as a "recent hire".
--    Fix: filter base agents to canonical-only; resolve manager_id through v_agent_canonical_map
--    so the displayed manager_name is the canonical manager even if a.manager_id points at a dup.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_recent_hires AS
 SELECT a.id,
    a.display_name,
    a.agent_code,
    split_part(a.display_name, ' '::text, 1) AS first_name,
    (a.status)::text AS status,
    (a.onboarding_stage)::text AS onboarding_stage,
    m.display_name AS manager_name,
    (a.created_at)::date AS hired_on,
    (a.contracted_at)::date AS contracted_on,
    (a.field_training_started_at)::date AS field_training_started_on,
    (EXTRACT(day FROM (now() - a.created_at)))::integer AS days_on_team,
    a.total_premium,
    a.total_policies
   FROM ((agents a
     LEFT JOIN v_agent_canonical_map mgr_map ON (mgr_map.agent_id = a.manager_id))           -- wave-98: canonicalize manager_id
     LEFT JOIN agents m ON ((m.id = mgr_map.canonical_agent_id)))
  WHERE ((a.is_deactivated IS NOT TRUE)
    AND (a.is_inactive IS NOT TRUE)
    AND (a.status = 'active'::agent_status)
    AND (a.canonical_agent_id IS NULL)                                                       -- wave-98: filter dups out of public ticker
    AND (a.display_name IS NOT NULL)
    AND ((a.agent_code IS NULL) OR (a.agent_code !~~ 'GHOST_%'::text)))
  ORDER BY a.created_at DESC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. v_recruiting_inbox
--    Pre-wave-98: assigned_agent_id displayed raw; if assignment routed to a dup, Sam saw
--    the dup as owner (or unassigned if the dup has no profile). Filter Sam can apply by
--    owner_agent_id misses canonical owner's other items.
--    Fix: canonicalize assigned_agent_id through v_agent_canonical_map so owner_agent_id +
--    owner_name reflect the canonical owner regardless of which raw id the row was assigned to.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_recruiting_inbox AS
 SELECT a.id AS application_id,
    own_map.canonical_agent_id AS owner_agent_id,                                            -- wave-98: canonical owner id
    COALESCE(p_owner.full_name, 'Unassigned'::text) AS owner_name,
    TRIM(BOTH FROM ((COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text))) AS applicant_name,
    a.phone,
    a.email,
    a.city,
    a.state,
    a.license_status,
    a.created_at AS applied_at,
    (EXTRACT(epoch FROM (now() - a.created_at)) / (3600)::numeric) AS hours_since_applied,
    a.contacted_at,
    a.next_action,
    a.next_action_at,
        CASE
            WHEN (a.contacted_at IS NOT NULL) THEN 'contacted'::text
            WHEN (a.created_at < (now() - '48:00:00'::interval)) THEN 'CRITICAL_48H_PLUS'::text
            WHEN (a.created_at < (now() - '24:00:00'::interval)) THEN 'overdue_24h'::text
            WHEN (a.created_at < (now() - '04:00:00'::interval)) THEN 'cooling'::text
            ELSE 'fresh'::text
        END AS urgency,
    a.referral_source
   FROM (((applications a
     LEFT JOIN v_agent_canonical_map own_map ON (own_map.agent_id = a.assigned_agent_id))    -- wave-98: canonicalize owner
     LEFT JOIN agents ag_owner ON ((ag_owner.id = own_map.canonical_agent_id)))
     LEFT JOIN profiles p_owner ON ((p_owner.id = ag_owner.profile_id)))
  WHERE (a.created_at >= (now() - '30 days'::interval));
