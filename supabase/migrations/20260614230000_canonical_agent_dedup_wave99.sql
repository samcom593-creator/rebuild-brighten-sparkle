-- wave-99: canonical-agent dedup sweep — drain remaining tail of per-agent views
-- See: /Users/samjames/business-ops/website-integrity-bot/ledger/2026-06-14.jsonl wave-99-claim
-- Pattern: v_agent_canonical_map(agent_id -> canonical_agent_id).
-- Views patched: v_admin_applicant_overview, v_chargebacks_30d, v_kj_seminar_control,
-- v_lapsed_recovery, v_recent_conduct_events, v_referral_pipeline, v_stale_applicants,
-- v_strike_summary, v_xcel_pipeline.
-- v_old_manager_applicants intentionally skipped — pure applications passthrough, no agent join.

-- ============================================================================
-- 1. v_admin_applicant_overview — canonical recruiter join via assigned_agent_id
-- ============================================================================
CREATE OR REPLACE VIEW v_admin_applicant_overview AS
SELECT a.id,
    a.created_at,
    a.first_name,
    a.last_name,
    a.email,
    a.phone,
    a.state,
    a.city,
    (a.status)::text AS status,
    (a.license_status)::text AS license_status,
    a.licensed_states,
    a.nipr_number,
    a.has_insurance_experience,
    a.years_experience,
    a.previous_company,
    a.desired_income,
    a.referral_source,
    a.source,
    a.utm_source,
    a.utm_medium,
    a.utm_campaign,
    a.seminar_date,
    a.seminar_registered_at,
    a.seminar_attended_at,
    a.ica_paid,
    a.ica_paid_at,
    a.ica_amount_cents,
    a.stripe_customer_id,
    a.assigned_agent_id,
    recruiter_p.email AS assigned_recruiter_email,
    recruiter_ag.agent_code AS assigned_recruiter_code,
    a.contacted_at,
    a.qualified_at,
    a.closed_at,
    a.notes,
    a.is_duplicate,
    a.duplicate_of,
    a.next_action,
    a.next_action_due_at,
    a.tags,
    becomes_agent.id AS became_agent_id,
    becomes_agent.agent_code AS became_agent_code,
    becomes_agent.total_premium AS agent_total_premium,
    becomes_agent.total_policies AS agent_total_policies,
    becomes_agent.total_earnings AS agent_total_earnings,
    ( SELECT ch.created_at
           FROM contact_history ch
          WHERE (ch.application_id = a.id)
          ORDER BY ch.created_at DESC
         LIMIT 1) AS last_contact_at,
    ( SELECT (count(*))::integer AS count
           FROM contact_history ch
          WHERE (ch.application_id = a.id)) AS total_contacts,
    ( SELECT (count(*))::integer AS count
           FROM inbox_messages im
          WHERE (im.application_id = a.id)) AS inbox_message_count,
    (EXTRACT(day FROM (now() - a.updated_at)))::integer AS days_in_status
   FROM applications a
   LEFT JOIN agents recruiter_ag ON recruiter_ag.id = (
     SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = a.assigned_agent_id
   )
   LEFT JOIN profiles recruiter_p ON recruiter_p.id = recruiter_ag.profile_id
   LEFT JOIN agents becomes_agent ON becomes_agent.id = (
     SELECT m.canonical_agent_id FROM v_agent_canonical_map m
     WHERE m.agent_id = (
       SELECT ag2.id FROM agents ag2
       JOIN profiles p2 ON p2.id = ag2.profile_id
       WHERE lower(p2.email) = lower(a.email)
       LIMIT 1
     )
   );

-- ============================================================================
-- 2. v_chargebacks_30d — canonicalize deals.agent_id (text-cast UNION)
-- ============================================================================
CREATE OR REPLACE VIEW v_chargebacks_30d AS
WITH d AS (
  SELECT (d.id)::text AS source_id,
      'deals'::text AS source,
      d.chargeback_at AS occurred_at,
      d.annual_premium AS amount,
      (COALESCE((SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = d.agent_id), d.agent_id))::text AS agent_id,
      ((((COALESCE(d.client_first_name, ''::text) || ' '::text) || COALESCE(d.client_last_name, ''::text)) || ' · '::text) || "right"(COALESCE(d.client_phone, ''::text), 4)) AS customer_email,
      d.chargeback_status AS status_text
   FROM deals d
   WHERE ((d.chargeback_status = ANY (ARRAY['chargeback'::text, 'charged_back'::text])) AND (d.chargeback_at IS NOT NULL) AND (d.chargeback_at >= (now() - '30 days'::interval)))
), lp AS (
  SELECT (lp.id)::text AS source_id,
      'lead_purchases'::text AS source,
      lp.refunded_at AS occurred_at,
      ((COALESCE(lp.amount_cents, 0))::numeric / 100.0) AS amount,
      COALESCE(lp.agent_id_ref, ''::text) AS agent_id,
      lp.customer_email,
      'refunded'::text AS status_text
   FROM lead_purchases lp
   WHERE ((lp.refunded_at IS NOT NULL) AND (lp.refunded_at >= (now() - '30 days'::interval)))
), sd AS (
  SELECT (e.id)::text AS source_id,
      'stripe_disputes'::text AS source,
      e.created_at AS occurred_at,
      NULL::numeric AS amount,
      ''::text AS agent_id,
      e.customer_email,
      e.event_type AS status_text
   FROM stripe_subscription_events e
   WHERE ((e.event_type ~~* '%dispute%'::text) AND (e.created_at >= (now() - '30 days'::interval)))
)
SELECT * FROM d
UNION ALL SELECT * FROM lp
UNION ALL SELECT * FROM sd;

-- ============================================================================
-- 3. v_kj_seminar_control — canonicalize converted_agent_id (email->agent lookup)
-- ============================================================================
CREATE OR REPLACE VIEW v_kj_seminar_control AS
WITH base AS (
  SELECT sr.id AS registration_id,
      sr.application_id,
      sr.first_name,
      sr.last_name,
      sr.email,
      sr.phone,
      sr.license_status,
      sr.source,
      sr.seminar_date,
      sr.registered_at,
      sr.attended,
      sr.follow_up_sent_at,
      sr.utm_source,
      sr.utm_medium,
      sr.utm_campaign,
      sr.paid_after,
      sr.paid_at,
      (a.status)::text AS app_status,
      a.ica_paid,
      a.ica_paid_at,
      (a.license_progress)::text AS app_license_progress,
      a.contracted_at AS app_contracted_at,
      a.first_deal_at,
      ag.id AS converted_agent_id,
      (ag.status)::text AS agent_status,
      (ag.onboarding_stage)::text AS onboarding_stage,
      ag.contracted_at AS agent_contracted_at
   FROM seminar_registrations sr
   LEFT JOIN applications a ON a.id = sr.application_id
   LEFT JOIN agents ag ON ag.id = (
     SELECT m.canonical_agent_id FROM v_agent_canonical_map m
     WHERE m.agent_id = (
       SELECT ag2.id FROM agents ag2
       JOIN profiles p2 ON p2.id = ag2.profile_id
       WHERE lower(p2.email) = lower(sr.email)
       LIMIT 1
     )
   )
)
SELECT registration_id,
    application_id,
    ((first_name || ' '::text) || last_name) AS attendee_name,
    email,
    phone,
    license_status,
    source,
    seminar_date,
    registered_at,
    attended,
    paid_after,
    paid_at,
    app_status,
    ica_paid,
    ica_paid_at,
    app_license_progress,
    converted_agent_id,
    agent_status,
    onboarding_stage,
    agent_contracted_at,
    first_deal_at,
    CASE
        WHEN ((seminar_date >= CURRENT_DATE) AND (attended IS NOT TRUE)) THEN 'upcoming'::text
        WHEN ((seminar_date < CURRENT_DATE) AND (attended IS NOT TRUE)) THEN 'no_show'::text
        WHEN ((attended = true) AND (ica_paid IS NOT TRUE)) THEN 'attended_unpaid'::text
        WHEN ((ica_paid = true) AND (app_license_progress = ANY (ARRAY['unlicensed'::text, 'course_purchased'::text]))) THEN 'paid_pre_licensing'::text
        WHEN (app_license_progress = ANY (ARRAY['finished_course'::text, 'test_scheduled'::text, 'passed_test'::text, 'fingerprints_done'::text, 'waiting_on_license'::text, 'exam_passed'::text])) THEN 'in_licensing'::text
        WHEN ((app_license_progress = 'licensed'::text) AND (agent_contracted_at IS NULL)) THEN 'licensed_pre_contract'::text
        WHEN ((agent_contracted_at IS NOT NULL) AND (first_deal_at IS NULL)) THEN 'contracted_no_deal'::text
        WHEN (first_deal_at IS NOT NULL) THEN 'active_producer'::text
        ELSE 'unknown'::text
    END AS stage,
    (EXTRACT(epoch FROM (now() - registered_at)) / (86400)::numeric) AS days_since_registered
FROM base;

-- ============================================================================
-- 4. v_lapsed_recovery — canonicalize agent_id used for display join
-- ============================================================================
CREATE OR REPLACE VIEW v_lapsed_recovery AS
WITH dead AS (
  SELECT carrier_policies.id,
      carrier_policies.client_first_name,
      carrier_policies.client_last_name,
      carrier_policies.carrier_name,
      carrier_policies.policy_number,
      carrier_policies.policy_status,
      carrier_policies.effective_date,
      carrier_policies.face_amount,
      carrier_policies.annual_premium,
      carrier_policies.agent_raw,
      carrier_policies.agent_id,
      carrier_policies.agent_match_method,
      carrier_policies.matched_deal_id,
      carrier_policies.matched_at,
      carrier_policies.flag_no_policy_num,
      carrier_policies.source,
      carrier_policies.source_batch_id,
      carrier_policies.raw,
      carrier_policies.imported_at,
      carrier_policies.updated_at
   FROM carrier_policies
   WHERE (lower(carrier_policies.policy_status) = ANY (ARRAY['lapsed'::text, 'lapse pending'::text, 'cancelled'::text, 'withdrawn'::text, 'not taken'::text]))
), has_successor AS (
  SELECT DISTINCT d_1.id AS dead_id
   FROM dead d_1
   JOIN carrier_policies live ON (
     lower(live.client_first_name) = lower(d_1.client_first_name)
     AND lower(live.client_last_name) = lower(d_1.client_last_name)
     AND live.id <> d_1.id
     AND lower(live.policy_status) = ANY (ARRAY['active'::text, 'approved'::text, 'in review'::text, 'pending'::text])
   )
)
SELECT d.id,
    d.client_first_name,
    d.client_last_name,
    d.carrier_name,
    d.policy_number,
    d.policy_status,
    d.effective_date,
    d.face_amount,
    d.annual_premium,
    d.agent_id,
    COALESCE(ag.display_name, p.full_name) AS agent_name,
    d.agent_raw,
    (CURRENT_DATE - d.effective_date) AS days_since_effective,
    (COALESCE(d.annual_premium, (0)::numeric) * 0.80) AS approx_walked_commission_usd
FROM dead d
LEFT JOIN agents ag ON ag.id = (
  SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = d.agent_id
)
LEFT JOIN profiles p ON p.id = ag.profile_id
WHERE NOT (d.id IN (SELECT has_successor.dead_id FROM has_successor));

-- ============================================================================
-- 5. v_recent_conduct_events — canonicalize agent_strikes.agent_id display
-- (v_charge_anomalies already canonicalized in wave-97)
-- ============================================================================
CREATE OR REPLACE VIEW v_recent_conduct_events AS
SELECT 'strike'::text AS event_type,
    (s.id)::text AS event_id,
    s.issued_at AS occurred_at,
    s.agent_id,
    COALESCE(ag.display_name, p.full_name, (u.email)::text) AS agent_name,
    (s.severity)::text AS severity_or_flag,
    format('Strike issued: %s'::text, (s.reason_code)::text) AS title,
    s.description,
    jsonb_build_object('reason_code', s.reason_code, 'severity', s.severity, 'status', s.status, 'expires_at', s.expires_at) AS detail
FROM agent_strikes s
LEFT JOIN agents ag ON ag.id = (
  SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = s.agent_id
)
LEFT JOIN profiles p ON p.id = ag.profile_id
LEFT JOIN auth.users u ON u.id = ag.user_id
UNION ALL
SELECT 'charge_anomaly'::text AS event_type,
    (c.id)::text AS event_id,
    c.charged_at AS occurred_at,
    c.resolved_agent_id AS agent_id,
    c.resolved_agent_name AS agent_name,
    CASE
        WHEN c.flag_duplicate_window THEN 'duplicate_window'::text
        WHEN c.flag_name_mismatch THEN 'name_mismatch'::text
        WHEN c.flag_unlinked THEN 'unlinked'::text
        WHEN c.flag_unusual_amount THEN 'unusual_amount'::text
        ELSE NULL::text
    END AS severity_or_flag,
    format('Charge flag: $%s — %s'::text, (c.amount_usd)::text, COALESCE(c.customer_name, '(no name)'::text)) AS title,
    COALESCE(c.description, ''::text) AS description,
    jsonb_build_object('amount_usd', c.amount_usd, 'customer_email', c.customer_email, 'stripe_charge_id', c.stripe_charge_id, 'flag_name_mismatch', c.flag_name_mismatch, 'flag_unlinked', c.flag_unlinked, 'flag_unusual_amount', c.flag_unusual_amount, 'flag_duplicate_window', c.flag_duplicate_window) AS detail
FROM v_charge_anomalies c
WHERE (c.flag_name_mismatch OR c.flag_unlinked OR c.flag_unusual_amount OR c.flag_duplicate_window);

-- ============================================================================
-- 6. v_referral_pipeline — canonicalize referrer_agent_id display join
-- ============================================================================
CREATE OR REPLACE VIEW v_referral_pipeline AS
SELECT r.id AS referral_id,
    (r.status)::text AS status,
    r.referrer_agent_id,
    ra.display_name AS referrer_name,
    ra.agent_code AS referrer_code,
    ((r.referred_first_name || ' '::text) || r.referred_last_name) AS referred_name,
    r.referred_email,
    r.referred_phone,
    r.referred_state,
    r.referred_license,
    r.relationship,
    r.application_id,
    r.resulting_agent_id,
    r.deal_id,
    r.bonus_owed_cents,
    r.bonus_paid_cents,
    r.assigned_manager_id,
    r.next_action,
    r.next_action_due_at,
    (EXTRACT(epoch FROM (now() - r.created_at)) / (86400)::numeric) AS days_since_submitted,
    r.created_at,
    r.contacted_at,
    r.booked_at,
    r.attended_at,
    r.onboarded_at,
    r.licensed_at,
    r.contracted_at,
    r.producing_at,
    r.is_duplicate,
    r.duplicate_of,
    CASE
        WHEN ((r.status = 'submitted'::referral_status) AND (r.created_at < (now() - '24:00:00'::interval))) THEN 'overdue_contact'::text
        WHEN ((r.status = 'contacted'::referral_status) AND (r.contacted_at < (now() - '3 days'::interval))) THEN 'stalled_after_contact'::text
        WHEN ((r.status = 'booked'::referral_status) AND (r.booked_at < (now() - '7 days'::interval))) THEN 'stalled_before_attend'::text
        WHEN ((r.next_action_due_at IS NOT NULL) AND (r.next_action_due_at < now())) THEN 'overdue_action'::text
        ELSE 'on_track'::text
    END AS triage_bucket
FROM referrals r
LEFT JOIN agents ra ON ra.id = (
  SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = r.referrer_agent_id
);

-- ============================================================================
-- 7. v_stale_applicants — canonicalize assigned_agent_id->manager display
-- ============================================================================
CREATE OR REPLACE VIEW v_stale_applicants AS
WITH base AS (
  SELECT a.id,
      a.first_name,
      a.last_name,
      a.email,
      a.phone,
      a.city,
      a.state,
      (a.license_status)::text AS license_status,
      (a.status)::text AS status,
      a.assigned_agent_id,
      a.instagram_handle,
      a.created_at,
      (EXTRACT(epoch FROM (now() - a.created_at)) / (3600)::numeric) AS hours_since_application,
      COALESCE(mgr.display_name, '(unassigned)'::text) AS assigned_manager_name,
      NULL::text AS assigned_manager_avatar
   FROM applications a
   LEFT JOIN agents mgr ON mgr.id = (
     SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = a.assigned_agent_id
   )
   WHERE (
     ((a.status)::text <> ALL (ARRAY['paid'::text, 'approved'::text, 'rejected'::text, 'disqualified'::text, 'attended'::text, 'producing'::text]))
     AND (a.contacted_at IS NULL)
     AND (a.created_at > (now() - '60 days'::interval))
   )
)
SELECT id,
    first_name,
    last_name,
    email,
    phone,
    city,
    state,
    license_status,
    status,
    assigned_agent_id,
    instagram_handle,
    created_at,
    hours_since_application,
    assigned_manager_name,
    assigned_manager_avatar,
    CASE
        WHEN ((hours_since_application >= (24)::numeric) AND (hours_since_application <= (72)::numeric)) THEN 'stale'::text
        WHEN ((hours_since_application >= (72)::numeric) AND (hours_since_application <= (168)::numeric)) THEN 'icy'::text
        WHEN (hours_since_application > (168)::numeric) THEN 'cold'::text
        ELSE 'fresh'::text
    END AS staleness
FROM base
WHERE (hours_since_application >= (24)::numeric);

-- ============================================================================
-- 8. v_strike_summary — collapse onto canonical agents + aggregate dup strikes
-- ============================================================================
CREATE OR REPLACE VIEW v_strike_summary AS
SELECT a.id AS agent_id,
    COALESCE(a.display_name, p.full_name, (u.email)::text, 'Unknown'::text) AS agent_name,
    a.agent_code,
    count(s.*) FILTER (WHERE (s.status = 'active'::strike_status)) AS active_count,
    count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'warning'::strike_severity))) AS active_warnings,
    count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'minor'::strike_severity))) AS active_minor,
    count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'major'::strike_severity))) AS active_major,
    count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'terminal'::strike_severity))) AS active_terminal,
    count(s.*) FILTER (WHERE (s.status = 'resolved'::strike_status)) AS resolved_count,
    count(s.*) AS total_count,
    max(s.issued_at) FILTER (WHERE (s.status = 'active'::strike_status)) AS most_recent_active_at,
    CASE
        WHEN (count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'terminal'::strike_severity))) > 0) THEN 'terminal'::text
        WHEN (count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'major'::strike_severity))) >= 3) THEN 'review_required'::text
        WHEN (count(s.*) FILTER (WHERE ((s.status = 'active'::strike_status) AND (s.severity = 'major'::strike_severity))) > 0) THEN 'on_notice'::text
        WHEN (count(s.*) FILTER (WHERE (s.status = 'active'::strike_status)) > 0) THEN 'flagged'::text
        ELSE 'clear'::text
    END AS standing
FROM agents a
LEFT JOIN profiles p ON p.id = a.profile_id
LEFT JOIN auth.users u ON u.id = a.user_id
LEFT JOIN agent_strikes s ON s.agent_id IN (
  -- pull all raw agent_ids that map to THIS canonical row, so dup-routed strikes count
  SELECT m.agent_id FROM v_agent_canonical_map m WHERE m.canonical_agent_id = a.id
)
WHERE a.canonical_agent_id IS NULL  -- canonical agents only
GROUP BY a.id, a.display_name, p.full_name, u.email, a.agent_code;

-- ============================================================================
-- 9. v_xcel_pipeline — canonicalize assigned_agent_id->manager display
-- ============================================================================
CREATE OR REPLACE VIEW v_xcel_pipeline AS
WITH base AS (
  SELECT s.email AS student_email,
      NULLIF(TRIM(BOTH ' '::text FROM concat_ws(' '::text, s.first_name, s.last_name)), ''::text) AS student_name,
      (s.last_log_in)::timestamp with time zone AS last_login,
      s.time_spent_minutes,
      s.pct_complete,
      s.date_completed,
      s.application_id,
      a.id AS app_id,
      a.first_name AS app_first_name,
      a.last_name AS app_last_name,
      a.phone AS app_phone,
      (a.license_status)::text AS license_status,
      (a.license_progress)::text AS license_progress,
      a.assigned_agent_id,
      CASE
          WHEN (s.last_log_in IS NULL) THEN NULL::integer
          ELSE GREATEST(0, (CURRENT_DATE - s.last_log_in))
      END AS days_since_login
   FROM xcel_pre_licensing_students s
   LEFT JOIN applications a ON a.id = s.application_id
), with_state AS (
  SELECT b.student_email,
      b.student_name,
      b.last_login,
      b.time_spent_minutes,
      b.pct_complete,
      b.date_completed,
      b.application_id,
      b.app_id,
      b.app_first_name,
      b.app_last_name,
      b.app_phone,
      b.license_status,
      b.license_progress,
      b.assigned_agent_id,
      b.days_since_login,
      CASE
          WHEN ((b.last_login IS NULL) OR (COALESCE(b.time_spent_minutes, 0) = 0)) THEN 'never_started'::text
          WHEN (b.days_since_login <= 3) THEN 'active'::text
          WHEN (b.days_since_login <= 10) THEN 'recent'::text
          ELSE 'stalled'::text
      END AS xcel_state
   FROM base b
)
SELECT w.student_email,
    w.student_name,
    w.last_login,
    w.xcel_state,
    w.days_since_login,
    w.application_id,
    w.app_first_name,
    w.app_last_name,
    w.app_phone,
    w.license_status,
    w.license_progress,
    ag.display_name AS manager_name,
    pr.avatar_url AS manager_avatar,
    CASE w.xcel_state
        WHEN 'never_started'::text THEN 'Nudge to start course'::text
        WHEN 'stalled'::text THEN 'Reach out - 10+ days idle'::text
        WHEN 'recent'::text THEN 'Check in this week'::text
        WHEN 'active'::text THEN 'On pace'::text
        ELSE NULL::text
    END AS action_label
FROM with_state w
LEFT JOIN agents ag ON ag.id = (
  SELECT m.canonical_agent_id FROM v_agent_canonical_map m WHERE m.agent_id = w.assigned_agent_id
)
LEFT JOIN profiles pr ON pr.user_id = ag.user_id;
