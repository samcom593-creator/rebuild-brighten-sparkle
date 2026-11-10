-- WP6 follow-up (2026-11-10): my_activation_state() honours WP5's required-carrier list.
--
-- Applied live by WP6 and recorded as 20261111100510. Idempotent (create or replace).
--
-- 20261111100500 shipped the audit's safe default for "contracting done" while
-- Sam's answer to N7 (which carriers must be appointed) is pending: any staff
-- contract_review_mark, agents.contracted_at, or a first deal. WP5 has since put
-- the answer's home live: public.fn_contracting_required_carriers() reads
-- system_settings.contracting_required_carriers, and a trigger derives
-- agents.contracted_at (forward-only) once every required carrier is marked.
--
-- This version switches automatically on that answer:
--   required list empty (today)  -> unchanged fallback: any mark / contracted_at / first deal
--   required list set (after N7) -> contracted_at (WP5's derived fact) or first deal only;
--                                   a single mark no longer reads as "contracted".
-- The WP5 function is called dynamically and only if it exists, so this file
-- does not depend on WP5's migration being merged first; a failure there
-- degrades to the fallback, never to an error on the agent's dashboard.
--
-- PREIMAGE: public.my_activation_state(uuid) as created by 20261111100500 (same
-- body, with v_basis computed from marks > 0 / contracted_at / first_deal_at only).

create or replace function public.my_activation_state(p_agent_id uuid default null)
returns table (
  agent_id uuid,
  first_name text,
  onboarding_stage text,
  license_status text,
  hired_at timestamptz,
  profile_complete boolean,
  has_phone boolean,
  training_started boolean,
  required_training_complete boolean,
  required_passed integer,
  required_total integer,
  contracting_done boolean,
  contracting_basis text,
  contracting_profile_submitted boolean,
  onboarding_call_booked boolean,
  onboarding_call_at timestamptz,
  onboarding_booking_url text,
  first_deal_at timestamptz,
  manual_overrides jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_n int;
  a record;
  v_profile_complete boolean := false;
  v_has_phone boolean := false;
  v_full_name text;
  v_contract_profile boolean := false;
  v_training_started boolean := false;
  v_req_complete boolean := false;
  v_req_passed int := 0;
  v_req_total int := 0;
  v_marks int := 0;
  v_required text[] := '{}'::text[];
  v_basis text;
  v_booking uuid;
  v_booking_at timestamptz;
  v_single text;
  v_had_cancel boolean := false;
  v_url text;
  v_over jsonb := '{}'::jsonb;
begin
  -- No session, no rows. Agents read only their own row: an explicit id must
  -- belong to the caller; no id resolves the caller's single live row and
  -- returns nothing when two live rows share the login (never pick one).
  if v_uid is null then return; end if;
  if p_agent_id is not null then
    select ag.id into v_id from public.agents ag where ag.id = p_agent_id and ag.user_id = v_uid;
  else
    select count(*) into v_n from public.agents ag where ag.user_id = v_uid and ag.canonical_agent_id is null;
    if v_n = 1 then
      select ag.id into v_id from public.agents ag where ag.user_id = v_uid and ag.canonical_agent_id is null;
    end if;
  end if;
  if v_id is null then return; end if;

  select ag.* into a from public.agents ag where ag.id = v_id;

  select coalesce(bool_or(nullif(btrim(p.full_name), '') is not null and nullif(btrim(p.phone), '') is not null), false),
         coalesce(bool_or(nullif(btrim(p.phone), '') is not null), false),
         max(nullif(btrim(p.full_name), ''))
    into v_profile_complete, v_has_phone, v_full_name
    from public.profiles p
   where (a.user_id is not null and p.user_id = a.user_id) or (a.profile_id is not null and p.id = a.profile_id);

  v_contract_profile := exists (select 1 from public.agent_contract_profile cp where cp.agent_id = v_id);
  v_training_started := exists (select 1 from public.onboarding_progress op where op.agent_id = v_id);
  select coalesce(t.required_complete, false), coalesce(t.required_passed, 0), coalesce(t.required_total, 0)
    into v_req_complete, v_req_passed, v_req_total
    from public.v_training_required_completion t where t.agent_id = v_id;

  -- Contracting. Sam's required-carrier list (audit N7) lives in WP5's
  -- fn_contracting_required_carriers(); read it only if it exists.
  begin
    if to_regprocedure('public.fn_contracting_required_carriers()') is not null then
      execute 'select public.fn_contracting_required_carriers()' into v_required;
    end if;
  exception when others then
    v_required := '{}'::text[];
  end;
  select count(*) into v_marks from public.contract_review_marks m where m.agent_id = v_id;
  if coalesce(cardinality(v_required), 0) > 0 then
    -- N7 answered: "contracted" means every required carrier is marked, which
    -- WP5's trigger records as agents.contracted_at. One mark is not enough.
    v_basis := case
      when a.contracted_at is not null then 'all_required_carriers'
      when a.first_deal_at is not null then 'first_deal'
      else null end;
  else
    -- N7 pending: any staff confirmation counts. The agent's own checkboxes
    -- are returned separately as manual overrides, never as fact.
    v_basis := case
      when v_marks > 0 then 'contract_review_marks'
      when a.contracted_at is not null then 'agents.contracted_at'
      when a.first_deal_at is not null then 'first_deal'
      else null end;
  end if;

  v_booking := public.fn_agent_onboarding_call_booking(v_id);
  if v_booking is not null then
    select ie.scheduled_at into v_booking_at from public.interview_events ie where ie.id = v_booking;
  end if;

  -- The single-use link from the latest delivered onboarding email, unless a
  -- booking was cancelled (that link is spent); else the public scheduling URL.
  select q.meta->>'booking_url' into v_single
    from public.agent_onboarding_queue q
   where q.agent_id = v_id
     and q.email_kind in ('onboarding_call', 'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
     and q.sent_at is not null
     and coalesce(q.meta->>'booking_url', '') like 'https://%'
   order by q.sent_at desc
   limit 1;
  v_had_cancel := exists (
    select 1 from public.interview_events ie
     where ie.call_track = 'onboarding' and ie.canceled_at is not null
       and (ie.agent_id = v_id or (a.source_application_id is not null and ie.application_id = a.source_application_id)));
  v_url := case when v_single is not null and not v_had_cancel then v_single
                else (select nullif(btrim(s.value), '') from public.system_settings s where s.key = 'onboarding_call_scheduling_url') end;

  select coalesce(jsonb_build_object(
           'completed_profile', g.completed_profile,
           'added_phone_number', g.added_phone_number,
           'completed_first_training', g.completed_first_training,
           'received_license', g.received_license,
           'closed_first_deal', g.closed_first_deal,
           'contracted_with_carriers', g.contracted_with_carriers,
           'contracted_ahl_sent', g.contracted_ahl_sent,
           'contracted_ethos_sent', g.contracted_ethos_sent,
           'contracted_chubb_sent', g.contracted_chubb_sent), '{}'::jsonb)
    into v_over
    from public.getting_started_progress g where g.agent_id = v_id
   limit 1;

  return query select
    v_id,
    coalesce(nullif(split_part(coalesce(v_full_name, a.display_name, ''), ' ', 1), ''), 'there'),
    a.onboarding_stage::text,
    a.license_status::text,
    a.created_at,
    v_profile_complete,
    v_has_phone,
    v_training_started,
    v_req_complete,
    v_req_passed,
    v_req_total,
    (v_basis is not null),
    v_basis,
    v_contract_profile,
    (v_booking is not null),
    v_booking_at,
    v_url,
    a.first_deal_at,
    coalesce(v_over, '{}'::jsonb);
end;
$function$;

revoke all on function public.my_activation_state(uuid) from public, anon;
grant execute on function public.my_activation_state(uuid) to authenticated, service_role;
