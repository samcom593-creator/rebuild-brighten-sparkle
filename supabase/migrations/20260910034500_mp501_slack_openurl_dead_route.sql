-- MP-501: two deployed trigger functions wrote a dead route into every Slack
-- notification they queued.
--
-- fn_queue_application_slack (on applications) and
-- fn_queue_licensing_milestone_slack (on licensing_milestone_events) built
-- payload->>'openUrl' as https://apex-financial.org/dashboard/recruiting/pipeline.
-- The router has never declared that path. MP-433 fixed the identical string at
-- two src/ call sites on 2026-09-04 and the sweep stopped there, so the copy
-- that reaches Sam's team survived one directory over (MP-345).
--
-- Measured before fixing: 40 rows in outbox_events carry that URL — 13
-- candidate.application_submitted and 27 candidate.licensing_milestone, every
-- one of them with openUrl set, so the template's own fallback constant was
-- never the path taken. The emitter was.
--
-- Those 40 historical rows are deliberately NOT rewritten. They were really
-- sent with that URL; editing them would make the record claim a delivery that
-- did not happen (the 465 fake-success InsuraCloud rows).
--
-- Applied live via bot-sql on 2026-09-10 and recorded here so a rebuild from
-- migrations lands on the fixed definition rather than reintroducing it.

create or replace function public.fn_queue_application_slack()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination,
    payload, idempotency_key, correlation_id
  ) values (
    'application',
    new.id,
    'candidate.application_submitted',
    'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'applicationId', new.id,
      'candidateName', btrim(concat_ws(' ', new.first_name, new.last_name)),
      'isLicensed', new.license_status::text = 'licensed',
      'state', case
        when upper(btrim(coalesce(new.state, ''))) ~ '^[A-Z]{2}$'
          then upper(btrim(new.state))
        else null
      end,
      'openUrl', 'https://apex-financial.org/dashboard/recruiting'
    )),
    'candidate.application_submitted:' || new.id::text || ':slack',
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- A notification must never roll back an applicant's submission.
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.fn_queue_licensing_milestone_slack()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'openUrl', 'https://apex-financial.org/dashboard/recruiting'
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
$function$

;
