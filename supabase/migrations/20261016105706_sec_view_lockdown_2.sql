-- PL-SEC-VIEW-LOCKDOWN-2 (2026-10-16): close the owner-rights views every signed-in login could read.
--
-- A sweep as an applicant login (role agent, no agents row: the least-trusted account) found 103
-- owner-rights views returning rows. Views run with their owner's rights, so each one handed its
-- whole result to any login: insured clients' names with policy numbers (v_schedule_auto_events,
-- v_duplicate_policies), applicants' names, emails and phones (v_cfo_ica_paid_stuck,
-- v_queue_stalled_applications), Stripe customer emails (v_critical_losses_open), Sam's to-do list
-- (v_sam_todo), the list of tables without row security (v_rls_audit), and the CFO and spend views.
--
-- 1. 60 of them are read by nothing in the app or the edge functions (grep of src/ and
--    supabase/functions/, 2026-10-16). Every database function that reads one is SECURITY DEFINER
--    and every view built on one runs as its owner, so revoking the signed-in roles breaks neither.
--    Bots read through bot-sql or the service role, which keep access.
-- 2. 17 are read only by pages whose route admits admins (or admins and managers, or for the book,
--    Sam and Aisha). They keep their exact rows for that audience and return none to anyone else:
--    the definition is wrapped, unchanged, in a security_barrier filter. Database jobs, definer
--    functions and the service role pass the filter (current_user is the owner there).
-- Views that team pages read (leaderboards, roster, culture feed, hierarchy, challenges) are left
-- as they are.

-- 1. No reader in the app: signed-in roles lose access.
revoke all on public.v_agent_crm_active from anon, authenticated;
revoke all on public.v_agent_duplicates from anon, authenticated;
revoke all on public.v_agent_manager_conflicts from anon, authenticated;
revoke all on public.v_agent_status_contradictions from anon, authenticated;
revoke all on public.v_agentlink_auth_health from anon, authenticated;
revoke all on public.v_agents_missing_al_user_id from anon, authenticated;
revoke all on public.v_agents_status_deac_mismatch from anon, authenticated;
revoke all on public.v_alert_sms_truth from anon, authenticated;
revoke all on public.v_apex_contracts_summary from anon, authenticated;
revoke all on public.v_bot_alert_delivery_summary from anon, authenticated;
revoke all on public.v_bulk_backfilled_timestamps from anon, authenticated;
revoke all on public.v_carrier_dormancy_watch from anon, authenticated;
revoke all on public.v_carrier_reroute_plan from anon, authenticated;
revoke all on public.v_cfo_cron_health from anon, authenticated;
revoke all on public.v_conduct_command_center from anon, authenticated;
revoke all on public.v_content_utm_analytics from anon, authenticated;
revoke all on public.v_critical_losses_open from anon, authenticated;
revoke all on public.v_cw_audience_split from anon, authenticated;
revoke all on public.v_cw_kpi_7d from anon, authenticated;
revoke all on public.v_cw_posts_today from anon, authenticated;
revoke all on public.v_cw_quota_streak from anon, authenticated;
revoke all on public.v_cw_recruiting_pipeline from anon, authenticated;
revoke all on public.v_cw_shot_vs_posted from anon, authenticated;
revoke all on public.v_ethos_agent_link_health from anon, authenticated;
revoke all on public.v_funnel_by_source from anon, authenticated;
revoke all on public.v_hire_activity from anon, authenticated;
revoke all on public.v_insuracloud_refusal_verdict from anon, authenticated;
revoke all on public.v_insuracloud_sync_health from anon, authenticated;
revoke all on public.v_interview_capture_reconciliation from anon, authenticated;
revoke all on public.v_interview_match_candidates from anon, authenticated;
revoke all on public.v_launch_readiness from anon, authenticated;
revoke all on public.v_leads_state_coverage from anon, authenticated;
revoke all on public.v_leads_suppression_all from anon, authenticated;
revoke all on public.v_manager_culture_credits from anon, authenticated;
revoke all on public.v_manager_departure_orphan_risk from anon, authenticated;
revoke all on public.v_manager_roster from anon, authenticated;
revoke all on public.v_mentorship_payment_links from anon, authenticated;
revoke all on public.v_mercury_subscription_summary from anon, authenticated;
revoke all on public.v_new_hire_showup from anon, authenticated;
revoke all on public.v_offboarding_preservation from anon, authenticated;
revoke all on public.v_outreach_daily_cap_check from anon, authenticated;
revoke all on public.v_production_truth_freshness from anon, authenticated;
revoke all on public.v_queue_active_no_first_sale from anon, authenticated;
revoke all on public.v_queue_hired_no_onboarding from anon, authenticated;
revoke all on public.v_queue_interviews_no_outcome from anon, authenticated;
revoke all on public.v_readymode_lead_source_roi from anon, authenticated;
revoke all on public.v_readymode_pipeline_status from anon, authenticated;
revoke all on public.v_recruiting_leaderboard from anon, authenticated;
revoke all on public.v_rls_audit from anon, authenticated;
revoke all on public.v_sam_todo from anon, authenticated;
revoke all on public.v_sam_todo_blocker_source from anon, authenticated;
revoke all on public.v_sam_todo_manual_source from anon, authenticated;
revoke all on public.v_schedule_auto_events from anon, authenticated;
revoke all on public.v_seminar_next_slots from anon, authenticated;
revoke all on public.v_sms_receipt_truth from anon, authenticated;
revoke all on public.v_stripe_ingest_freshness from anon, authenticated;
revoke all on public.v_sync_health from anon, authenticated;
revoke all on public.v_team_daily_numbers from anon, authenticated;
revoke all on public.v_team_hierarchy from anon, authenticated;
revoke all on public.v_today_dashboard from anon, authenticated;

-- 2. Read by admin / manager / full-book pages: same rows for that audience, none for anyone else.
-- v_cfo_agent_activation_watch: admin page only
create or replace view public.v_cfo_agent_activation_watch with (security_barrier = true) as
select * from (
SELECT (( SELECT count(*) AS count
           FROM agents
          WHERE agents.is_deactivated IS NOT TRUE))::integer AS active_total,
    (( SELECT count(*) AS count
           FROM agents a
          WHERE a.is_deactivated IS NOT TRUE AND NOT (EXISTS ( SELECT 1
                   FROM deals d
                  WHERE d.agent_id = a.id AND d.posted_at > (now() - '30 days'::interval)))))::integer AS active_no_deals_30d,
    (( SELECT count(DISTINCT deals.agent_id) AS count
           FROM deals
          WHERE deals.posted_at > (now() - '30 days'::interval)))::integer AS producing_30d,
    ( SELECT json_agg(json_build_object('agent_id', a.id, 'name', a.display_name, 'agent_code', a.agent_code)) AS json_agg
           FROM agents a
          WHERE a.is_deactivated IS NOT TRUE AND NOT (EXISTS ( SELECT 1
                   FROM deals d
                  WHERE d.agent_id = a.id AND d.posted_at > (now() - '30 days'::interval)))
         LIMIT 100) AS idle_agents,
    now() AS as_of
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_cfo_dup_charge_watch: admin page only
create or replace view public.v_cfo_dup_charge_watch with (security_barrier = true) as
select * from (
SELECT count(*) FILTER (WHERE flag_duplicate_window)::integer AS dup_window_count,
    count(*) FILTER (WHERE flag_name_mismatch)::integer AS name_mismatch_count,
    count(*) FILTER (WHERE flag_unusual_amount)::integer AS unusual_amount_count,
    count(*) FILTER (WHERE flag_unlinked)::integer AS unlinked_count,
    json_agg(json_build_object('stripe_charge_id', stripe_charge_id, 'amount_usd', amount_usd, 'email', customer_email, 'customer', customer_name, 'resolved_agent', resolved_agent_name, 'charged_at', charged_at, 'flags', json_build_object('dup_window', flag_duplicate_window, 'name_mismatch', flag_name_mismatch, 'unusual', flag_unusual_amount, 'unlinked', flag_unlinked)) ORDER BY charged_at DESC) FILTER (WHERE flag_duplicate_window OR flag_name_mismatch OR flag_unusual_amount OR flag_unlinked) AS anomalies,
    now() AS as_of
   FROM v_charge_anomalies
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_cfo_ica_paid_stuck: applicants' names, emails and phones (Finances, admin)
create or replace view public.v_cfo_ica_paid_stuck with (security_barrier = true) as
select * from (
SELECT count(*)::integer AS stuck_count,
    count(*) FILTER (WHERE status::text = 'paid'::text)::integer AS in_paid_status,
    count(*) FILTER (WHERE status::text = 'new'::text)::integer AS in_new_status,
    count(*) FILTER (WHERE status::text = 'contracting'::text)::integer AS in_contracting,
    count(*) FILTER (WHERE status::text = 'rejected'::text)::integer AS in_rejected_after_paid,
    min(ica_paid_at) AS oldest_stuck_paid_at,
    json_agg(json_build_object('name', (first_name || ' '::text) || last_name, 'email', email, 'phone', phone, 'state', state, 'paid_at', ica_paid_at, 'status', status::text) ORDER BY ica_paid_at) FILTER (WHERE ica_paid_at IS NOT NULL) AS stuck_list,
    now() AS as_of
   FROM applications
  WHERE ica_paid = true AND (status::text <> ALL (ARRAY['approved'::text, 'onboarding'::text, 'producing'::text]))
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_carrier_premium_data_gap: admin page only
create or replace view public.v_carrier_premium_data_gap with (security_barrier = true) as
select * from (
WITH stats AS (
         SELECT carrier_policies.carrier_name,
            count(*)::integer AS policies,
            count(*) FILTER (WHERE carrier_policies.annual_premium IS NULL OR carrier_policies.annual_premium = 0::numeric)::integer AS zero_premium_policies,
            count(*) FILTER (WHERE carrier_policies.face_amount IS NULL OR carrier_policies.face_amount = 0::numeric)::integer AS zero_face_policies,
            count(*) FILTER (WHERE carrier_policies.matched_deal_id IS NULL)::integer AS no_internal_deal,
            count(*) FILTER (WHERE carrier_policies.policy_status = ANY (ARRAY['Active'::text, 'Approved'::text, 'Issued'::text, 'Paid'::text]))::integer AS live_policies,
            count(*) FILTER (WHERE carrier_policies.policy_status ~~* '%lapse%'::text OR carrier_policies.policy_status ~~* '%pending%'::text)::integer AS lapse_pending_policies,
            COALESCE(sum(carrier_policies.annual_premium), 0::numeric) AS premium_captured,
            min(carrier_policies.imported_at) AS first_import,
            max(carrier_policies.imported_at) AS last_import
           FROM carrier_policies
          GROUP BY carrier_policies.carrier_name
        )
 SELECT carrier_name,
    policies,
    zero_premium_policies,
    zero_face_policies,
    no_internal_deal,
    live_policies,
    lapse_pending_policies,
    premium_captured,
    round(live_policies::numeric * 1000.0 * 0.25, 2) AS est_residual_at_risk_usd_annual,
        CASE
            WHEN zero_premium_policies = policies THEN '🔴 100% PREMIUM MISSING'::text
            WHEN (zero_premium_policies::numeric / policies::numeric) > 0.5 THEN '🟠 >50% PREMIUM MISSING'::text
            WHEN zero_premium_policies > 0 THEN '🟡 SOME PREMIUM MISSING'::text
            ELSE '🟢 PREMIUM CAPTURED'::text
        END AS status,
    first_import,
    last_import
   FROM stats
  ORDER BY zero_premium_policies DESC, policies DESC
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_data_quality_dashboard: admin page only
create or replace view public.v_data_quality_dashboard with (security_barrier = true) as
select * from (
SELECT 'agent_status_contradicts_production'::text AS issue,
    ( SELECT count(*) AS count
           FROM v_agent_status_contradictions
          WHERE v_agent_status_contradictions.verdict = 'flag_is_wrong'::text) AS n,
    'agents flagged inactive/deactivated who wrote a deal in the last 14 days'::text AS detail
UNION ALL
 SELECT 'duplicate_active_agent_names'::text AS issue,
    count(*) AS n,
    'display names held by more than one ACTIVE agent row — production and comp split across the duplicates'::text AS detail
   FROM ( SELECT agents.display_name
           FROM agents
          WHERE agents.is_deactivated IS NOT TRUE AND agents.display_name IS NOT NULL
          GROUP BY agents.display_name
         HAVING count(*) > 1) d
UNION ALL
 SELECT 'agents_sharing_agentlink_id'::text AS issue,
    count(*) AS n,
    'AgentLink user ids claimed by more than one active agent — deals can attribute to the wrong person'::text AS detail
   FROM ( SELECT agents.al_user_id
           FROM agents
          WHERE agents.al_user_id IS NOT NULL AND agents.is_deactivated IS NOT TRUE
          GROUP BY agents.al_user_id
         HAVING count(*) > 1) dup
UNION ALL
 SELECT 'interview_events_undispositioned_past'::text AS issue,
    count(*) AS n,
    'past interviews with no outcome recorded'::text AS detail
   FROM interview_events
  WHERE interview_events.scheduled_at < now() AND interview_events.outcome IS NULL AND interview_events.canceled_at IS NULL
UNION ALL
 SELECT 'prospects_no_person_record'::text AS issue,
    count(*) AS n,
    'live Calendly bookings not linked to any application/agent'::text AS detail
   FROM interview_events
  WHERE interview_events.application_id IS NULL AND interview_events.agent_id IS NULL AND interview_events.canceled_at IS NULL
UNION ALL
 SELECT 'book_rows_unattributed'::text AS issue,
    count(*) AS n,
    'book rows with no agent_id — visible on the leaderboard by name, but invisible to manager rollup, comp tiers and in-force views'::text AS detail
   FROM agentlink_book
  WHERE agentlink_book.agent_id IS NULL
UNION ALL
 SELECT 'interview_events_orphan_link'::text AS issue,
    count(*) AS n,
    'interview_events.application_id pointing to a missing application'::text AS detail
   FROM interview_events e
  WHERE e.application_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM applications a
          WHERE a.id = e.application_id))
UNION ALL
 SELECT 'applications_assigned_to_missing_agent'::text AS issue,
    count(*) AS n,
    'applications.assigned_agent_id pointing to a missing agent'::text AS detail
   FROM applications ap
  WHERE ap.assigned_agent_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM agents a
          WHERE a.id = ap.assigned_agent_id))
UNION ALL
 SELECT 'applications_no_owner_no_nextaction'::text AS issue,
    count(*) AS n,
    'live applications with no assigned agent and no next action'::text AS detail
   FROM applications ap
  WHERE ap.terminated_at IS NULL AND COALESCE(ap.is_duplicate, false) = false AND ap.assigned_agent_id IS NULL AND ap.next_action IS NULL AND ap.next_step_due_at IS NULL
UNION ALL
 SELECT 'applications_flagged_duplicate'::text AS issue,
    count(*) AS n,
    'applications.is_duplicate = true (needs merge/adjudication)'::text AS detail
   FROM applications
  WHERE applications.is_duplicate IS TRUE
UNION ALL
 SELECT 'agents_hired_licensed_no_agentlink'::text AS issue,
    count(*) AS n,
    'licensed active agents with no AgentLink user id — cannot be credited from the book'::text AS detail
   FROM agents a
  WHERE a.is_deactivated IS NOT TRUE AND a.license_status::text = 'licensed'::text AND a.al_user_id IS NULL AND a.insuracloud_user_id IS NULL
UNION ALL
 SELECT 'agents_orphaned_no_manager'::text AS issue,
    count(*) AS n,
    'active agents with no manager AND no direct reports — genuinely unattached (hierarchy tops correctly excluded)'::text AS detail
   FROM agents a
  WHERE a.is_deactivated IS NOT TRUE AND a.manager_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM agents r
          WHERE r.manager_id = a.id))
UNION ALL
 SELECT 'book_unattributed_inforce'::text AS issue,
    count(*) AS n,
    'in-force book rows with no agent_id'::text AS detail
   FROM agentlink_book b
  WHERE (b.status = ANY (ARRAY['Active'::text, 'Issued'::text])) AND b.agent_id IS NULL
UNION ALL
 SELECT 'book_effective_date_implausible'::text AS issue,
    count(*) AS n,
    'book rows effective more than 120 days out — beyond a normal scheduled draft'::text AS detail
   FROM agentlink_book
  WHERE agentlink_book.effective_date > (CURRENT_DATE + 120)
UNION ALL
 SELECT 'milestone_columns_bulk_backfilled'::text AS issue,
    count(*) AS n,
    'milestone timestamp columns stamped by a bulk UPDATE instead of captured per event — any funnel metric built on them is wrong'::text AS detail
   FROM v_bulk_backfilled_timestamps
  WHERE v_bulk_backfilled_timestamps.verdict = 'bulk_backfilled'::text
UNION ALL
 SELECT 'rls_overbroad_write_policies'::text AS issue,
    count(*) AS n,
    'PERMISSIVE write/delete RLS policies granting every authenticated user access to a whole table, with no restrictive policy clamping them'::text AS detail
   FROM v_rls_overbroad_write_policies
  WHERE v_rls_overbroad_write_policies.is_mitigated IS NOT TRUE
  ORDER BY 2 DESC
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_client_error_summary: admin page only
create or replace view public.v_client_error_summary with (security_barrier = true) as
select * from (
WITH classified AS (
         SELECT error_logs.id,
            error_logs.created_at,
            error_logs.user_id,
            error_logs.url,
            error_logs.error_message,
                CASE
                    WHEN error_logs.error_message ~~* '%dynamically imported module%'::text OR error_logs.error_message ~~* '%Loading chunk%'::text OR error_logs.error_message ~~* '%Importing a module script failed%'::text OR error_logs.error_message ~~* '%error loading dynamically imported%'::text THEN 'stale_deploy'::text
                    ELSE 'crash'::text
                END AS error_class
           FROM error_logs
        )
 SELECT error_class,
    "left"(error_message, 160) AS error_message,
    count(*) AS hits,
    count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS affected_users,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen,
    (array_agg(url ORDER BY created_at DESC))[1] AS latest_url
   FROM classified
  WHERE created_at > (now() - '30 days'::interval)
  GROUP BY error_class, ("left"(error_message, 160))
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- automation_health: admin page only
create or replace view public.automation_health with (security_barrier = true) as
select * from (
WITH recent AS (
         SELECT l.job_name,
            max(l.triggered_at) AS last_run,
            count(*) FILTER (WHERE l.status = 'success'::text AND l.triggered_at > (now() - '24:00:00'::interval)) AS success_count_24h,
            count(*) FILTER (WHERE l.status = 'error'::text AND l.triggered_at > (now() - '24:00:00'::interval)) AS error_count_24h,
            count(*) FILTER (WHERE l.triggered_at > (now() - '24:00:00'::interval)) AS total_24h,
            avg(l.duration_ms) FILTER (WHERE l.status = 'success'::text AND l.triggered_at > (now() - '24:00:00'::interval)) AS avg_duration_ms,
            max(l.error) FILTER (WHERE l.status = 'error'::text AND l.triggered_at > (now() - '24:00:00'::interval)) AS last_error
           FROM automation_run_log l
          WHERE l.triggered_at > (now() - '3 days'::interval)
          GROUP BY l.job_name
        )
 SELECT job_name,
    last_run,
    success_count_24h,
    error_count_24h,
    total_24h,
    round(avg_duration_ms)::integer AS avg_duration_ms,
    last_error,
        CASE
            WHEN last_run < (now() - '2 days'::interval) THEN 'stale'::text
            WHEN error_count_24h > 0 AND success_count_24h = 0 THEN 'broken'::text
            WHEN error_count_24h > 0 THEN 'flaky'::text
            ELSE 'healthy'::text
        END AS health_status
   FROM recent r
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_telegram_dashboard: admin page only
create or replace view public.v_telegram_dashboard with (security_barrier = true) as
select * from (
SELECT ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE NOT telegram_users.opt_out_all) AS total_users,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE NOT telegram_users.opt_out_all AND telegram_users.last_active_at > (now() - '24:00:00'::interval)) AS dau,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE NOT telegram_users.opt_out_all AND telegram_users.last_active_at > (now() - '7 days'::interval)) AS wau,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'lobby'::text AND NOT telegram_users.opt_out_all) AS lobby,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'applied_unpaid'::text AND NOT telegram_users.opt_out_all) AS applied_unpaid,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'applied_paid'::text AND NOT telegram_users.opt_out_all) AS applied_paid,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'manager_call_scheduled'::text AND NOT telegram_users.opt_out_all) AS call_scheduled,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'seminar_attended'::text AND NOT telegram_users.opt_out_all) AS post_seminar,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'pre_license_studying'::text AND NOT telegram_users.opt_out_all) AS studying,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'exam_scheduled'::text AND NOT telegram_users.opt_out_all) AS exam_scheduled,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'licensed'::text AND NOT telegram_users.opt_out_all) AS licensed_unhired,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'hired'::text AND NOT telegram_users.opt_out_all) AS hired,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage ~~ 'onboarding%'::text AND NOT telegram_users.opt_out_all) AS onboarding,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.stage = 'active_agent'::text AND NOT telegram_users.opt_out_all) AS active_agents,
    ( SELECT count(*)::integer AS count
           FROM telegram_users
          WHERE telegram_users.last_active_at < (now() - '7 days'::interval) AND (telegram_users.stage <> ALL (ARRAY['active_agent'::text, 'opt_out'::text])) AND NOT telegram_users.opt_out_all) AS stale_7d,
    ( SELECT count(*)::integer AS count
           FROM telegram_escalations
          WHERE telegram_escalations.resolved_at IS NULL) AS open_escalations,
    ( SELECT count(*)::integer AS count
           FROM telegram_scheduled_messages
          WHERE telegram_scheduled_messages.status = 'pending'::text AND telegram_scheduled_messages.scheduled_at <= (now() + '24:00:00'::interval)) AS upcoming_nudges_24h,
    ( SELECT count(*)::integer AS count
           FROM telegram_messages
          WHERE telegram_messages.direction = 'inbound'::text AND telegram_messages.sent_at > (now() - '24:00:00'::interval)) AS inbound_24h,
    ( SELECT count(*)::integer AS count
           FROM telegram_messages
          WHERE telegram_messages.direction = 'outbound'::text AND telegram_messages.sent_at > (now() - '24:00:00'::interval)) AS outbound_24h
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_telegram_funnel: admin page only
create or replace view public.v_telegram_funnel with (security_barrier = true) as
select * from (
WITH base AS (
         SELECT telegram_users.stage,
            count(*)::integer AS c
           FROM telegram_users
          WHERE NOT telegram_users.opt_out_all
          GROUP BY telegram_users.stage
        )
 SELECT stage,
    c AS count,
    round(100.0 * c::numeric / NULLIF(( SELECT sum(base_1.c) AS sum
           FROM base base_1), 0)::numeric, 1) AS pct
   FROM base
  ORDER BY c DESC
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_strike_trend: admin page only
create or replace view public.v_strike_trend with (security_barrier = true) as
select * from (
WITH days AS (
         SELECT generate_series((CURRENT_DATE - '29 days'::interval)::date::timestamp with time zone, CURRENT_DATE::timestamp with time zone, '1 day'::interval)::date AS d
        )
 SELECT d.d AS day,
    count(s.*) FILTER (WHERE s.severity = 'warning'::strike_severity) AS warnings,
    count(s.*) FILTER (WHERE s.severity = 'minor'::strike_severity) AS minor,
    count(s.*) FILTER (WHERE s.severity = 'major'::strike_severity) AS major,
    count(s.*) FILTER (WHERE s.severity = 'terminal'::strike_severity) AS terminal,
    count(s.*) AS total
   FROM days d
     LEFT JOIN agent_strikes s ON date_trunc('day'::text, s.issued_at)::date = d.d
  GROUP BY d.d
  ORDER BY d.d
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_new_hires_activation: admin page only
create or replace view public.v_new_hires_activation with (security_barrier = true) as
select * from (
SELECT a.id AS agent_id,
    COALESCE(NULLIF(a.display_name, ''::text), 'Unnamed'::text) AS display_name,
    COALESCE(a.contracted_at, a.created_at) AS hire_date,
    GREATEST(0, EXTRACT(day FROM now() - COALESCE(a.contracted_at, a.created_at))::integer) AS days_since_hire,
    a.onboarding_stage::text AS onboarding_stage,
    a.license_status::text AS license_status,
    a.manager_id,
    m.display_name AS manager_name,
    a.al_user_id IS NOT NULL AS agentlink_linked,
    a.next_action_text,
    a.next_action_due_at
   FROM agents a
     LEFT JOIN agents m ON m.id = a.manager_id
  WHERE a.license_status = 'licensed'::license_status AND a.first_deal_at IS NULL AND COALESCE(a.is_deactivated, false) = false AND COALESCE(a.is_inactive, false) = false AND COALESCE(a.contracted_at, a.created_at) >= (now() - '60 days'::interval)
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_readymode_ingest_health: admin page only
create or replace view public.v_readymode_ingest_health with (security_barrier = true) as
select * from (
SELECT current_mode,
    webhook_enabled,
    pull_enabled,
    last_ingest_at,
    EXTRACT(epoch FROM now() - last_ingest_at)::integer AS seconds_since_last_ingest,
    ( SELECT count(*)::integer AS count
           FROM readymode_dialer_calls c
          WHERE c.imported_at >= (now() - '24:00:00'::interval)) AS ingest_24h,
    ( SELECT count(*) AS count
           FROM readymode_dialer_calls) AS ingest_total,
    last_heartbeat_at,
    EXTRACT(epoch FROM now() - last_heartbeat_at)::integer AS seconds_since_heartbeat,
    last_error,
    last_error_at,
        CASE
            WHEN current_mode = 'AWAITING_WEBHOOK'::text THEN 'awaiting_creds'::text
            WHEN last_ingest_at IS NULL THEN 'never_ingested'::text
            WHEN last_ingest_at < (now() - '02:00:00'::interval) AND EXTRACT(dow FROM (now() AT TIME ZONE 'America/Phoenix'::text)) >= 1::numeric AND EXTRACT(dow FROM (now() AT TIME ZONE 'America/Phoenix'::text)) <= 5::numeric AND EXTRACT(hour FROM (now() AT TIME ZONE 'America/Phoenix'::text)) >= 8::numeric AND EXTRACT(hour FROM (now() AT TIME ZONE 'America/Phoenix'::text)) <= 20::numeric THEN 'DARK_DURING_BUSINESS_HOURS'::text
            WHEN last_ingest_at < (now() - '24:00:00'::interval) THEN 'stale_24h'::text
            ELSE 'healthy'::text
        END AS status
   FROM readymode_bot_state s
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_social_latest: admin page only
create or replace view public.v_social_latest with (security_barrier = true) as
select * from (
SELECT DISTINCT ON (platform, handle) platform,
    handle,
    followers,
    following,
    posts_total,
    engagement_rate,
    reach_7d,
    views_7d,
    growth_7d,
    payload,
    source,
    taken_at
   FROM social_snapshots
  ORDER BY platform, handle, taken_at DESC
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_queue_stalled_applications: 678 applicants by name (Stale Recovery, admins and managers)
create or replace view public.v_queue_stalled_applications with (security_barrier = true) as
select * from (
SELECT ap.id AS application_id,
    (ap.first_name || ' '::text) || ap.last_name AS applicant,
    ap.status::text AS app_status,
    ap.next_step_stage_key,
    ap.license_status::text AS license_status,
    COALESCE(ag.display_name, 'Sam James (default)'::text) AS owner,
    ap.recruiter_id,
    ap.assigned_agent_id,
    COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at) AS last_action_at,
    COALESCE(NULLIF(ap.next_action, ''::text), 'Re-contact: '::text || COALESCE(ap.next_step_stage_key, 'applied'::text)) AS next_action,
    COALESCE(ap.next_action_due_at, ap.next_step_due_at) AS due_at,
    (EXTRACT(epoch FROM now() - COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at)) / 86400::numeric)::numeric(8,1) AS days_stuck,
        CASE
            WHEN ap.license_status::text = 'licensed'::text THEN 1
            WHEN ap.next_step_stage_key = ANY (ARRAY['passed_exam'::text, 'finished_prelicense'::text]) THEN 2
            WHEN ap.next_step_stage_key = 'started_prelicense'::text THEN 3
            WHEN ap.next_step_stage_key = 'contacted'::text THEN 4
            ELSE 5
        END AS priority,
    ap.is_ghosted,
    ap.lead_score,
    ap.created_at
   FROM v_applications_real ap
     LEFT JOIN agents ag ON ag.id = ap.assigned_agent_id
  WHERE ap.terminated_at IS NULL AND COALESCE(ap.is_duplicate, false) = false AND (ap.next_step_stage_key = ANY (ARRAY['applied'::text, 'contacted'::text, 'started_prelicense'::text, 'finished_prelicense'::text, 'passed_exam'::text])) AND (COALESCE(ap.next_action_due_at, ap.next_step_due_at) < now() OR ap.next_action_due_at IS NULL AND ap.next_step_due_at IS NULL AND COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at) < (now() - '14 days'::interval))
  ORDER BY (
        CASE
            WHEN ap.license_status::text = 'licensed'::text THEN 1
            WHEN ap.next_step_stage_key = ANY (ARRAY['passed_exam'::text, 'finished_prelicense'::text]) THEN 2
            WHEN ap.next_step_stage_key = 'started_prelicense'::text THEN 3
            WHEN ap.next_step_stage_key = 'contacted'::text THEN 4
            ELSE 5
        END), ((EXTRACT(epoch FROM now() - COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at)) / 86400::numeric)::numeric(8,1)) DESC
) gated
where (select public.api_is_admin_role()) or public.has_role((select auth.uid()), 'manager'::public.app_role) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_application_conversion_funnel: applicant funnel counts (Stale Recovery, admins and managers)
create or replace view public.v_application_conversion_funnel with (security_barrier = true) as
select * from (
SELECT count(*) AS total,
    count(*) FILTER (WHERE status::text = 'new'::text) AS new_count,
    count(*) FILTER (WHERE contacted_at IS NOT NULL) AS contacted_count,
    count(*) FILTER (WHERE ica_paid_at IS NOT NULL) AS paid_count,
    count(*) FILTER (WHERE qualified_at IS NOT NULL) AS qualified_count,
    count(*) FILTER (WHERE status::text = ANY (ARRAY['approved'::text, 'attended'::text, 'producing'::text])) AS approved_count,
    count(*) FILTER (WHERE status::text = ANY (ARRAY['rejected'::text, 'disqualified'::text])) AS rejected_count,
    count(*) FILTER (WHERE created_at > (now() - '7 days'::interval)) AS last_7d,
    count(*) FILTER (WHERE created_at > (now() - '30 days'::interval)) AS last_30d,
        CASE
            WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE ica_paid_at IS NOT NULL)::numeric / count(*)::numeric, 1)
            ELSE 0::numeric
        END AS pct_paid_of_total,
        CASE
            WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE status::text = ANY (ARRAY['approved'::text, 'attended'::text, 'producing'::text]))::numeric / count(*)::numeric, 1)
            ELSE 0::numeric
        END AS pct_approved_of_total
   FROM v_applications_real applications
) gated
where (select public.api_is_admin_role()) or public.has_role((select auth.uid()), 'manager'::public.app_role) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_duplicate_policies: client names and policy numbers from carrier_policies (Book Reconciliation); the book is Sam and Aisha only
create or replace view public.v_duplicate_policies with (security_barrier = true) as
select * from (
WITH grouped AS (
         SELECT lower(TRIM(BOTH FROM COALESCE(carrier_policies.client_first_name, ''::text))) AS fn_lc,
            lower(TRIM(BOTH FROM COALESCE(carrier_policies.client_last_name, ''::text))) AS ln_lc,
            carrier_policies.carrier_name,
            array_agg(carrier_policies.id ORDER BY carrier_policies.imported_at) AS ids,
            array_agg(carrier_policies.policy_number ORDER BY carrier_policies.imported_at) AS policy_nums,
            array_agg(carrier_policies.policy_status ORDER BY carrier_policies.imported_at) AS statuses,
            count(*)::integer AS dup_count
           FROM carrier_policies
          WHERE carrier_policies.policy_number IS NOT NULL
          GROUP BY (lower(TRIM(BOTH FROM COALESCE(carrier_policies.client_first_name, ''::text)))), (lower(TRIM(BOTH FROM COALESCE(carrier_policies.client_last_name, ''::text)))), carrier_policies.carrier_name
         HAVING count(*) > 1
        )
 SELECT fn_lc,
    ln_lc,
    carrier_name,
    dup_count,
    ids,
    policy_nums,
    statuses,
    ( SELECT COALESCE(sum(cp.annual_premium), 0::numeric) AS "coalesce"
           FROM carrier_policies cp
          WHERE (cp.id = ANY (grouped.ids)) AND (lower(cp.policy_status) <> ALL (ARRAY['lapsed'::text, 'lapse pending'::text, 'cancelled'::text, 'withdrawn'::text, 'declined'::text, 'not taken'::text]))) AS live_premium_tied_up
   FROM grouped
) gated
where (select public.api_is_full_reader()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_agent_quality_score: per-agent book quality (Book Reconciliation, admins and managers)
create or replace view public.v_agent_quality_score with (security_barrier = true) as
select * from (
WITH agent_deals AS (
         SELECT COALESCE(m.canonical_agent_id, d.agent_id) AS agent_id,
            count(*)::integer AS deal_count,
            count(*) FILTER (WHERE d.policy_number IS NULL OR length(TRIM(BOTH FROM d.policy_number)) = 0)::integer AS no_pnum_count,
            count(*) FILTER (WHERE d.status = ANY (ARRAY['lapsed'::text, 'cancelled'::text, 'withdrawn'::text]))::integer AS dead_count
           FROM deals d
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
          WHERE d.agent_id IS NOT NULL
          GROUP BY (COALESCE(m.canonical_agent_id, d.agent_id))
        ), agent_carrier AS (
         SELECT COALESCE(m.canonical_agent_id, cp.agent_id) AS agent_id,
            count(*)::integer AS carrier_count,
            count(*) FILTER (WHERE lower(cp.policy_status) = ANY (ARRAY['lapsed'::text, 'lapse pending'::text, 'cancelled'::text, 'withdrawn'::text, 'declined'::text, 'not taken'::text]))::integer AS carrier_dead_count
           FROM carrier_policies cp
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = cp.agent_id
          WHERE cp.agent_id IS NOT NULL
          GROUP BY (COALESCE(m.canonical_agent_id, cp.agent_id))
        ), ghosts AS (
         SELECT COALESCE(m.canonical_agent_id, v_ghost_deals.agent_id) AS agent_id,
            count(*)::integer AS ghost_count
           FROM v_ghost_deals
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = v_ghost_deals.agent_id
          WHERE v_ghost_deals.flag_ghost = true
          GROUP BY (COALESCE(m.canonical_agent_id, v_ghost_deals.agent_id))
        )
 SELECT a.id AS agent_id,
    COALESCE(a.display_name, p.full_name) AS agent_name,
    a.agent_code,
    COALESCE(ad.deal_count, 0) AS deal_count,
    COALESCE(ad.no_pnum_count, 0) AS no_policy_num_count,
    COALESCE(g.ghost_count, 0) AS ghost_deal_count,
    COALESCE(ad.dead_count, 0) AS dead_deal_count,
    COALESCE(ac.carrier_count, 0) AS carrier_book_count,
    COALESCE(ac.carrier_dead_count, 0) AS carrier_dead_count,
    GREATEST(0::numeric, LEAST(100::numeric, 100::numeric - 20::numeric *
        CASE
            WHEN COALESCE(ad.deal_count, 0) > 0 THEN COALESCE(g.ghost_count, 0)::numeric / ad.deal_count::numeric
            ELSE 0::numeric
        END - 30::numeric *
        CASE
            WHEN COALESCE(ad.deal_count, 0) > 0 THEN COALESCE(ad.no_pnum_count, 0)::numeric / ad.deal_count::numeric
            ELSE 0::numeric
        END - 25::numeric *
        CASE
            WHEN COALESCE(ad.deal_count, 0) > 0 THEN COALESCE(ad.dead_count, 0)::numeric / ad.deal_count::numeric
            ELSE 0::numeric
        END))::integer AS quality_score
   FROM agents a
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN agent_deals ad ON ad.agent_id = a.id
     LEFT JOIN agent_carrier ac ON ac.agent_id = a.id
     LEFT JOIN ghosts g ON g.agent_id = a.id
  WHERE a.canonical_agent_id IS NULL AND (COALESCE(ad.deal_count, 0) + COALESCE(ac.carrier_count, 0)) > 0
) gated
where (select public.api_is_admin_role()) or public.has_role((select auth.uid()), 'manager'::public.app_role) or current_user in ('postgres', 'service_role', 'supabase_admin');

