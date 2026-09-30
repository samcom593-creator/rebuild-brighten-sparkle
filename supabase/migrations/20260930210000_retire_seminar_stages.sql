-- Retire the seminar (2026-09-30). Sam: "remove the seminar books and actually
-- make everything work head to toe." Measured before acting: last seminar
-- registration by a person 2026-09-06, 0 attended in 30 days, and the seminar
-- control view was KJ's (departed 08-17). Yet the machine kept running it: the
-- "Contacted" stage nudged applicants to book a seat (1,227 sent lifetime, 10
-- SMS in the last 14 days) and a trigger auto-registered every new applicant.
--
-- Stages are RETIRED, not deleted: next_step_progress/events/messages carry
-- foreign keys to next_step_stages, and rewriting that history would be the
-- fake-data disease. Retired stages are hidden, never derived, never selectable.
alter table public.next_step_stages add column if not exists retired_at timestamptz;
update public.next_step_stages set retired_at = now()
 where stage_key in ('booked_seminar','attended_seminar') and retired_at is null;

-- "Contacted" now points at the pre-license course (copy adapted from the
-- post-seminar stage, which already said exactly that).
update public.next_step_stages c set
  next_action_label = 'Start your pre-license course',
  next_action_url = 'https://apex-financial.org/get-licensed',
  failure_label = 'No course started in 72h',
  sla_hours = 72,
  candidate_message_template = '{{first_name}} — your manager spoke with you. Next move is the pre-license course (Xcel). Start it here: {{next_action_url}}',
  sms_template = 'Apex: {{first_name}}, next step is your pre-license course: {{next_action_url}} Reply STOP to opt out.',
  email_subject_template = 'Next step: start your pre-license course',
  email_body_template = replace(replace(a.email_body_template, 'You showed up. Most don''t. The next move', 'Your manager called. The next move'), 'Great work on the seminar, ', ''),
  telegram_template = replace(replace(replace(coalesce(a.telegram_template, a.candidate_message_template), 'Great work on the seminar, ', ''), 'You showed up. Most don''t. ', 'Your manager called. '), 'you attended!', 'your manager called.'),
  updated_at = now()
from public.next_step_stages a
where c.stage_key = 'contacted' and a.stage_key = 'attended_seminar';

-- Stop auto-registering people for a seminar nobody runs (kept, disabled).
alter table public.applications disable trigger trg_apps_auto_seminar_register;
alter table public.applications disable trigger trg_auto_seminar_signup_on_course_paid;

-- Derivation: seminar evidence no longer produces a stage.
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
                    WHEN g.field_training_started_at IS NOT NULL OR g.onboarding_stage::text = 'in_field_training'::text THEN 'infield_training'::text
                    WHEN g.onboarding_completed_at IS NOT NULL THEN 'course_completed'::text
                    WHEN g.has_training_course = true THEN 'course_started'::text
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

create or replace function public.set_recruit_stage(
  p_application_id uuid, p_agent_id uuid, p_to_stage text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_now timestamptz := now();
  v_to int; v_cur text; v_cur_rank int; v_final text; v_hired int := public.fn_next_step_rank('hired');
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
  if not exists (select 1 from public.next_step_stages where stage_key = p_to_stage) then raise exception 'unknown stage %', p_to_stage; end if;
  if exists (select 1 from public.next_step_stages where stage_key = p_to_stage and retired_at is not null) then raise exception 'stage % is retired', p_to_stage; end if;
  if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;

  v_to := public.fn_next_step_rank(p_to_stage);
  if p_application_id is not null and v_to >= v_hired and p_to_stage <> 'closed_lost' then
    return jsonb_build_object('ok', false, 'reason', 'not_an_agent',
      'message', 'They are not an agent yet. Hire them (Add Agent) and the later stages open up.');
  end if;
  if p_agent_id is not null and v_to < v_hired then
    return jsonb_build_object('ok', false, 'reason', 'agent_before_hired',
      'message', 'They are already hired, so the applicant stages do not apply. Their licensing shows on the row.');
  end if;
  if p_agent_id is not null and p_to_stage = 'closed_lost' then
    return jsonb_build_object('ok', false, 'reason', 'use_no_longer_with_us',
      'message', 'For an agent, use "No longer with us" so they are removed properly and get the re-engagement email.');
  end if;

  select current_stage_key into v_cur from public.next_step_progress
   where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null) limit 1;
  v_cur_rank := public.fn_next_step_rank(coalesce(v_cur,'applied'));

  if p_application_id is not null then
    update public.applications set
      updated_at = v_now,
      -- forward evidence: stamp only what the target implies
      vsl_watched_at         = case when v_to >= 2  then coalesce(vsl_watched_at, v_now) else null end,
      last_contacted_at      = case when v_to >= 4  then coalesce(last_contacted_at, v_now) else null end,
      contacted_at           = case when v_to >= 4  then coalesce(contacted_at, v_now) else null end,
      course_purchased_at    = case when v_to >= 7  then coalesce(course_purchased_at, v_now) else null end,
      course_started_at      = case when v_to >= 7  then coalesce(course_started_at, v_now) else null end,
      license_progress       = case when v_to >= 8 and v_to <= 11 then 'finished_course'::license_progress
                                    when v_to = 7 then 'course_purchased'::license_progress
                                    when v_to < 7 then 'unlicensed'::license_progress
                                    else license_progress end,
      exam_scheduled_at      = case when v_to >= 9  then coalesce(exam_scheduled_at, v_now) else null end,
      exam_passed_at         = case when v_to >= 10 then coalesce(exam_passed_at, v_now) else null end,
      fingerprints_submitted_at = case when v_to >= 10 then fingerprints_submitted_at else null end,
      fingerprint_done       = case when v_to >= 10 then fingerprint_done else false end,
      contracted_at          = case when v_to >= 11 then coalesce(contracted_at, v_now) else null end,
      status                 = case when p_to_stage = 'closed_lost' then 'lapsed'::application_status
                                    when v_to = 11 then 'contracting'::application_status
                                    when status in ('lapsed','rejected','disqualified','contracting') then 'new'::application_status
                                    else status end
    where id = p_application_id;
  else
    update public.agents set
      updated_at = v_now,
      has_training_course       = case when v_to >= 13 then true else false end,
      onboarding_completed_at   = case when v_to >= 14 then coalesce(onboarding_completed_at, v_now) else null end,
      field_training_started_at = case when v_to >= 15 then coalesce(field_training_started_at, v_now) else null end,
      onboarding_stage          = case when v_to = 15 then 'in_field_training'::onboarding_stage
                                       when v_to < 15 and onboarding_stage = 'in_field_training' then 'onboarding'::onboarding_stage
                                       else onboarding_stage end,
      first_appointment_at      = case when v_to >= 16 then coalesce(first_appointment_at, v_now) else null end,
      first_deal_at             = case when v_to >= 17 then coalesce(first_deal_at, v_now) else null end,
      first_10k_at              = case when v_to >= 18 then coalesce(first_10k_at, v_now) else null end,
      weekly_10k_badges         = case when v_to >= 18 then greatest(coalesce(weekly_10k_badges,0),1) else 0 end
    where id = p_agent_id;
  end if;

  -- Hand-set stage, honoured by recompute until evidence outranks it.
  update public.next_step_progress
     set manual_stage_key = p_to_stage, manual_stage_at = v_now, manual_by = v_uid, updated_at = v_now
   where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null);
  if not found then
    insert into public.next_step_progress (person_type, application_id, agent_id, current_stage_key, entered_at, status, manual_stage_key, manual_stage_at, manual_by)
    values (case when p_application_id is not null then 'applicant' else 'agent' end, p_application_id, p_agent_id, p_to_stage, v_now, 'active', p_to_stage, v_now, v_uid);
  end if;

  perform public.fn_next_step_recompute_one(p_application_id, p_agent_id);

  select current_stage_key into v_final from public.next_step_progress
   where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null) limit 1;

  insert into public.next_step_events (application_id, agent_id, from_stage, to_stage, event_type, actor_user_id, source, payload)
  values (p_application_id, p_agent_id, v_cur, v_final, 'manual_override', v_uid, 'manual',
          jsonb_build_object('requested', p_to_stage, 'reason', nullif(btrim(p_reason),'')));

  return jsonb_build_object('ok', true, 'requested', p_to_stage, 'final', v_final, 'matched', v_final = p_to_stage,
    'message', case when v_final = p_to_stage then null
                    else 'Evidence on file puts them at ' || coalesce((select display_name from public.next_step_stages where stage_key = v_final), v_final) || ', so they stay there.' end);
end;
$function$;


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
  return query select v_processed, v_advanced;
end;
$function$;

-- Telegram line still opened with seminar-attendance language after the replace.
update public.next_step_stages set telegram_template = '{{first_name}}, your manager spoke with you. Next move is the pre-license course → {{next_action_url}}', updated_at = now() where stage_key = 'contacted';
