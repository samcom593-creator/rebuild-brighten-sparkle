-- PL-SEC-VIEW-LOCKDOWN-3 (2026-10-16): the rest of the applicant-readable views, decided one by one.
--
-- After sec_view_lockdown_2, 26 owner-rights views still returned rows to an applicant login. 19 are
-- team surfaces or aggregates agents are meant to see (leaderboards, culture feed, recent hires,
-- challenges, health counts); apex-doctor Check #100 now allowlists exactly those by name. The other
-- seven are closed here:
--   * three health views read only by the system-health-autopilot edge function, which uses the
--     service role: signed-in roles lose access;
--   * four staff views wrapped, unchanged, in a security_barrier filter for the audience their pages
--     admit (api_is_staff = admin, manager, VA, VA manager, recruiter).

revoke all on public.v_agentlink_sync_health from anon, authenticated;
revoke all on public.v_cfo_sync_health_watch from anon, authenticated;
revoke all on public.v_sync_pipeline_health from anon, authenticated;

-- v_onboarding_sequence: every agent's onboarding record by name with their AgentLink, InsuraCloud and profile ids (Onboarding Ladder, Recruiting, admin Home: staff and managers)
create or replace view public.v_onboarding_sequence with (security_barrier = true) as
select * from (
WITH a AS (
         SELECT ag.id AS agent_id,
            COALESCE(ag.display_name, p.full_name, ('(agent '::text || "left"(ag.id::text, 8)) || ')'::text) AS agent_name,
            COALESCE(m.display_name, 'unassigned'::text) AS manager,
            ag.license_status::text AS license_status,
            ag.onboarding_stage::text AS onboarding_stage,
            ag.created_at AS hired_at,
            COALESCE(ag.profile_id, p.id) AS profile_id,
            ag.al_user_id,
            ag.insuracloud_user_id,
            ag.contracted_at,
            ag.first_appointment_at,
            ag.has_discord_access,
            ag.has_training_course,
            ag.has_dialer_login,
            ag.field_training_started_at,
            ag.onboarding_completed_at,
            ag.first_deal_at,
            ag.stage_changed_at,
            ag.next_action_due_at,
            fn_agent_onboarding_call_booking(ag.id) IS NOT NULL AS onboarding_call_booked,
            (EXISTS ( SELECT 1
                   FROM messaging_identity_links mil
                  WHERE mil.agent_id = ag.id AND mil.verification_status = 'verified'::text AND mil.revoked_at IS NULL)) AS slack_joined,
            (EXISTS ( SELECT 1
                   FROM contracting_intakes ci
                  WHERE (ci.status = ANY (ARRAY['accepted'::text, 'completed'::text])) AND ci.agent_id = ag.id)) OR fn_agent_contracting_matched_by_npn(ag.id) AS contracting_started,
            (EXISTS ( SELECT 1
                   FROM onboarding_progress op
                  WHERE op.agent_id = ag.id)) AS training_started,
            (( SELECT count(*) AS count
                   FROM onboarding_modules om
                  WHERE om.is_active = true)) > 0 AND (( SELECT count(*) AS count
                   FROM onboarding_progress op
                     JOIN onboarding_modules om ON om.id = op.module_id AND om.is_active = true
                  WHERE op.agent_id = ag.id AND (op.passed = true OR op.completed_at IS NOT NULL))) >= (( SELECT count(*) AS count
                   FROM onboarding_modules om
                  WHERE om.is_active = true)) AS training_complete
           FROM agents ag
             LEFT JOIN profiles p ON p.id = ag.profile_id OR p.user_id = ag.user_id
             LEFT JOIN agents m ON m.id = ag.manager_id
          WHERE ag.is_deactivated IS NOT TRUE AND ag.is_inactive IS NOT TRUE AND ag.canonical_agent_id IS NULL AND NOT is_placeholder_agent(ag.agent_code, ag.user_id)
        ), flags AS (
         SELECT a.agent_id,
            a.agent_name,
            a.manager,
            a.license_status,
            a.onboarding_stage,
            a.hired_at,
            a.profile_id,
            a.al_user_id,
            a.insuracloud_user_id,
            a.contracted_at,
            a.first_appointment_at,
            a.has_discord_access,
            a.has_training_course,
            a.has_dialer_login,
            a.field_training_started_at,
            a.onboarding_completed_at,
            a.first_deal_at,
            a.stage_changed_at,
            a.next_action_due_at,
            a.onboarding_call_booked,
            a.slack_joined,
            a.contracting_started,
            a.training_started,
            a.training_complete,
            a.profile_id IS NOT NULL AS r1,
            a.license_status <> 'licensed'::text OR fn_agent_licensing_ready(a.agent_id) AS r2,
            a.contracted_at IS NOT NULL OR a.contracting_started AS r3,
            a.onboarding_call_booked AS r4,
            a.slack_joined AS r5,
            a.training_started AS r6,
            (a.onboarding_completed_at IS NOT NULL OR a.training_complete) AND a.has_dialer_login IS TRUE AS r7,
            a.first_deal_at IS NOT NULL AS r8
           FROM a
        )
 SELECT agent_id,
    agent_name,
    manager,
    license_status,
    onboarding_stage,
    hired_at,
    profile_id,
    al_user_id,
    insuracloud_user_id,
    contracted_at,
    first_appointment_at,
    has_discord_access,
    has_training_course,
    field_training_started_at,
    onboarding_completed_at,
    first_deal_at,
    stage_changed_at,
    next_action_due_at,
    r1 AS r1_intake,
    r2 AS r2_agentlink,
    r3 AS r3_contracted,
    r4 AS r4_appointment,
    r5 AS r5_discord,
    r6 AS r6_training,
    r7 AS r7_launch_ready,
    r8 AS r8_first_sale,
        CASE
            WHEN NOT r1 THEN '1. Complete profile'::text
            WHEN NOT r5 THEN '2. Join Slack'::text
            WHEN NOT r2 THEN '3. Complete licensing / add NPN + comp'::text
            WHEN NOT r4 THEN '4. Book onboarding with Milver'::text
            WHEN NOT r3 THEN '5. Submit native contracting intake'::text
            WHEN NOT r6 THEN '6. Start online onboarding'::text
            WHEN NOT r7 THEN '7. Finish training + ReadyMode setup'::text
            WHEN NOT r8 THEN '8. Post first deal'::text
            ELSE 'COMPLETE — active producer'::text
        END AS next_missing_step,
    r1::integer + r2::integer + r3::integer + r4::integer + r5::integer + r6::integer + r7::integer + r8::integer AS rungs_complete,
    (EXTRACT(epoch FROM now() - COALESCE(stage_changed_at, hired_at)) / 86400::numeric)::numeric(8,1) AS days_since_progress
   FROM flags
  ORDER BY (r1::integer + r2::integer + r3::integer + r4::integer + r5::integer + r6::integer + r7::integer + r8::integer), ((EXTRACT(epoch FROM now() - COALESCE(stage_changed_at, hired_at)) / 86400::numeric)::numeric(8,1)) DESC
) gated
where (select public.api_is_staff()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_queue_licensed_inactive: licensed agents not producing, by name (Onboarding Ladder: staff and managers)
create or replace view public.v_queue_licensed_inactive with (security_barrier = true) as
select * from (
SELECT a.id AS agent_id,
    COALESCE(a.display_name, p.full_name) AS agent,
    a.license_status::text AS license_status,
    a.total_policies,
    COALESCE(m.display_name, 'unassigned'::text) AS owner,
    COALESCE(a.stage_changed_at, a.updated_at, a.created_at) AS last_action_at,
    COALESCE(NULLIF(a.next_action_text, ''::text), 'Reactivation call: licensed agent marked inactive'::text) AS next_action,
    COALESCE(a.next_action_due_at::timestamp with time zone, now() + '3 days'::interval) AS due_at,
    (EXTRACT(epoch FROM now() - COALESCE(a.stage_changed_at, a.updated_at, a.created_at)) / 86400::numeric)::numeric(8,1) AS days_stuck,
        CASE
            WHEN COALESCE(a.total_policies, 0) > 0 THEN 1
            ELSE 2
        END AS priority
   FROM agents a
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN agents m ON m.id = a.manager_id
  WHERE COALESCE(a.is_deactivated, false) = false AND a.license_status::text = 'licensed'::text AND COALESCE(a.is_inactive, false) = true
  ORDER BY (
        CASE
            WHEN COALESCE(a.total_policies, 0) > 0 THEN 1
            ELSE 2
        END), ((EXTRACT(epoch FROM now() - COALESCE(a.stage_changed_at, a.updated_at, a.created_at)) / 86400::numeric)::numeric(8,1)) DESC
) gated
where (select public.api_is_staff()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_apex_roster: every agent with 120-day and lifetime production (Training Hub leader panel: admins, managers, VA managers)
create or replace view public.v_apex_roster with (security_barrier = true) as
select * from (
WITH produced AS (
         SELECT b.agent_id,
            count(*) AS deals_120d,
            sum(b.annual_premium) AS ap_120d,
            max(b.posted_date) AS last_deal
           FROM v_agentlink_book_scoped b
          WHERE b.is_dead IS NOT TRUE AND b.agent_id IS NOT NULL AND b.posted_date > ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 120)
          GROUP BY b.agent_id
        ), lifetime AS (
         SELECT b.agent_id,
            count(*) AS deals_lifetime,
            sum(b.annual_premium) AS ap_lifetime
           FROM v_agentlink_book_scoped b
          WHERE b.is_dead IS NOT TRUE AND b.agent_id IS NOT NULL
          GROUP BY b.agent_id
        )
 SELECT a.id,
    a.agent_code,
    a.display_name,
    a.status,
    a.license_status,
    a.manager_id,
    a.insuracloud_user_id,
    a.onboarding_stage,
    a.created_at,
    a.user_id,
    COALESCE(p.deals_120d, 0::bigint) AS deals_120d,
    COALESCE(p.ap_120d, 0::numeric) AS ap_120d,
    p.last_deal,
    COALESCE(l.deals_lifetime, 0::bigint) AS deals_lifetime,
    COALESCE(l.ap_lifetime, 0::numeric) AS ap_lifetime,
    p.agent_id IS NOT NULL AS is_producing,
        CASE
            WHEN p.agent_id IS NOT NULL AND a.status = 'active'::agent_status THEN 'producing'::text
            WHEN p.agent_id IS NOT NULL THEN 'producing_flag_stale'::text
            WHEN a.status = 'active'::agent_status THEN 'active_no_production'::text
            ELSE a.status::text
        END AS roster_state
   FROM agents a
     LEFT JOIN produced p ON p.agent_id = a.id
     LEFT JOIN lifetime l ON l.agent_id = a.id
  WHERE a.display_name IS NOT NULL AND btrim(a.display_name) <> ''::text AND COALESCE(a.agent_code, ''::text) !~~ like_escape('GHOST^_%'::text, '^'::text) AND COALESCE(a.agent_code, ''::text) !~~ 'XAGENT%'::text AND a.display_name !~~ like_escape('MP%^_HIRED'::text, '^'::text) AND a.display_name !~~ 'XAGENT%'::text AND NOT (EXISTS ( SELECT 1
           FROM roster_exclusions x
          WHERE x.agent_id = a.id)) AND COALESCE(a.is_inactive, false) = false AND COALESCE(a.is_deactivated, false) = false AND (a.status = 'active'::agent_status OR p.agent_id IS NOT NULL)
) gated
where (select public.api_is_staff()) or current_user in ('postgres', 'service_role', 'supabase_admin');

-- v_next_step_manager_board: each manager's pipeline with the people in it; a manager sees their own board, ops staff see every board
create or replace view public.v_next_step_manager_board with (security_barrier = true) as
select * from (
SELECT c.owner_user_id AS manager_user_id,
    c.derived_stage_key AS stage_key,
    c.stage_display_name,
    s.order_index,
    s.color_hex,
    count(*)::integer AS person_count,
    count(*) FILTER (WHERE c.is_stalled)::integer AS stalled_count,
    count(*) FILTER (WHERE c.days_in_stage > 7::numeric)::integer AS over_week_count,
    avg(c.days_in_stage) AS avg_days_in_stage,
    max(c.days_in_stage) AS max_days_in_stage,
    array_agg(json_build_object('application_id', c.application_id, 'agent_id', c.agent_id, 'first_name', c.first_name, 'last_name', c.last_name, 'days_in_stage', round(c.days_in_stage, 1), 'is_stalled', c.is_stalled, 'sla_due_at', c.sla_due_at) ORDER BY c.is_stalled DESC, c.days_in_stage DESC) AS persons
   FROM v_next_step_current c
     LEFT JOIN next_step_stages s ON s.stage_key = c.derived_stage_key
  WHERE c.derived_stage_key <> 'closed_lost'::text AND c.derived_stage_key IS NOT NULL
  GROUP BY c.owner_user_id, c.derived_stage_key, c.stage_display_name, s.order_index, s.color_hex
) gated
where (select public.api_is_ops_staff()) or gated.manager_user_id = (select auth.uid()) or current_user in ('postgres', 'service_role', 'supabase_admin');

