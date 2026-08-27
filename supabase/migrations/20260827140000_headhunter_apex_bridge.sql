-- Cross-app bridge (Sam's directive 2026-08-27): a Headhunter v2 hire must flow
-- into APEX as an agent. Measured: 20 of 21 hh_applicants at stage 'hired' are
-- NOT in APEX. Corrected from the pasted draft, which referenced columns that do
-- not exist on hh_applicants (nipr_number, is_licensed), a function that does not
-- exist (promote_application_to_agent_v2 — the real one is
-- promote_applicant_to_agent), and outbox_events inserts missing required
-- NOT NULL columns.
--
-- Design: on the hire TRANSITION, match or create the APEX application, then
-- promote it — which creates the agent and lets the existing hire-notification
-- (trg_notify_agent_hired) and onboarding-call (trg_agents_hired_licensed_enqueue
-- + the 15-min sweep) triggers cascade. No separate Slack queue needed; promotion
-- IS the notification. Transition-only, so applying this does not touch the 20
-- existing (no storm). Idempotent + EXCEPTION-guarded (never blocks the hh write).

create or replace function public.fn_bridge_hh_hire_to_apex()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_app_id uuid; v_first text; v_last text; v_email text;
begin
  if new.stage is distinct from 'hired' or old.stage is not distinct from 'hired' then return new; end if;
  if coalesce(new.archived, false) then return new; end if;
  v_email := lower(btrim(coalesce(new.email, '')));
  if v_email = '' then raise warning 'hh hire % has no email; cannot bridge to APEX', new.id; return new; end if;

  -- Already an APEX agent by email? Nothing to do.
  if exists (select 1 from public.agents a join public.profiles p on p.user_id = a.user_id where lower(p.email) = v_email) then
    return new;
  end if;

  select id into v_app_id from public.applications where lower(email) = v_email order by created_at asc limit 1;
  if v_app_id is null then
    v_first := coalesce(nullif(split_part(btrim(new.name), ' ', 1), ''), 'Headhunter');
    v_last  := nullif(btrim(substr(btrim(new.name), length(split_part(btrim(new.name), ' ', 1)) + 2)), '');
    insert into public.applications (first_name, last_name, email, phone, instagram_handle, source, license_status, status, record_type)
    values (v_first, coalesce(v_last, 'Recruit'), v_email, new.phone, new.instagram, 'headhunter_v2', 'unlicensed', 'new', 'application')
    returning id into v_app_id;
  end if;

  begin
    perform public.promote_applicant_to_agent(v_app_id, null);
  exception when others then
    raise warning 'promote_applicant_to_agent failed for hh hire % (app %): %', new.id, v_app_id, sqlerrm;
  end;
  return new;
exception when others then
  raise warning 'fn_bridge_hh_hire_to_apex failed for %: %', new.id, sqlerrm;
  return new;
end $fn$;

drop trigger if exists trg_bridge_hh_hire on public.hh_applicants;
create trigger trg_bridge_hh_hire after update of stage on public.hh_applicants
  for each row execute function public.fn_bridge_hh_hire_to_apex();

-- The backlog: hired in Headhunter, absent from APEX. For controlled backfill,
-- never an auto-storm.
create or replace view public.v_hh_hires_not_in_apex as
select h.id as hh_id, h.name, h.email, h.phone, h.instagram, h.appointment_at, h.updated_at
from public.hh_applicants h
where h.stage = 'hired' and coalesce(h.archived, false) = false
  and nullif(btrim(coalesce(h.email, '')), '') is not null
  and not exists (select 1 from public.agents a join public.profiles p on p.user_id = a.user_id where lower(p.email) = lower(h.email))
  -- a promoted agent has no auth profile yet, so also exclude by the application it was promoted from
  and not exists (select 1 from public.agents a join public.applications ap on ap.id = a.source_application_id where lower(ap.email) = lower(h.email));
grant select on public.v_hh_hires_not_in_apex to authenticated, service_role;

-- Admin-triggered single-hire bridge (drain the backlog one at a time).
create or replace function public.bridge_hh_hire(p_hh_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare h record; v_app_id uuid; v_agent uuid; v_first text; v_last text; v_email text;
begin
  if not public.apex_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into h from public.hh_applicants where id = p_hh_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_email := lower(btrim(coalesce(h.email, '')));
  if v_email = '' then return jsonb_build_object('ok', false, 'reason', 'no_email'); end if;
  if exists (select 1 from public.agents a join public.profiles p on p.user_id = a.user_id where lower(p.email) = v_email) then
    return jsonb_build_object('ok', true, 'reason', 'already_agent');
  end if;
  select id into v_app_id from public.applications where lower(email) = v_email order by created_at asc limit 1;
  if v_app_id is null then
    v_first := coalesce(nullif(split_part(btrim(h.name), ' ', 1), ''), 'Headhunter');
    v_last  := nullif(btrim(substr(btrim(h.name), length(split_part(btrim(h.name), ' ', 1)) + 2)), '');
    insert into public.applications (first_name, last_name, email, phone, instagram_handle, source, license_status, status, record_type)
    values (v_first, coalesce(v_last, 'Recruit'), v_email, h.phone, h.instagram, 'headhunter_v2', 'unlicensed', 'new', 'application')
    returning id into v_app_id;
  end if;
  v_agent := public.promote_applicant_to_agent(v_app_id, null);
  return jsonb_build_object('ok', true, 'reason', 'bridged', 'agent_id', v_agent, 'application_id', v_app_id);
end $fn$;
revoke all on function public.bridge_hh_hire(uuid) from public, anon;
grant execute on function public.bridge_hh_hire(uuid) to authenticated, service_role;

-- Interview no-show recovery: the pasted version queued 'recruiting.interview_noshow'
-- (no route/template) and an outbox insert missing required columns. Corrected to
-- the routed candidate.interview_noshow with the full outbox contract. No client
-- (policyholder) PII — the name is the recruit, in a recruiting channel.
create or replace function public.trigger_interview_noshow_recovery(p_interview_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v record;
begin
  select candidate_name into v from public.v_interviews_unified where id = p_interview_id;
  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
  values ('interview', p_interview_id, 'candidate.interview_noshow', 'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'candidateName', v.candidate_name,
      'urgentFollowup', true,
      'openUrl', 'https://apex-financial.org/dashboard/recruiting/follow-ups')),
    'candidate.interview_noshow:' || p_interview_id::text || ':recovery', gen_random_uuid())
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('queued', true, 'interview_id', p_interview_id);
end $fn$;
revoke all on function public.trigger_interview_noshow_recovery(uuid) from public, anon;
grant execute on function public.trigger_interview_noshow_recovery(uuid) to authenticated, service_role;
