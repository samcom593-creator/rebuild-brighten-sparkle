-- wave-97: canonicalize 3 more agent-aggregating views via v_agent_canonical_map
-- (1) v_sam_builders_dashboard  — Sam's view of his recruits; missing 6 recruits + 41 apps + 105 deals routed to SJAMES02 dup
-- (2) v_charge_anomalies        — resolved_agent_id canonicalized so charges to dup agents attribute to canonical
-- (3) v_next_step_current       — filter dup agents from next-step pipeline (no duplicate "agent" rows)
--
-- Same pattern as waves 93/94/95/96: resolve raw agent_id → canonical_agent_id via v_agent_canonical_map
-- so work attached to a dup row rolls up to the canonical row.
-- Verified dup-side impact pre-wave-97:
--   SJAMES02 dup → 6 recruits + 41 apps + 105 deals  (Sam's view silently underrepresented)
--   JWANTROB01 dup → 0 (preventative)
--   JDIGNAN01 dup → 0 (preventative)

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. v_sam_builders_dashboard
--    sam_id is hardcoded canonical Sam ('7c3c5581-3544-437f-bfe2-91391afb217d').
--    Pre-wave-97: filtered agents WHERE invited_by_manager_id = sam_id (canonical) — missed the
--    6 recruits whose invited_by_manager_id was SJAMES02_dup. Per-recruit deals/downline subqueries
--    matched deal.agent_id = agent.id exactly — missed any deals routed via dup ids.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_sam_builders_dashboard AS
WITH sam_id AS (
  SELECT '7c3c5581-3544-437f-bfe2-91391afb217d'::uuid AS id
),
-- All raw agent ids (canonical Sam + Sam's dup row) that resolve to canonical Sam
sam_self_ids AS (
  SELECT m.agent_id
    FROM v_agent_canonical_map m
   WHERE m.canonical_agent_id = (SELECT id FROM sam_id)
),
-- One canonical row per distinct recruit Sam invited (via any of his ids)
sam_recruit_ids AS (
  SELECT DISTINCT m.canonical_agent_id AS agent_id
    FROM agents a_raw
    JOIN v_agent_canonical_map m ON m.agent_id = a_raw.id
   WHERE a_raw.invited_by_manager_id IN (SELECT agent_id FROM sam_self_ids)
),
sam_recruits AS (
  SELECT
    a.id AS agent_id,
    COALESCE(p.full_name, 'Unknown'::text) AS name,
    p.email,
    (a.created_at)::date AS hired_date,
    a.license_status,
    a.status,
    (a.onboarding_stage)::text AS onboarding_stage_text,
    -- Direct recruits: count distinct canonical agents whose raw row's invited_by_manager_id
    -- resolves to this recruit (a.id), regardless of which dup row it pointed at.
    ( SELECT count(DISTINCT m_child.canonical_agent_id)
        FROM agents r
        JOIN v_agent_canonical_map m_upline ON m_upline.agent_id = r.invited_by_manager_id
        JOIN v_agent_canonical_map m_child  ON m_child.agent_id = r.id
       WHERE m_upline.canonical_agent_id = a.id
    ) AS direct_recruits,
    -- own_ap_mtd: deals (via any dup or canonical id) attributed to this recruit, MTD
    ( SELECT COALESCE(SUM(d.annual_premium), (0)::numeric)::integer
        FROM deals d
        JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
       WHERE m.canonical_agent_id = a.id
         AND d.created_at >= date_trunc('month'::text, now())
    ) AS own_ap_mtd,
    ( SELECT count(*)
        FROM deals d
        JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
       WHERE m.canonical_agent_id = a.id
         AND d.created_at >= date_trunc('month'::text, now())
    ) AS own_deals_mtd,
    -- downline_ap_mtd: sum AP across canonical downline (any dup-routed deals attribute via canonical map)
    ( SELECT COALESCE(SUM(d2.annual_premium), (0)::numeric)::integer
        FROM deals d2
        JOIN v_agent_canonical_map m_deal ON m_deal.agent_id = d2.agent_id
       WHERE d2.created_at >= date_trunc('month'::text, now())
         AND m_deal.canonical_agent_id IN (
           SELECT DISTINCT m_child.canonical_agent_id
             FROM agents r
             JOIN v_agent_canonical_map m_upline ON m_upline.agent_id = r.invited_by_manager_id
             JOIN v_agent_canonical_map m_child  ON m_child.agent_id = r.id
            WHERE m_upline.canonical_agent_id = a.id
         )
    ) AS downline_ap_mtd,
    -- days_to_first_deal: min(deal.created_at) across all canonical-routed deals
    ( SELECT EXTRACT(day FROM (MIN(d.created_at) - a.created_at))::integer
        FROM deals d
        JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
       WHERE m.canonical_agent_id = a.id
    ) AS days_to_first_deal,
    -- last_deal_date: max(deal.created_at) across all canonical-routed deals
    ( SELECT MAX(d.created_at)::date
        FROM deals d
        JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
       WHERE m.canonical_agent_id = a.id
    ) AS last_deal_date
  FROM (agents a
        LEFT JOIN profiles p ON ((p.id = a.profile_id)))
  WHERE a.id IN (SELECT agent_id FROM sam_recruit_ids)
    AND a.canonical_agent_id IS NULL
)
SELECT
  agent_id,
  name,
  email,
  hired_date,
  license_status,
  status,
  onboarding_stage_text AS onboarding_stage,
  direct_recruits,
  own_ap_mtd,
  own_deals_mtd,
  downline_ap_mtd,
  (own_ap_mtd + downline_ap_mtd) AS team_ap_mtd,
  days_to_first_deal,
  last_deal_date,
  CASE
    WHEN (direct_recruits >= 3) THEN 'builder_strong'::text
    WHEN (direct_recruits >= 1) THEN 'builder_emerging'::text
    WHEN (own_deals_mtd >= 4) THEN 'producer'::text
    WHEN (own_deals_mtd >= 1) THEN 'producer_light'::text
    WHEN (hired_date >= ((now() - '30 days'::interval))::date) THEN 'new_hire'::text
    WHEN ((last_deal_date IS NULL) OR (last_deal_date < ((now() - '30 days'::interval))::date)) THEN 'dormant'::text
    ELSE 'unknown'::text
  END AS builder_tier,
  CASE
    WHEN (onboarding_stage_text = 'live'::text) THEN 'active producer'::text
    WHEN (onboarding_stage_text = 'below_10k'::text) THEN 'active (under 10k)'::text
    WHEN (onboarding_stage_text = ANY (ARRAY['in_field_training'::text, 'training_online'::text, 'onboarding'::text, 'pre_licensed'::text])) THEN 'onboarding'::text
    WHEN (onboarding_stage_text = 'applied'::text) THEN 'just applied'::text
    WHEN (onboarding_stage_text = 'transfer'::text) THEN 'transfer pending'::text
    WHEN (onboarding_stage_text = 'need_followup'::text) THEN 'needs followup'::text
    WHEN (onboarding_stage_text = 'inactive'::text) THEN 'inactive'::text
    WHEN (license_status = 'unlicensed'::license_status) THEN 'unlicensed'::text
    ELSE COALESCE(onboarding_stage_text, 'unknown'::text)
  END AS progress_label,
  (last_deal_date >= ((now() - '14 days'::interval))::date) AS actively_producing
FROM sam_recruits
ORDER BY
  CASE
    WHEN (direct_recruits >= 3) THEN 0
    WHEN (direct_recruits >= 1) THEN 1
    WHEN (own_deals_mtd >= 4) THEN 2
    ELSE 3
  END,
  (own_ap_mtd + downline_ap_mtd) DESC NULLS LAST,
  hired_date DESC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. v_charge_anomalies
--    Charges attributed to a dup-routed agent_id resolved to the dup id, not canonical.
--    Wrap resolved_agent_id with canonical lookup so flag_unlinked + resolved_agent_id
--    behave correctly when the agents_canonical_map points the dup at the canonical row.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_charge_anomalies AS
WITH base AS (
  SELECT lp.id,
         lp.stripe_charge_id,
         lp.amount_cents,
         ((lp.amount_cents)::numeric / (100)::numeric) AS amount_usd,
         lp.currency,
         lp.customer_email,
         lp.customer_name,
         lp.description,
         lp.agent_id_ref,
         lp.agent_id,
         lp.charged_at,
         lp.metadata,
         -- Resolve raw agent id → canonical agent id via v_agent_canonical_map
         (SELECT m.canonical_agent_id
            FROM v_agent_canonical_map m
           WHERE m.agent_id = COALESCE(a_ref.id, a_email.id, a_name.id)
          LIMIT 1) AS resolved_agent_id,
         COALESCE(a_ref.display_name, p_ref.full_name, a_email.display_name, p_email.full_name, a_name.display_name, p_name.full_name) AS resolved_agent_name
    FROM (((((((lead_purchases lp
      LEFT JOIN agents a_ref ON ((a_ref.id = lp.agent_id)))
      LEFT JOIN profiles p_ref ON ((p_ref.id = a_ref.profile_id)))
      LEFT JOIN auth.users u_email ON (((u_email.email)::text = lp.customer_email)))
      LEFT JOIN agents a_email ON ((a_email.user_id = u_email.id)))
      LEFT JOIN profiles p_email ON ((p_email.id = a_email.profile_id)))
      LEFT JOIN LATERAL ( SELECT a3.id,
             a3.display_name,
             a3.profile_id
        FROM (agents a3 JOIN profiles p3 ON ((p3.id = a3.profile_id)))
       WHERE ((lp.agent_id IS NULL) AND (u_email.id IS NULL) AND (lp.customer_name IS NOT NULL) AND (length(TRIM(BOTH FROM lp.customer_name)) >= 5) AND (lower(regexp_replace(TRIM(BOTH FROM lp.customer_name), '\s+'::text, ' '::text, 'g'::text)) = lower(regexp_replace(TRIM(BOTH FROM p3.full_name), '\s+'::text, ' '::text, 'g'::text))))
       ORDER BY a3.created_at DESC
       LIMIT 1) a_name ON (true))
      LEFT JOIN profiles p_name ON ((p_name.id = a_name.profile_id)))
)
SELECT id,
       stripe_charge_id,
       amount_cents,
       amount_usd,
       currency,
       customer_email,
       customer_name,
       description,
       agent_id_ref,
       agent_id,
       charged_at,
       metadata,
       resolved_agent_id,
       resolved_agent_name,
       ((customer_name IS NOT NULL) AND (resolved_agent_name IS NOT NULL) AND (lower(customer_name) !~~ (('%'::text || lower(split_part(resolved_agent_name, ' '::text, 1))) || '%'::text))) AS flag_name_mismatch,
       (resolved_agent_id IS NULL) AS flag_unlinked,
       (amount_cents <> ALL (ARRAY[10000, 25000])) AS flag_unusual_amount,
       (EXISTS ( SELECT 1
                   FROM lead_purchases lp2
                  WHERE ((lp2.customer_email = b.customer_email)
                    AND (lp2.id <> b.id)
                    AND (abs(EXTRACT(epoch FROM (lp2.charged_at - b.charged_at))) < (600)::numeric)))) AS flag_duplicate_window
  FROM base b;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. v_next_step_current
--    agents_part CTE was SELECT ... FROM agents g (no canonical filter) → dup agents
--    appeared as separate next-step rows. Filter to canonical only.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_next_step_current AS
WITH applicants AS (
  SELECT a.id AS application_id,
         NULL::uuid AS agent_id,
         'applicant'::text AS person_type,
         a.first_name,
         a.last_name,
         a.email,
         a.phone,
         (a.status)::text AS legacy_status,
         (a.license_progress)::text AS license_progress,
         a.hiring_manager_user_id AS owner_user_id,
         CASE
           WHEN (a.status = ANY (ARRAY['rejected'::application_status, 'disqualified'::application_status, 'lapsed'::application_status])) THEN 'closed_lost'::text
           WHEN ((a.exam_passed_at IS NOT NULL) AND ((a.fingerprint_done = true) OR (a.fingerprints_submitted_at IS NOT NULL))) THEN 'passed_exam'::text
           WHEN (a.exam_passed_at IS NOT NULL) THEN 'passed_exam'::text
           WHEN (a.exam_scheduled_at IS NOT NULL) THEN 'exam_scheduled'::text
           WHEN ((a.license_progress = 'finished_course'::license_progress) OR (a.license_progress = 'exam_passed'::license_progress) OR (a.license_progress = 'passed_test'::license_progress)) THEN 'finished_prelicense'::text
           WHEN ((a.course_started_at IS NOT NULL) OR (a.course_purchased_at IS NOT NULL) OR (a.license_progress = 'course_purchased'::license_progress)) THEN 'started_prelicense'::text
           WHEN (a.seminar_attended_at IS NOT NULL) THEN 'attended_seminar'::text
           WHEN ((a.seminar_registered_at IS NOT NULL) OR (a.seminar_date IS NOT NULL)) THEN 'booked_seminar'::text
           WHEN ((a.contacted_at IS NOT NULL) OR (a.last_contacted_at IS NOT NULL)) THEN 'contacted'::text
           WHEN (a.vsl_watched_at IS NOT NULL) THEN 'watched_vsl'::text
           ELSE 'applied'::text
         END AS derived_stage_key,
         a.created_at AS person_created_at,
         a.next_action_at,
         a.next_action_due_at,
         a.last_contacted_at,
         CASE
           WHEN (a.exam_passed_at IS NOT NULL) THEN a.exam_passed_at
           WHEN (a.exam_scheduled_at IS NOT NULL) THEN a.exam_scheduled_at
           WHEN (a.license_progress = ANY (ARRAY['finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress])) THEN a.updated_at
           WHEN (a.course_started_at IS NOT NULL) THEN a.course_started_at
           WHEN (a.course_purchased_at IS NOT NULL) THEN a.course_purchased_at
           WHEN (a.seminar_attended_at IS NOT NULL) THEN a.seminar_attended_at
           WHEN (a.seminar_registered_at IS NOT NULL) THEN a.seminar_registered_at
           WHEN (a.seminar_date IS NOT NULL) THEN a.created_at
           WHEN (a.contacted_at IS NOT NULL) THEN a.contacted_at
           WHEN (a.last_contacted_at IS NOT NULL) THEN a.last_contacted_at
           WHEN (a.vsl_watched_at IS NOT NULL) THEN a.vsl_watched_at
           ELSE a.created_at
         END AS stage_entered_at
    FROM applications a
   WHERE ((COALESCE(a.is_duplicate, false) = false) AND (a.status <> 'approved'::application_status))
), agents_part AS (
  SELECT NULL::uuid AS application_id,
         g.id AS agent_id,
         'agent'::text AS person_type,
         COALESCE(split_part(p.full_name, ' '::text, 1), split_part(g.display_name, ' '::text, 1)) AS first_name,
         COALESCE(NULLIF(regexp_replace(p.full_name, '^\S+\s*'::text, ''::text), ''::text), split_part(g.display_name, ' '::text, 2)) AS last_name,
         p.email,
         p.phone,
         (g.status)::text AS legacy_status,
         (g.license_status)::text AS license_progress,
         g.manager_id AS owner_user_id,
         CASE
           WHEN ((g.is_deactivated = true) OR (g.status = 'terminated'::agent_status)) THEN 'closed_lost'::text
           WHEN ((g.first_10k_at IS NOT NULL) OR (g.weekly_10k_badges > 0)) THEN 'first_10k_week'::text
           WHEN (g.first_deal_at IS NOT NULL) THEN 'first_deal'::text
           WHEN (g.first_appointment_at IS NOT NULL) THEN 'first_appointment'::text
           WHEN ((g.field_training_started_at IS NOT NULL) OR ((g.onboarding_stage)::text = 'in_field_training'::text)) THEN 'infield_training'::text
           WHEN (g.onboarding_completed_at IS NOT NULL) THEN 'course_completed'::text
           WHEN (g.has_training_course = true) THEN 'course_started'::text
           ELSE 'hired'::text
         END AS derived_stage_key,
         g.created_at AS person_created_at,
         NULL::timestamp with time zone AS next_action_at,
         NULL::timestamp with time zone AS next_action_due_at,
         NULL::timestamp with time zone AS last_contacted_at,
         CASE
           WHEN (g.first_10k_at IS NOT NULL) THEN g.first_10k_at
           WHEN (g.first_deal_at IS NOT NULL) THEN g.first_deal_at
           WHEN (g.first_appointment_at IS NOT NULL) THEN g.first_appointment_at
           WHEN (g.field_training_started_at IS NOT NULL) THEN g.field_training_started_at
           WHEN (g.onboarding_completed_at IS NOT NULL) THEN g.onboarding_completed_at
           WHEN (g.has_training_course = true) THEN COALESCE(g.production_unlocked_at, g.contracted_at, (g.start_date)::timestamp with time zone, g.created_at)
           ELSE COALESCE(g.contracted_at, (g.start_date)::timestamp with time zone, g.created_at)
         END AS stage_entered_at
    FROM (agents g LEFT JOIN profiles p ON ((p.user_id = g.user_id)))
   WHERE g.canonical_agent_id IS NULL  -- wave-97: dup agents don't appear as duplicate next-step rows
     AND EXISTS (SELECT 1 FROM v_agent_canonical_map vc WHERE vc.canonical_agent_id = g.id)
)
SELECT x.application_id,
       x.agent_id,
       x.person_type,
       x.first_name,
       x.last_name,
       x.email,
       x.phone,
       x.legacy_status,
       x.license_progress,
       x.owner_user_id,
       x.derived_stage_key,
       x.person_created_at,
       x.next_action_at,
       x.next_action_due_at,
       x.last_contacted_at,
       x.stage_entered_at,
       s.display_name AS stage_display_name,
       s.next_action_label,
       s.next_action_url,
       s.sla_hours,
       s.owner_role,
       s.color_hex,
       s.icon_name,
       s.dashboard_section,
       s.candidate_message_template,
       s.failure_label,
       s.is_terminal,
       CASE
         WHEN (s.sla_hours IS NULL) THEN NULL::timestamp with time zone
         ELSE (x.stage_entered_at + ((s.sla_hours || ' hours'::text))::interval)
       END AS sla_due_at,
       CASE
         WHEN (s.sla_hours IS NULL) THEN NULL::boolean
         WHEN (now() > (x.stage_entered_at + ((s.sla_hours || ' hours'::text))::interval)) THEN true
         ELSE false
       END AS is_stalled,
       (EXTRACT(epoch FROM (now() - x.stage_entered_at)) / 86400.0) AS days_in_stage
  FROM (( SELECT applicants.application_id,
                 applicants.agent_id,
                 applicants.person_type,
                 applicants.first_name,
                 applicants.last_name,
                 applicants.email,
                 applicants.phone,
                 applicants.legacy_status,
                 applicants.license_progress,
                 applicants.owner_user_id,
                 applicants.derived_stage_key,
                 applicants.person_created_at,
                 applicants.next_action_at,
                 applicants.next_action_due_at,
                 applicants.last_contacted_at,
                 applicants.stage_entered_at
            FROM applicants
          UNION ALL
          SELECT agents_part.application_id,
                 agents_part.agent_id,
                 agents_part.person_type,
                 agents_part.first_name,
                 agents_part.last_name,
                 agents_part.email,
                 agents_part.phone,
                 agents_part.legacy_status,
                 agents_part.license_progress,
                 agents_part.owner_user_id,
                 agents_part.derived_stage_key,
                 agents_part.person_created_at,
                 agents_part.next_action_at,
                 agents_part.next_action_due_at,
                 agents_part.last_contacted_at,
                 agents_part.stage_entered_at
            FROM agents_part) x
     LEFT JOIN next_step_stages s ON ((s.stage_key = x.derived_stage_key)));
