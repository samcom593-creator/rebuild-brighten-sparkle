-- Head-to-toe audit 2026-08-27: 6 SECURITY DEFINER views granted to `authenticated`
-- returned ALL rows to any logged-in agent (strikes, charge anomalies, access
-- violations, applicant overview, duplicate candidates, recruiting inbox) —
-- HR/PII exposure agent-to-agent. Wrap each in a staff guard. auth.uid() IS NULL
-- lets the SERVICE ROLE (edge fns, cron, apex-doctor) keep full access; a
-- logged-in non-staff user (agent) is blocked.

create or replace view public.v_strike_summary as select _g.* from (  SELECT a.id AS agent_id,
    COALESCE(a.display_name, p.full_name, u.email::text, 'Unknown'::text) AS agent_name,
    a.agent_code,
    count(s.*) FILTER (WHERE s.status = 'active'::strike_status) AS active_count,
    count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'warning'::strike_severity) AS active_warnings,
    count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'minor'::strike_severity) AS active_minor,
    count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'major'::strike_severity) AS active_major,
    count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'terminal'::strike_severity) AS active_terminal,
    count(s.*) FILTER (WHERE s.status = 'resolved'::strike_status) AS resolved_count,
    count(s.*) AS total_count,
    max(s.issued_at) FILTER (WHERE s.status = 'active'::strike_status) AS most_recent_active_at,
        CASE
            WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'terminal'::strike_severity) > 0 THEN 'terminal'::text
            WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'major'::strike_severity) >= 3 THEN 'review_required'::text
            WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'major'::strike_severity) > 0 THEN 'on_notice'::text
            WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status) > 0 THEN 'flagged'::text
            ELSE 'clear'::text
        END AS standing
   FROM agents a
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN auth.users u ON u.id = a.user_id
     LEFT JOIN agent_strikes s ON (s.agent_id IN ( SELECT m.agent_id
           FROM v_agent_canonical_map m
          WHERE m.canonical_agent_id = a.id))
  WHERE a.canonical_agent_id IS NULL
  GROUP BY a.id, a.display_name, p.full_name, u.email, a.agent_code ) _g where public.is_agency_staff() or auth.uid() is null;

create or replace view public.v_charge_anomalies as select _g.* from (  SELECT id,
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
    flag_name_mismatch,
    flag_unlinked,
    flag_unusual_amount,
    flag_duplicate_window
   FROM ( WITH base AS (
                 SELECT lp.id,
                    lp.stripe_charge_id,
                    lp.amount_cents,
                    lp.amount_cents::numeric / 100::numeric AS amount_usd,
                    lp.currency,
                    lp.customer_email,
                    lp.customer_name,
                    lp.description,
                    lp.agent_id_ref,
                    lp.agent_id,
                    lp.charged_at,
                    lp.metadata,
                    ( SELECT m.canonical_agent_id
                           FROM v_agent_canonical_map m
                          WHERE m.agent_id = COALESCE(a_ref.id, a_email.id, a_name.id)
                         LIMIT 1) AS resolved_agent_id,
                    COALESCE(a_ref.display_name, p_ref.full_name, a_email.display_name, p_email.full_name, a_name.display_name, p_name.full_name) AS resolved_agent_name
                   FROM lead_purchases lp
                     LEFT JOIN agents a_ref ON a_ref.id = lp.agent_id
                     LEFT JOIN profiles p_ref ON p_ref.id = a_ref.profile_id
                     LEFT JOIN auth.users u_email ON u_email.email::text = lp.customer_email
                     LEFT JOIN agents a_email ON a_email.user_id = u_email.id
                     LEFT JOIN profiles p_email ON p_email.id = a_email.profile_id
                     LEFT JOIN LATERAL ( SELECT a3.id,
                            a3.display_name,
                            a3.profile_id
                           FROM agents a3
                             JOIN profiles p3 ON p3.id = a3.profile_id
                          WHERE lp.agent_id IS NULL AND u_email.id IS NULL AND lp.customer_name IS NOT NULL AND length(TRIM(BOTH FROM lp.customer_name)) >= 5 AND lower(regexp_replace(TRIM(BOTH FROM lp.customer_name), '\s+'::text, ' '::text, 'g'::text)) = lower(regexp_replace(TRIM(BOTH FROM p3.full_name), '\s+'::text, ' '::text, 'g'::text))
                          ORDER BY a3.created_at DESC
                         LIMIT 1) a_name ON true
                     LEFT JOIN profiles p_name ON p_name.id = a_name.profile_id
                )
         SELECT b.id,
            b.stripe_charge_id,
            b.amount_cents,
            b.amount_usd,
            b.currency,
            b.customer_email,
            b.customer_name,
            b.description,
            b.agent_id_ref,
            b.agent_id,
            b.charged_at,
            b.metadata,
            b.resolved_agent_id,
            b.resolved_agent_name,
            b.customer_name IS NOT NULL AND b.resolved_agent_name IS NOT NULL AND lower(b.customer_name) !~~ (('%'::text || lower(split_part(b.resolved_agent_name, ' '::text, 1))) || '%'::text) AS flag_name_mismatch,
            b.resolved_agent_id IS NULL AS flag_unlinked,
            b.amount_cents <> ALL (ARRAY[10000, 25000]) AS flag_unusual_amount,
            (EXISTS ( SELECT 1
                   FROM lead_purchases lp2
                  WHERE lp2.customer_email = b.customer_email AND lp2.id <> b.id AND abs(EXTRACT(epoch FROM lp2.charged_at - b.charged_at)) < 600::numeric)) AS flag_duplicate_window
           FROM base b) t
  WHERE is_agency_staff() ) _g where public.is_agency_staff() or auth.uid() is null;

create or replace view public.v_agent_access_violations as select _g.* from (  SELECT violation,
    user_id,
    detail
   FROM ( SELECT 'active_agent_locked_out'::text AS violation,
            u.id AS user_id,
            ( SELECT string_agg(((a2.display_name || ' ['::text) || a2.status::text) || ']'::text, ' | '::text) AS string_agg
                   FROM agents a2
                  WHERE a2.user_id = u.id) AS detail
           FROM auth.users u
          WHERE u.banned_until IS NOT NULL AND u.banned_until > now() AND (EXISTS ( SELECT 1
                   FROM agents a
                  WHERE a.user_id = u.id AND a.status = 'active'::agent_status)) AND NOT (EXISTS ( SELECT 1
                   FROM agent_access_suspensions s
                  WHERE s.user_id = u.id))
        UNION ALL
         SELECT 'departed_can_still_sign_in'::text AS text,
            d.user_id,
            d.agent_names
           FROM v_departed_logins_to_revoke d
          WHERE NOT d.already_banned) v
  WHERE is_agency_staff() ) _g where public.is_agency_staff() or auth.uid() is null;

create or replace view public.v_admin_applicant_overview as select _g.* from (  SELECT id,
    created_at,
    first_name,
    last_name,
    email,
    phone,
    state,
    city,
    status,
    license_status,
    licensed_states,
    nipr_number,
    has_insurance_experience,
    years_experience,
    previous_company,
    desired_income,
    referral_source,
    source,
    utm_source,
    utm_medium,
    utm_campaign,
    seminar_date,
    seminar_registered_at,
    seminar_attended_at,
    ica_paid,
    ica_paid_at,
    ica_amount_cents,
    stripe_customer_id,
    assigned_agent_id,
    assigned_recruiter_email,
    assigned_recruiter_code,
    contacted_at,
    qualified_at,
    closed_at,
    notes,
    is_duplicate,
    duplicate_of,
    next_action,
    next_action_due_at,
    tags,
    became_agent_id,
    became_agent_code,
    agent_total_premium,
    agent_total_policies,
    agent_total_earnings,
    last_contact_at,
    total_contacts,
    inbox_message_count,
    days_in_status
   FROM ( SELECT a.id,
            a.created_at,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.state,
            a.city,
            a.status::text AS status,
            a.license_status::text AS license_status,
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
                  WHERE ch.application_id = a.id
                  ORDER BY ch.created_at DESC
                 LIMIT 1) AS last_contact_at,
            ( SELECT count(*)::integer AS count
                   FROM contact_history ch
                  WHERE ch.application_id = a.id) AS total_contacts,
            ( SELECT count(*)::integer AS count
                   FROM inbox_messages im
                  WHERE im.application_id = a.id) AS inbox_message_count,
            EXTRACT(day FROM now() - a.updated_at)::integer AS days_in_status
           FROM v_applications_real a
             LEFT JOIN agents recruiter_ag ON recruiter_ag.id = (( SELECT m.canonical_agent_id
                   FROM v_agent_canonical_map m
                  WHERE m.agent_id = a.assigned_agent_id))
             LEFT JOIN profiles recruiter_p ON recruiter_p.id = recruiter_ag.profile_id
             LEFT JOIN agents becomes_agent ON becomes_agent.id = (( SELECT m.canonical_agent_id
                   FROM v_agent_canonical_map m
                  WHERE m.agent_id = (( SELECT ag2.id
                           FROM agents ag2
                             JOIN profiles p2 ON p2.id = ag2.profile_id
                          WHERE lower(p2.email) = lower(a.email)
                         LIMIT 1))))) t
  WHERE is_agency_staff() ) _g where public.is_agency_staff() or auth.uid() is null;

create or replace view public.v_agent_duplicate_candidates as select _g.* from (  WITH unresolved AS (
         SELECT a_1.id,
            a_1.user_id,
            a_1.profile_id,
            a_1.manager_id,
            a_1.agent_code,
            a_1.license_status,
            a_1.license_states,
            a_1.nipr_number,
            a_1.status,
            a_1.start_date,
            a_1.total_policies,
            a_1.total_premium,
            a_1.total_earnings,
            a_1.created_at,
            a_1.updated_at,
            a_1.verified_at,
            a_1.verified_by,
            a_1.invited_by_manager_id,
            a_1.attendance_status,
            a_1.performance_tier,
            a_1.field_training_started_at,
            a_1.has_training_course,
            a_1.has_dialer_login,
            a_1.has_discord_access,
            a_1.potential_rating,
            a_1.evaluation_result,
            a_1.evaluated_at,
            a_1.evaluated_by,
            a_1.is_deactivated,
            a_1.crm_setup_link,
            a_1.weekly_10k_badges,
            a_1.deactivation_reason,
            a_1.switched_to_manager_id,
            a_1.sort_order,
            a_1.portal_password_set,
            a_1.is_inactive,
            a_1.password_required,
            a_1.display_name,
            a_1.has_production_access,
            a_1.production_unlocked_at,
            a_1.max_recruits,
            a_1.ref_slug,
            a_1.insuracloud_api_token,
            a_1.onboarding_stage,
            a_1.contract_percentage,
            a_1.override_rate,
            a_1.insuracloud_user_id,
            a_1.is_presenting,
            a_1.stage_changed_at,
            a_1.contracted_at,
            a_1.metadata,
            a_1.onboarding_completed_at,
            a_1.first_appointment_at,
            a_1.first_appointment_set_by,
            a_1.first_deal_at,
            a_1.first_10k_at,
            a_1.telegram_chat_id,
            a_1.telegram_opt_out,
            a_1.next_step_stage_key,
            a_1.next_step_due_at,
            a_1.canonical_agent_id,
            a_1.builder_track,
            a_1.agency_owner_qualified_at,
            a_1.next_action_text,
            a_1.next_action_due_at,
            a_1.leader_notes,
            a_1.al_user_id,
            a_1.training_stage_override,
            a_1.training_stage_override_at,
            a_1.training_stage_override_by,
            a_1.source_application_id,
            a_1.license_expires_at,
            a_1.last_license_alert_at,
            a_1.is_manager,
            a_1.license_number,
            a_1.licensed_at,
            a_1.nipr_verified,
            a_1.nipr_verified_at,
            a_1.notes,
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
         SELECT 'al_user_id'::text,
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
         SELECT 'insuracloud_user_id'::text,
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
    ( SELECT count(*)::integer AS count
           FROM deals d
          WHERE d.agent_id = a.id) AS lifetime_deals,
    ( SELECT COALESCE(sum(d.annual_premium), 0::numeric)::numeric(12,2) AS "coalesce"
           FROM deals d
          WHERE d.agent_id = a.id) AS lifetime_alp,
    ( SELECT count(*)::integer AS count
           FROM applications app
          WHERE app.assigned_agent_id = a.id) AS applications_assigned,
    ( SELECT count(*)::integer AS count
           FROM applications app
          WHERE app.referrer_agent_id = a.id) AS applications_referred,
    ( SELECT max(d.created_at) AS max
           FROM deals d
          WHERE d.agent_id = a.id) AS last_deal_at,
    ( SELECT count(*)::integer AS count
           FROM agents dl
          WHERE dl.manager_id = a.id) AS downline_count,
    (( SELECT count(*) AS count
           FROM deals d
          WHERE d.agent_id = a.id)) > 0 OR (( SELECT count(*) AS count
           FROM applications app
          WHERE app.assigned_agent_id = a.id)) > 0 OR (( SELECT count(*) AS count
           FROM agents dl
          WHERE dl.manager_id = a.id)) > 0 OR a.al_user_id IS NOT NULL AS has_production_signal
   FROM sized s
     JOIN agents a ON a.id = s.agent_id
  WHERE s.group_size > 1
  ORDER BY s.dup_reason, s.group_key, a.created_at ) _g where public.is_agency_staff() or auth.uid() is null;

create or replace view public.v_recruiting_inbox as select _g.* from (  SELECT a.id AS application_id,
    own_map.canonical_agent_id AS owner_agent_id,
    COALESCE(p_owner.full_name, 'Unassigned'::text) AS owner_name,
    TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)) AS applicant_name,
    a.phone,
    a.email,
    a.city,
    a.state,
    a.license_status,
    a.created_at AS applied_at,
    EXTRACT(epoch FROM now() - a.created_at) / 3600::numeric AS hours_since_applied,
    a.contacted_at,
    a.next_action,
    a.next_action_at,
        CASE
            WHEN a.contacted_at IS NOT NULL THEN 'contacted'::text
            WHEN a.created_at < (now() - '48:00:00'::interval) THEN 'CRITICAL_48H_PLUS'::text
            WHEN a.created_at < (now() - '24:00:00'::interval) THEN 'overdue_24h'::text
            WHEN a.created_at < (now() - '04:00:00'::interval) THEN 'cooling'::text
            ELSE 'fresh'::text
        END AS urgency,
    a.referral_source
   FROM v_applications_real a
     LEFT JOIN v_agent_canonical_map own_map ON own_map.agent_id = a.assigned_agent_id
     LEFT JOIN agents ag_owner ON ag_owner.id = own_map.canonical_agent_id
     LEFT JOIN profiles p_owner ON p_owner.id = ag_owner.profile_id
  WHERE a.created_at >= (now() - '30 days'::interval) ) _g where public.is_agency_staff() or auth.uid() is null;
