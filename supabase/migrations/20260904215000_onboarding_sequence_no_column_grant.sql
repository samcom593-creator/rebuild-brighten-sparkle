-- MP-430f — Recruit Pipeline's onboarding ladder (v_onboarding_sequence) was
-- 403 for every signed-in user. Same class as MP-430c/e: a security_invoker view
-- reading columns MP-329 revoked from the authenticated role (nipr_number,
-- comp_percentage, next_action_text). Proven with Sam's real session against
-- PostgREST: 42501 "permission denied for table agents".
--
-- The view needed those columns for two BOOLEANS (is the agent licensing-ready;
-- did a contracting intake match by NPN) and exported next_action_text, which
-- neither consumer (OnboardingLadder, NoHireLeftBehindPanel) reads. The booleans
-- move behind SECURITY DEFINER helpers that never return the NPN, the comp or
-- the note; the columns leave the view. Per-caller scoping is unchanged.
create or replace function public.fn_agent_licensing_ready(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((
    select nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), '') is not null
       and a.comp_percentage >= 50 and a.comp_percentage <= 200
    from public.agents a where a.id = p_agent_id), false);
$f$;
create or replace function public.fn_agent_contracting_matched_by_npn(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (
    select 1 from public.agents a
    join public.contracting_intakes ci on ci.npn = a.nipr_number
    where a.id = p_agent_id and a.nipr_number is not null
      and ci.status = any (array['accepted','completed']));
$f$;
revoke all on function public.fn_agent_licensing_ready(uuid) from public, anon;
revoke all on function public.fn_agent_contracting_matched_by_npn(uuid) from public, anon;
grant execute on function public.fn_agent_licensing_ready(uuid) to authenticated, service_role;
grant execute on function public.fn_agent_contracting_matched_by_npn(uuid) to authenticated, service_role;

drop view if exists public.v_onboarding_sequence;
create view public.v_onboarding_sequence with (security_invoker = on) as
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
                  WHERE (ci.status = ANY (ARRAY['accepted'::text, 'completed'::text])) AND ci.agent_id = ag.id)) OR public.fn_agent_contracting_matched_by_npn(ag.id) AS contracting_started,
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
          WHERE ag.is_deactivated IS NOT TRUE AND ag.is_inactive IS NOT TRUE AND ag.canonical_agent_id IS NULL
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
            a.license_status <> 'licensed'::text OR public.fn_agent_licensing_ready(a.agent_id) AS r2,
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
  ORDER BY (r1::integer + r2::integer + r3::integer + r4::integer + r5::integer + r6::integer + r7::integer + r8::integer), ((EXTRACT(epoch FROM now() - COALESCE(stage_changed_at, hired_at)) / 86400::numeric)::numeric(8,1)) DESC;
grant select on public.v_onboarding_sequence to authenticated, service_role;
