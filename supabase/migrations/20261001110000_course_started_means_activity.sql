-- Apex Course Started meant "course email queued" (2026-10-01).
-- v_next_step_current derived course_started from agents.has_training_course,
-- which fn_enqueue_hired_licensed_onboarding flips the moment the course email
-- is queued. Measured: 54 licensed hires sat at "Apex Course Started" and 0 at
-- "Hired", so the bucket Sam wants to call (licensed, link sent, no action yet)
-- was empty. course_started now means a module was actually opened, watched
-- or completed (onboarding_progress). Also closes progress rows for agent rows
-- merged into a canonical agent (Jimmy Dignan's duplicate sat at Hired forever).
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
                    WHEN a.exam_passed_at IS NOT NULL AND (a.fingerprint_done = true OR a.fingerprints_submitted_at IS NOT NULL) THEN 'passed_exam'::text
                    WHEN a.exam_passed_at IS NOT NULL THEN 'passed_exam'::text
                    WHEN a.exam_scheduled_at IS NOT NULL THEN 'exam_scheduled'::text
                    WHEN a.license_progress = 'finished_course'::license_progress OR a.license_progress = 'exam_passed'::license_progress OR a.license_progress = 'passed_test'::license_progress THEN 'finished_prelicense'::text
                    WHEN a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.license_progress = 'course_purchased'::license_progress THEN 'started_prelicense'::text
                    WHEN a.last_contacted_at IS NOT NULL THEN 'contacted'::text
                    WHEN a.vsl_watched_at IS NOT NULL THEN 'watched_vsl'::text
                    ELSE 'applied'::text
                END AS derived_stage_key,
            a.created_at AS person_created_at,
            a.next_action_at,
            a.next_action_due_at,
            a.last_contacted_at,
                CASE
                    WHEN a.exam_passed_at IS NOT NULL THEN a.exam_passed_at
                    WHEN a.exam_scheduled_at IS NOT NULL THEN a.exam_scheduled_at
                    WHEN a.license_progress = ANY (ARRAY['finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]) THEN a.updated_at
                    WHEN a.course_started_at IS NOT NULL THEN a.course_started_at
                    WHEN a.course_purchased_at IS NOT NULL THEN a.course_purchased_at
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
                    WHEN (EXISTS ( SELECT 1 FROM onboarding_progress op WHERE op.agent_id = g.id AND (op.started_at IS NOT NULL OR op.completed_at IS NOT NULL OR COALESCE(op.video_watched_percent, 0) > 0))) THEN 'course_started'::text
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

CREATE OR REPLACE FUNCTION public.fn_next_step_recompute_all()
 RETURNS TABLE(processed integer, advanced integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_processed int := 0;
  v_advanced int := 0;
  r record;
  prior text;
begin
  for r in select application_id, agent_id, derived_stage_key from public.v_next_step_current
  loop
    select current_stage_key into prior
    from public.next_step_progress
    where (application_id = r.application_id and r.application_id is not null)
       or (agent_id = r.agent_id and r.agent_id is not null) limit 1;

    perform public.fn_next_step_recompute_one(r.application_id, r.agent_id);
    v_processed := v_processed + 1;
    if prior is null or prior <> r.derived_stage_key then v_advanced := v_advanced + 1; end if;
  end loop;
  -- Rows the derivation view cannot see never recompute, so they stayed
  -- 'active' forever and kept receiving nudges: applicants who were hired
  -- (they are tracked as agents now) and duplicate applications.
  update public.next_step_progress p set status = 'completed', updated_at = now()
    from public.applications a
   where p.application_id = a.id and p.status = 'active'
     and exists (select 1 from public.agents ag where ag.source_application_id = a.id);
  update public.next_step_progress p set status = 'closed_lost', updated_at = now()
    from public.applications a
   where p.application_id = a.id and p.status = 'active' and coalesce(a.is_duplicate, false);
  -- Agent rows merged into a canonical agent are not in the view either.
  update public.next_step_progress p set status = 'completed', updated_at = now()
    from public.agents g
   where p.agent_id = g.id and p.status = 'active' and g.canonical_agent_id is not null;
  return query select v_processed, v_advanced;
end;
$function$;
