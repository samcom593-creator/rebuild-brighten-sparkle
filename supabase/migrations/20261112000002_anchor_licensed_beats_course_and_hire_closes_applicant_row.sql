-- ANCHOR 2026-11-11: two ladder defects found by peer 6e's journey proofs
-- (prove-onboarding-journeys.sh findings J2 and J3).
--
-- J2. An applicant who started the course and THEN got licensed stayed in a course/exam
-- stage (started_prelicense ...) because those branches came before the licensed branch
-- in v_next_step_current. So a newly licensed person kept getting "finish your course"
-- nudges instead of "book your call". Fix: when license_status = 'licensed' AND a course
-- or exam stamp exists, the stage is call_booked (live booking) or licensed_book_call.
-- Applicants with no course stamps are unchanged (the existing order already handles
-- them). stage_entered_at for the new branch = licensed_at (else created_at), so nobody
-- licensed before the lane ladder's cutoff gets a backlog nudge (fn_lane_ladder_cutoff).
-- Columns are unchanged (create or replace view, same select list).
--
-- J3. After a hire, the applicant-lane next_step_progress row stayed 'active' until the
-- 03:00 UTC recompute (PKG1's send gate already blocked messages; the row still read
-- active). The agents trigger below applies the nightly job's own rule immediately:
-- an application with an agent row (source_application_id) is 'completed'.
-- EXCEPTION-wrapped: it can never block an agent insert.

create or replace view public.v_next_step_current as
 WITH applicants AS (
         SELECT a.id AS application_id,
            NULL::uuid AS agent_id,
            'applicant'::text AS person_type,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.status::text AS legacy_status,
            a.license_progress::text AS license_progress,
            a.hiring_manager_user_id AS owner_user_id,
                CASE
                    WHEN a.status = ANY (ARRAY['rejected'::application_status, 'disqualified'::application_status, 'lapsed'::application_status]) THEN 'closed_lost'::text
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress])) AND (EXISTS ( SELECT 1 FROM interview_events ie WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN 'call_booked'::text
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress])) THEN 'licensed_book_call'::text
                    WHEN a.exam_passed_at IS NOT NULL AND (a.fingerprint_done = true OR a.fingerprints_submitted_at IS NOT NULL) THEN 'passed_exam'::text
                    WHEN a.exam_passed_at IS NOT NULL THEN 'passed_exam'::text
                    WHEN a.exam_scheduled_at IS NOT NULL THEN 'exam_scheduled'::text
                    WHEN a.license_progress = 'finished_course'::license_progress OR a.license_progress = 'exam_passed'::license_progress OR a.license_progress = 'passed_test'::license_progress THEN 'finished_prelicense'::text
                    WHEN a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.license_progress = 'course_purchased'::license_progress THEN 'started_prelicense'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM interview_events ie
                      WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN 'call_booked'::text
                    WHEN a.license_status::text = 'licensed'::text THEN 'licensed_book_call'::text
                    WHEN a.last_contacted_at IS NOT NULL THEN 'contacted'::text
                    WHEN a.vsl_watched_at IS NOT NULL THEN 'watched_vsl'::text
                    ELSE 'applied'::text
                END AS derived_stage_key,
            a.created_at AS person_created_at,
            a.next_action_at,
            a.next_action_due_at,
            a.last_contacted_at,
                CASE
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress])) AND (EXISTS ( SELECT 1 FROM interview_events ie WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN ( SELECT max(ie2.scheduled_at) AS max FROM interview_events ie2 WHERE ie2.application_id = a.id AND ie2.canceled_at IS NULL AND NOT COALESCE(ie2.is_backfill_duplicate, false))
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress])) THEN COALESCE(a.licensed_at, a.created_at)
                    WHEN a.exam_passed_at IS NOT NULL THEN a.exam_passed_at
                    WHEN a.exam_scheduled_at IS NOT NULL THEN a.exam_scheduled_at
                    WHEN a.license_progress = ANY (ARRAY['finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]) THEN COALESCE(( SELECT max(o.created_at) AS max
                       FROM license_milestone_outbox o
                      WHERE o.application_id = a.id AND o.new_progress = a.license_progress::text), a.course_started_at, a.course_purchased_at, a.created_at)
                    WHEN a.course_started_at IS NOT NULL THEN a.course_started_at
                    WHEN a.course_purchased_at IS NOT NULL THEN a.course_purchased_at
                    WHEN (EXISTS ( SELECT 1
                       FROM interview_events ie
                      WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN ( SELECT max(ie2.scheduled_at) AS max
                       FROM interview_events ie2
                      WHERE ie2.application_id = a.id AND ie2.canceled_at IS NULL AND NOT COALESCE(ie2.is_backfill_duplicate, false))
                    WHEN (a.license_status::text = 'licensed'::text OR a.last_contacted_at IS NULL AND a.vsl_watched_at IS NULL) AND (( SELECT
                            CASE
                                WHEN (pkg1_rearm_ie.outcome = ANY (ARRAY['no_answer'::text, 'no_show'::text])) AND to_char((pkg1_rearm_ie.scheduled_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) >= (( SELECT pkg1_ss.value
                                   FROM system_settings pkg1_ss
                                  WHERE pkg1_ss.key = 'anchor_pkg1_cutoff_at'::text AND pkg1_ss.value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'::text)) AND COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at) <= (pkg1_rearm_ie.scheduled_at + '72:00:00'::interval) THEN COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at)
                                ELSE NULL::timestamp with time zone
                            END AS "case"
                       FROM interview_events pkg1_rearm_ie
                      WHERE pkg1_rearm_ie.application_id = a.id AND pkg1_rearm_ie.canceled_at IS NULL AND NOT COALESCE(pkg1_rearm_ie.is_backfill_duplicate, false) AND (COALESCE(pkg1_rearm_ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text]))
                      ORDER BY pkg1_rearm_ie.scheduled_at DESC NULLS LAST, pkg1_rearm_ie.created_at DESC
                     LIMIT 1)) IS NOT NULL THEN ( SELECT
                            CASE
                                WHEN (pkg1_rearm_ie.outcome = ANY (ARRAY['no_answer'::text, 'no_show'::text])) AND to_char((pkg1_rearm_ie.scheduled_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) >= (( SELECT pkg1_ss.value
                                   FROM system_settings pkg1_ss
                                  WHERE pkg1_ss.key = 'anchor_pkg1_cutoff_at'::text AND pkg1_ss.value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'::text)) AND COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at) <= (pkg1_rearm_ie.scheduled_at + '72:00:00'::interval) THEN COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at)
                                ELSE NULL::timestamp with time zone
                            END AS "case"
                       FROM interview_events pkg1_rearm_ie
                      WHERE pkg1_rearm_ie.application_id = a.id AND pkg1_rearm_ie.canceled_at IS NULL AND NOT COALESCE(pkg1_rearm_ie.is_backfill_duplicate, false) AND (COALESCE(pkg1_rearm_ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text]))
                      ORDER BY pkg1_rearm_ie.scheduled_at DESC NULLS LAST, pkg1_rearm_ie.created_at DESC
                     LIMIT 1)
                    WHEN a.seminar_attended_at IS NOT NULL THEN a.seminar_attended_at
                    WHEN a.seminar_registered_at IS NOT NULL THEN a.seminar_registered_at
                    WHEN a.seminar_date IS NOT NULL THEN a.created_at
                    WHEN a.last_contacted_at IS NOT NULL THEN a.last_contacted_at
                    WHEN a.vsl_watched_at IS NOT NULL THEN a.vsl_watched_at
                    ELSE a.created_at
                END AS stage_entered_at
           FROM applications a
          WHERE COALESCE(a.is_duplicate, false) = false AND a.status <> 'approved'::application_status
        ), agents_part AS (
         SELECT NULL::uuid AS application_id,
            g.id AS agent_id,
            'agent'::text AS person_type,
            COALESCE(split_part(p.full_name, ' '::text, 1), split_part(g.display_name, ' '::text, 1)) AS first_name,
            COALESCE(NULLIF(regexp_replace(p.full_name, '^\S+\s*'::text, ''::text), ''::text), split_part(g.display_name, ' '::text, 2)) AS last_name,
            p.email,
            p.phone,
            g.status::text AS legacy_status,
            g.license_status::text AS license_progress,
            g.manager_id AS owner_user_id,
                CASE
                    WHEN g.is_deactivated = true OR g.status = 'terminated'::agent_status THEN 'closed_lost'::text
                    WHEN g.first_10k_at IS NOT NULL OR g.weekly_10k_badges > 0 THEN 'first_10k_week'::text
                    WHEN g.first_deal_at IS NOT NULL THEN 'first_deal'::text
                    WHEN g.first_appointment_at IS NOT NULL THEN 'first_appointment'::text
                    WHEN g.license_status IS DISTINCT FROM 'licensed'::license_status THEN 'hired_unlicensed'::text
                    WHEN g.field_training_started_at IS NOT NULL OR g.onboarding_stage::text = 'in_field_training'::text THEN 'infield_training'::text
                    WHEN g.onboarding_completed_at IS NOT NULL THEN 'course_completed'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM onboarding_progress op
                      WHERE op.agent_id = g.id AND (op.started_at IS NOT NULL OR op.completed_at IS NOT NULL OR COALESCE(op.video_watched_percent, 0) > 0))) THEN 'course_started'::text
                    ELSE 'hired'::text
                END AS derived_stage_key,
            g.created_at AS person_created_at,
            NULL::timestamp with time zone AS next_action_at,
            NULL::timestamp with time zone AS next_action_due_at,
            NULL::timestamp with time zone AS last_contacted_at,
                CASE
                    WHEN g.first_10k_at IS NOT NULL THEN g.first_10k_at
                    WHEN g.first_deal_at IS NOT NULL THEN g.first_deal_at
                    WHEN g.first_appointment_at IS NOT NULL THEN g.first_appointment_at
                    WHEN g.field_training_started_at IS NOT NULL THEN g.field_training_started_at
                    WHEN g.onboarding_completed_at IS NOT NULL THEN g.onboarding_completed_at
                    WHEN g.has_training_course = true THEN COALESCE(g.production_unlocked_at, g.contracted_at, g.start_date::timestamp with time zone, g.created_at)
                    ELSE COALESCE(g.contracted_at, g.start_date::timestamp with time zone, g.created_at)
                END AS stage_entered_at
           FROM agents g
             LEFT JOIN profiles p ON p.user_id = g.user_id
          WHERE g.canonical_agent_id IS NULL AND (EXISTS ( SELECT 1
                   FROM v_agent_canonical_map vc
                  WHERE vc.canonical_agent_id = g.id))
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
            WHEN s.sla_hours IS NULL THEN NULL::timestamp with time zone
            ELSE x.stage_entered_at + ((s.sla_hours || ' hours'::text)::interval)
        END AS sla_due_at,
        CASE
            WHEN s.sla_hours IS NULL THEN NULL::boolean
            WHEN now() > (x.stage_entered_at + ((s.sla_hours || ' hours'::text)::interval)) THEN true
            ELSE false
        END AS is_stalled,
    EXTRACT(epoch FROM now() - x.stage_entered_at) / 86400.0 AS days_in_stage
   FROM ( SELECT applicants.application_id,
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
     LEFT JOIN next_step_stages s ON s.stage_key = x.derived_stage_key;

create or replace function public.fn_next_step_close_hired_applicant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.source_application_id is not null then
    update public.next_step_progress
       set status = 'completed', updated_at = now()
     where application_id = new.source_application_id
       and status = 'active';
  end if;
  return new;
exception when others then
  raise warning 'fn_next_step_close_hired_applicant: % (agent %)', sqlerrm, new.id;
  return new;
end;
$fn$;
revoke all on function public.fn_next_step_close_hired_applicant() from public, anon, authenticated;

drop trigger if exists trg_next_step_close_hired_applicant on public.agents;
create trigger trg_next_step_close_hired_applicant
  after insert or update of source_application_id on public.agents
  for each row execute function public.fn_next_step_close_hired_applicant();
