-- onboarding-integrate (2026-11-10): two truth fixes from the WP3/WP7 adversarial reviews.
--
-- 1) cc_dispose_interview: the Calendly no-show path (WP3) logged a human-contact row, so a
--    recruit nobody had spoken to left NEW_UNTOUCHED in v_recruit_sla_queue the moment the
--    host marked a no-show. That path now sets applications.status only. VA dispositions and
--    one-tap outcome links are unchanged (they are human actions).
-- 2) agents.slack_joined_source: the 'Agents can update own record' policy has no column
--    restriction, so an agent could self-write 'verified_link'. A BEFORE trigger refuses that
--    value from authenticated/anon callers unless admin; self_reported stays self-serve.
--    SECURITY DEFINER paths (admin_verify_slack_identity) and service role are unaffected.

CREATE OR REPLACE FUNCTION public.cc_dispose_interview(p_id uuid, p_outcome text, p_notes text DEFAULT NULL::text, p_followup_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS interview_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.interview_events;
  v_owner uuid;
begin
  -- Same gate as cancel_interview_event (which calls this nested), plus the service-role
  -- edge function (interview-outcome one-tap links). Anon could call this until WP3.
  select owner_user_id into v_owner from public.interview_events where id = p_id;
  if not (coalesce(auth.role(), '') = 'service_role'
          or public.calendar_is_scheduling_staff()
          or (v_owner is not null and v_owner = auth.uid())) then
    raise exception 'not authorized to record an interview outcome' using errcode = '42501';
  end if;

  update public.interview_events
     set outcome         = p_outcome,
         outcome_at      = now(),
         outcome_by      = auth.uid(),
         notes           = coalesce(p_notes, notes),
         followup_due_at = coalesce(p_followup_due_at, followup_due_at),
         contacted_at    = case when p_outcome = 'callback' then now() else contacted_at end
   where id = p_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'interview_events row % not found', p_id;
  end if;

  -- The linked application gets one human-contact row; the log trigger stamps
  -- last_contacted_at + human_*, and the helper moves status with the same mapping
  -- this function used to apply inline.
  -- A Calendly host's no-show mark (calendly-webhook / calendly-backfill, service role,
  -- notes 'Calendly no-show mark') is not a conversation with the recruit: it moves the
  -- status only, so a never-contacted recruit stays NEW_UNTOUCHED in v_recruit_sla_queue.
  if v_row.application_id is not null and auth.uid() is null
     and p_outcome = 'no_show' and coalesce(p_notes, '') ilike 'Calendly no-show%' then
    update public.applications set status = 'attended_no_show'::application_status
     where id = v_row.application_id;
  elsif v_row.application_id is not null then
    perform public.fn_log_human_contact(
      v_row.application_id, 'call', p_outcome, auth.uid(),
      case when auth.uid() is null then 'one_tap_link' else 'interview_disposition' end,
      'interview ' || p_id::text);
  end if;

  return v_row;
end $function$;

create or replace function public.fn_guard_slack_verified_source()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  if new.slack_joined_source = 'verified_link'
     and old.slack_joined_source is distinct from 'verified_link'
     and current_user in ('authenticated', 'anon')
     and not public.apex_is_admin() then
    raise exception 'slack_joined_source verified_link is set by staff verification only' using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_guard_slack_verified_source on public.agents;
create trigger trg_guard_slack_verified_source
  before update of slack_joined_source on public.agents
  for each row execute function public.fn_guard_slack_verified_source();
