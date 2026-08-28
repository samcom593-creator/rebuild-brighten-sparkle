-- MP-337 — XCEL licensing milestones the directive asks for, wired to BOTH Slack
-- and Discord. Recon (2026-08-27): licensing_milestone_events' CHECK had no
-- half-way or course-completed type; fn_capture_application_licensing_milestone
-- mapped the applications value 'finished_course' to NULL, so a completed course
-- produced NOTHING; and fn_queue_licensing_milestone_slack enqueued Slack only —
-- the dispatcher's Discord leg threw for this aggregate. The Slack leg itself was
-- proven live (7/7 delivered 2026-08-26 with message_ts receipts).
--
-- 1. Two new milestone types: course_halfway (>=50% coursework) and
--    completed_course (100% / date_completed / finished_course).
-- 2. finished_course now maps to completed_course.
-- 3. Every milestone row also enqueues a Discord row (aggregate licensing_milestone,
--    destination discord); the dispatcher + discord-webhook-notify gain the matching
--    branch/embed in the same wave. Idempotent per milestone + destination.

alter table public.licensing_milestone_events
  drop constraint if exists licensing_milestone_events_milestone_type_check;
alter table public.licensing_milestone_events
  add constraint licensing_milestone_events_milestone_type_check
  check (milestone_type = any (array[
    'enrolled_course'::text, 'course_halfway'::text, 'completed_course'::text,
    'scheduled_exam'::text, 'passed_exam'::text, 'fingerprints_submitted'::text, 'license_issued'::text
  ]));

create or replace function public.fn_capture_application_licensing_milestone()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_milestone text;
  v_agent_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.license_progress is not distinct from old.license_progress then
    return new;
  end if;

  v_milestone := case new.license_progress::text
    when 'course_purchased' then 'enrolled_course'
    when 'finished_course' then 'completed_course'
    when 'test_scheduled' then 'scheduled_exam'
    when 'passed_test' then 'passed_exam'
    when 'exam_passed' then 'passed_exam'
    when 'fingerprints_done' then 'fingerprints_submitted'
    when 'waiting_on_license' then 'fingerprints_submitted'
    when 'licensed' then 'license_issued'
    when 'in_field_training' then 'license_issued'
    else null
  end;
  if v_milestone is null then return new; end if;

  select a.id into v_agent_id
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where a.source_application_id = new.id
     or lower(btrim(p.email)) = lower(btrim(new.email))
  order by (a.source_application_id = new.id) desc, a.created_at desc
  limit 1;

  -- one row per (application, milestone) — a re-save of the same stage is not news
  if exists (select 1 from public.licensing_milestone_events e
             where e.application_id = new.id and e.milestone_type = v_milestone) then
    return new;
  end if;

  insert into public.licensing_milestone_events(
    application_id, agent_id, candidate_name, milestone_type,
    exam_date, state, source
  ) values (
    new.id,
    v_agent_id,
    btrim(concat_ws(' ', new.first_name, new.last_name)),
    v_milestone,
    case when v_milestone = 'scheduled_exam' then new.test_scheduled_date else null end,
    case when upper(btrim(coalesce(new.state, ''))) ~ '^[A-Z]{2}$'
      then upper(btrim(new.state)) else null end,
    'application_progress'
  ) on conflict do nothing;

  return new;
end;
$function$;

create or replace function public.fn_queue_licensing_milestone_slack()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'milestoneId', new.id,
    'applicationId', new.application_id,
    'agentId', new.agent_id,
    'candidateName', new.candidate_name,
    'milestoneType', new.milestone_type,
    'examDate', new.exam_date,
    'state', new.state,
    'openUrl', 'https://apex-financial.org/dashboard/recruiting/pipeline'
  ));

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values
    ('licensing_milestone', new.id, 'candidate.licensing_milestone', 'slack', v_payload,
     'candidate.licensing_milestone:' || new.id::text || ':slack', gen_random_uuid()),
    ('licensing_milestone', new.id, 'candidate.licensing_milestone', 'discord', v_payload,
     'candidate.licensing_milestone:' || new.id::text || ':discord', gen_random_uuid())
  on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- a hype post must never roll back the milestone record
  return new;
end;
$function$;
