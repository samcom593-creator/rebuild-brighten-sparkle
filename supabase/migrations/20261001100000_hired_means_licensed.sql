-- Hired means licensed (2026-10-01). Sam: "the filter in which hired should be
-- people that were sent the link and licensed, not unlicensed that were hired,
-- so I can call those people who clicked the link." Measured: all 20 people at
-- "Hired" were unlicensed. New stage Hired — Needs License sits just before
-- Hired; the derivation puts any unlicensed agent without later evidence there;
-- set_recruit_stage refuses Hired+ for an unlicensed agent and now ranks by
-- stage key, not number. The list carries portal-link sent/clicked (the same
-- magic_login_tokens signal the Team engagement panel grades) so the page can
-- filter Hired by "sent, not clicked".

-- order_index is UNIQUE: shift the agent stages up one, highest first.
update public.next_step_stages set order_index = 19 where stage_key = 'first_10k_week';
update public.next_step_stages set order_index = 18 where stage_key = 'first_deal';
update public.next_step_stages set order_index = 17 where stage_key = 'first_appointment';
update public.next_step_stages set order_index = 16 where stage_key = 'infield_training';
update public.next_step_stages set order_index = 15 where stage_key = 'course_completed';
update public.next_step_stages set order_index = 14 where stage_key = 'course_started';
update public.next_step_stages set order_index = 13 where stage_key = 'hired';
insert into public.next_step_stages (stage_key,order_index,display_name,audience,owner_role,next_action_label,next_action_url,sla_hours,manager_alert_hours,reminder_cadence,stall_action,dashboard_section,color_hex,icon_name,candidate_message_template,manager_alert_template,telegram_template,sms_template,email_subject_template,email_body_template,is_terminal,success_event,failure_label,notes,created_at,updated_at,retired_at)
select 'hired_unlicensed', 12, 'Hired — Needs License', 'agent', owner_role, 'Get licensed: start the pre-license course', 'https://apex-financial.org/get-licensed', 360, manager_alert_hours, '', stall_action, dashboard_section, color_hex, 'academic-cap', '', '', '', '', '', '', false, '', 'No course started in 15d', '2026-10-01: unlicensed hires were sitting in Hired; Sam wants Hired = licensed + sent the link. No cadence, no templates: nothing nudges from here.', now(), now(), null from public.next_step_stages where stage_key = 'hired'
on conflict (stage_key) do nothing;

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

CREATE OR REPLACE FUNCTION public.set_recruit_stage(p_application_id uuid, p_agent_id uuid, p_to_stage text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_now timestamptz := now();
  v_to int; v_cur text; v_cur_rank int; v_final text; v_floor int := public.fn_next_step_rank('hired_unlicensed'); v_hired int := public.fn_next_step_rank('hired'); v_lic text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
  if not exists (select 1 from public.next_step_stages where stage_key = p_to_stage) then raise exception 'unknown stage %', p_to_stage; end if;
  if exists (select 1 from public.next_step_stages where stage_key = p_to_stage and retired_at is not null) then raise exception 'stage % is retired', p_to_stage; end if;
  if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;

  v_to := public.fn_next_step_rank(p_to_stage);
  if p_application_id is not null and v_to >= v_floor and p_to_stage <> 'closed_lost' then
    return jsonb_build_object('ok', false, 'reason', 'not_an_agent',
      'message', 'They are not an agent yet. Hire them (Add Agent) and the later stages open up.');
  end if;
  if p_agent_id is not null and v_to < v_floor then
    return jsonb_build_object('ok', false, 'reason', 'agent_before_hired',
      'message', 'They are already hired, so the applicant stages do not apply. Their licensing shows on the row.');
  end if;
  if p_agent_id is not null and v_to >= v_hired then
    select license_status::text into v_lic from public.agents where id = p_agent_id;
    if coalesce(v_lic,'') <> 'licensed' then
      return jsonb_build_object('ok', false, 'reason', 'not_licensed',
        'message', 'They are not licensed yet, so Hired and later stages do not apply. Set their license on the row first.');
    end if;
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
      has_training_course       = case when v_to >= public.fn_next_step_rank('course_started') then true else false end,
      onboarding_completed_at   = case when v_to >= public.fn_next_step_rank('course_completed') then coalesce(onboarding_completed_at, v_now) else null end,
      field_training_started_at = case when v_to >= public.fn_next_step_rank('infield_training') then coalesce(field_training_started_at, v_now) else null end,
      onboarding_stage          = case when v_to = public.fn_next_step_rank('infield_training') then 'in_field_training'::onboarding_stage
                                       when v_to < public.fn_next_step_rank('infield_training') and onboarding_stage = 'in_field_training' then 'onboarding'::onboarding_stage
                                       else onboarding_stage end,
      first_appointment_at      = case when v_to >= public.fn_next_step_rank('first_appointment') then coalesce(first_appointment_at, v_now) else null end,
      first_deal_at             = case when v_to >= public.fn_next_step_rank('first_deal') then coalesce(first_deal_at, v_now) else null end,
      first_10k_at              = case when v_to >= public.fn_next_step_rank('first_10k_week') then coalesce(first_10k_at, v_now) else null end,
      weekly_10k_badges         = case when v_to >= public.fn_next_step_rank('first_10k_week') then greatest(coalesce(weekly_10k_badges,0),1) else 0 end
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

drop function if exists public.recruit_pipeline_list();
create or replace function public.recruit_pipeline_list()
returns table(
  person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text,
  stage_key text, stage_name text, order_index integer, entered_at timestamptz, days_in_stage numeric,
  is_stalled boolean, sla_due_at timestamptz, next_action_label text, manager_name text,
  license_status text, license_progress text, npn text, last_contacted_at timestamptz, manual_stage_key text, status text,
  instagram text, link_sent_at timestamptz, link_used_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with staff as (select public.apex_is_admin() or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va') ok),
  mgr as (select public.has_role(auth.uid(),'manager') ok),
  mine as (select array_agg(id) ids from public.agents where user_id = auth.uid() and coalesce(is_deactivated,false) = false)
  select p.person_type, p.application_id, p.agent_id,
         coalesce(g.display_name, nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'),''), '(no name)'),
         coalesce(nullif(pr.phone,''), nullif(a.phone,'')), coalesce(pr.email, a.email), a.state,
         p.current_stage_key, s.display_name, s.order_index, p.entered_at,
         round(extract(epoch from now() - p.entered_at) / 86400.0, 1), coalesce(p.is_stalled,false), p.sla_due_at, s.next_action_label,
         coalesce(mg.display_name, hm.display_name),
         coalesce(g.license_status::text, a.license_status::text),
         coalesce(g.license_progress::text, a.license_progress::text),
         coalesce(nullif(g.nipr_number,''), nullif(a.nipr_number,'')),
         coalesce(a.last_contacted_at, g.updated_at), p.manual_stage_key, p.status,
         public.fn_normalize_instagram_handle(coalesce(nullif(btrim(pr.instagram_handle),''), nullif(btrim(a.instagram_handle),''), nullif(btrim(sa.instagram_handle),''))),
         lk.link_sent_at, lk.link_used_at, u.last_sign_in_at
  from public.next_step_progress p
  join public.next_step_stages s on s.stage_key = p.current_stage_key
  left join public.applications a on a.id = p.application_id
  left join public.agents g on g.id = p.agent_id
  left join public.profiles pr on pr.id = g.profile_id
  left join public.agents mg on mg.id = g.manager_id
  left join public.agents hm on hm.user_id = a.hiring_manager_user_id and hm.canonical_agent_id is null
  left join public.applications sa on sa.id = g.source_application_id
  left join lateral (select max(t.created_at) link_sent_at, max(t.used_at) link_used_at from public.magic_login_tokens t where t.agent_id = g.id) lk on true
  left join auth.users u on u.id = g.user_id
  where auth.uid() is not null
    and (p.application_id is not null or (g.id is not null and g.canonical_agent_id is null and coalesce(g.agent_code,'') not like 'GHOST_%'))
    and (a.id is null or coalesce(a.is_duplicate,false) = false)
    -- A person who already has an agent row is tracked as that agent; never show
    -- them a second time as an applicant stuck at "Applied".
    and (a.id is null or not exists (
          select 1 from public.agents ag
          left join public.profiles pr on pr.id = ag.profile_id
          where ag.canonical_agent_id is null
            and (ag.source_application_id = a.id
                 or (a.email is not null and pr.email is not null and lower(pr.email) = lower(a.email)))))
    and ( (select ok from staff)
          or ((select ok from mgr) and (
                (p.agent_id is not null and exists (select 1 from public.fn_contracting_checkin_scope() sc where sc.agent_id = p.agent_id))
             or (p.application_id is not null and (a.hiring_manager_user_id = auth.uid() or a.recruiter_id = auth.uid()
                  or a.assigned_agent_id = any(coalesce((select ids from mine),'{}')) or a.referral_manager_id = any(coalesce((select ids from mine),'{}'))))))
        );
$$;
revoke all on function public.recruit_pipeline_list() from public, anon;
grant execute on function public.recruit_pipeline_list() to authenticated;

