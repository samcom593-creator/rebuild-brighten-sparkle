-- APEX OS redesign §6 (2026-10-06) — expected start vs actual outcome, and the
-- facts behind the onboarding EXCEPTION queue ("No Hire Left Behind").
--
-- WHAT WAS WRONG (measured 2026-10-05, docs/audits/apex-os-redesign-2026-10-05/05-*.md):
--   * No record could say "this hire is expected to start on Oct 7 and has
--     confirmed". agents.start_date is a bare date (34 of 83 live set, 0 in the
--     future) and agents.attendance_status is a good/warning/critical health
--     flag that reads 'good' on 228 of 228 rows. Nothing could hold
--     Confirmed / Likely / Awaiting Response / Not Attending, and nothing could
--     hold Attended / No-Show / Rescheduled against that date.
--   * The NHLB panel read v_onboarding_sequence.next_missing_step, a single
--     chain that put "Join Slack" (1 of 83 verified) ahead of licensing and
--     contracting, so 74 of 84 rows named Slack as the blocker and 0 rows could
--     ever name contracting. The rung booleans are honest; the chain is not.
--
-- WHERE THE NEW COLUMNS LIVE, and why not on public.agents itself:
--   The hire lives on agents, so the plan is keyed 1:1 on agents.id. It is a
--   side table, not new agents columns, because writing agents has side effects
--   a planning note must never trigger:
--     - update_agents_updated_at bumps agents.updated_at, and recruit_pipeline_list
--       shows coalesce(applications.last_contacted_at, agents.updated_at) as
--       "last contacted" — recording an expected start would fake a contact.
--     - trg_truth_dirty (FOR EACH STATEMENT, any UPDATE) marks
--       agent_flags/hierarchy/production truth dirty and forces a rebuild.
--     - trg_agents_track_stage_change runs BEFORE every UPDATE.
--   Expected start and its outcome are about the start, never about employment:
--   no function below writes agents.status, is_inactive or is_deactivated. A
--   no-show stays a no-show; it never becomes a departure.
--
-- HOW HIRED / ACTIVE / INACTIVE / DEPARTED / DECLINED ARE REPRESENTED TODAY
-- (documented, not changed here):
--   hired     = an agents row exists (add-agent); applications has no 'hired' value.
--   active    = agents.status 'active' and is_inactive/is_deactivated not true.
--   inactive  = agents.is_inactive = true (paused); status may still read 'active'.
--   departed  = agents.is_deactivated = true (mark_no_longer_with_us also sets
--               status 'inactive' and is_inactive) — see open item in the impl note.
--   declined  = applicant side only: applications.status rejected/disqualified,
--               Next Step closed_lost. 'not_attending' below is a start answer,
--               not a decline, and changes no status.
--
-- AUDIT: every write lands in public.agent_stage_moves (field 'expected_start' or
-- 'start_outcome'); its CHECK is widened, never narrowed.

create table if not exists public.agent_start_plans (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  expected_start_on date,
  expected_start_status text,
  expected_start_note text,
  expected_start_set_at timestamptz,
  expected_start_set_by uuid,
  start_outcome text,
  start_outcome_on date,
  start_outcome_note text,
  start_outcome_at timestamptz,
  start_outcome_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_start_plans drop constraint if exists agent_start_plans_expected_start_status_check;
alter table public.agent_start_plans add constraint agent_start_plans_expected_start_status_check
  check (expected_start_status is null
         or expected_start_status = any (array['confirmed', 'likely', 'awaiting_response', 'not_attending']));
alter table public.agent_start_plans drop constraint if exists agent_start_plans_start_outcome_check;
alter table public.agent_start_plans add constraint agent_start_plans_start_outcome_check
  check (start_outcome is null or start_outcome = any (array['attended', 'no_show', 'rescheduled']));

comment on table public.agent_start_plans is
  'Expected start (confirmed/likely/awaiting_response/not_attending) and the actual outcome (attended/no_show/rescheduled) for a hire. 1:1 with agents. Written only by set_expected_start / record_start_outcome; never changes employment status.';
comment on column public.agent_start_plans.start_outcome_on is
  'The expected_start_on date the outcome was recorded against. An outcome is current only while it equals expected_start_on.';

create index if not exists agent_start_plans_status_date_idx
  on public.agent_start_plans (expected_start_status, expected_start_on);

alter table public.agent_start_plans enable row level security;
drop policy if exists agent_start_plans_read on public.agent_start_plans;
create policy agent_start_plans_read on public.agent_start_plans
  for select to authenticated
  using (public.fn_recruit_scope_ok(null::uuid, agent_id));
-- No insert/update/delete policy: writes go through the two RPCs below.
revoke all on public.agent_start_plans from anon;
grant select on public.agent_start_plans to authenticated;
grant all on public.agent_start_plans to service_role;

-- Audit vocabulary: widen, never narrow.
alter table public.agent_stage_moves drop constraint if exists agent_stage_moves_field_check;
alter table public.agent_stage_moves add constraint agent_stage_moves_field_check
  check (field = any (array['onboarding_stage', 'license_status', 'expected_start', 'start_outcome']));

-- ---------------------------------------------------------------------------
-- set_expected_start — admin / va_manager / va (all) and managers (their scope,
-- the same fn_recruit_scope_ok gate Recruit Stages edits use).
-- ---------------------------------------------------------------------------
create or replace function public.set_expected_start(
  p_agent_id uuid,
  p_expected_start_on date,
  p_status text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_old public.agent_start_plans;
  v_new public.agent_start_plans;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_agent_id is null then
    raise exception 'agent required' using errcode = '22023';
  end if;
  if not public.fn_recruit_scope_ok(null::uuid, p_agent_id) then
    raise exception 'not allowed to edit this person' using errcode = '42501';
  end if;
  if not exists (select 1 from public.agents a where a.id = p_agent_id) then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  if v_status is not null
     and v_status <> all (array['confirmed', 'likely', 'awaiting_response', 'not_attending']) then
    raise exception 'expected start status must be confirmed, likely, awaiting_response or not_attending'
      using errcode = '22023';
  end if;
  if v_status in ('confirmed', 'likely') and p_expected_start_on is null then
    raise exception 'a confirmed or likely start needs a date' using errcode = '22023';
  end if;
  if p_expected_start_on is not null
     and (p_expected_start_on < v_today - 365 or p_expected_start_on > v_today + 365) then
    raise exception 'start date must be within a year of today' using errcode = '22023';
  end if;

  select * into v_old from public.agent_start_plans sp where sp.agent_id = p_agent_id;

  insert into public.agent_start_plans as sp
    (agent_id, expected_start_on, expected_start_status, expected_start_note,
     expected_start_set_at, expected_start_set_by, updated_at)
  values
    (p_agent_id, p_expected_start_on, v_status, nullif(btrim(coalesce(p_note, '')), ''),
     now(), auth.uid(), now())
  on conflict (agent_id) do update
    set expected_start_on = excluded.expected_start_on,
        expected_start_status = excluded.expected_start_status,
        expected_start_note = excluded.expected_start_note,
        expected_start_set_at = excluded.expected_start_set_at,
        expected_start_set_by = excluded.expected_start_set_by,
        updated_at = now()
  returning * into v_new;

  insert into public.agent_stage_moves (agent_id, field, from_value, to_value, note, moved_by, moved_by_agent_id)
  values (
    p_agent_id, 'expected_start',
    case when v_old.agent_id is null then null
         else coalesce(v_old.expected_start_status, 'unset') || '@' || coalesce(v_old.expected_start_on::text, 'no-date') end,
    coalesce(v_new.expected_start_status, 'unset') || '@' || coalesce(v_new.expected_start_on::text, 'no-date'),
    v_new.expected_start_note, auth.uid(), public.current_agent_id());

  return jsonb_build_object(
    'ok', true,
    'agent_id', p_agent_id,
    'expected_start_on', v_new.expected_start_on,
    'expected_start_status', v_new.expected_start_status,
    'expected_start_set_at', v_new.expected_start_set_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_start_outcome — what actually happened on the expected date.
-- attended / no_show need the date to have arrived (Phoenix). rescheduled can be
-- recorded any time and optionally carries the new date. NOTHING here touches
-- agents.status / is_inactive / is_deactivated: a no-show is not a departure.
-- ---------------------------------------------------------------------------
create or replace function public.record_start_outcome(
  p_agent_id uuid,
  p_outcome text,
  p_new_start_on date default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_plan public.agent_start_plans;
  v_new public.agent_start_plans;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_agent_id is null then
    raise exception 'agent required' using errcode = '22023';
  end if;
  if not public.fn_recruit_scope_ok(null::uuid, p_agent_id) then
    raise exception 'not allowed to edit this person' using errcode = '42501';
  end if;
  if v_outcome is null or v_outcome <> all (array['attended', 'no_show', 'rescheduled']) then
    raise exception 'outcome must be attended, no_show or rescheduled' using errcode = '22023';
  end if;

  select * into v_plan from public.agent_start_plans sp where sp.agent_id = p_agent_id for update;
  if v_plan.agent_id is null or v_plan.expected_start_on is null then
    raise exception 'record an expected start date before its outcome' using errcode = '22023';
  end if;
  if v_outcome in ('attended', 'no_show') and v_plan.expected_start_on > v_today then
    raise exception 'the expected start (%) has not arrived yet', v_plan.expected_start_on using errcode = '22023';
  end if;
  if p_new_start_on is not null and v_outcome <> 'rescheduled' then
    raise exception 'only a reschedule carries a new start date' using errcode = '22023';
  end if;
  if p_new_start_on is not null
     and (p_new_start_on < v_today - 7 or p_new_start_on > v_today + 365) then
    raise exception 'new start date must be between a week ago and a year from today' using errcode = '22023';
  end if;

  update public.agent_start_plans sp
     set start_outcome = v_outcome,
         start_outcome_on = v_plan.expected_start_on,
         start_outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
         start_outcome_at = now(),
         start_outcome_by = auth.uid(),
         -- A reschedule moves the expectation; the new date is not confirmed
         -- until someone confirms it.
         expected_start_on = case when v_outcome = 'rescheduled' and p_new_start_on is not null
                                  then p_new_start_on else sp.expected_start_on end,
         expected_start_status = case when v_outcome = 'rescheduled'
                                      then case when p_new_start_on is not null then 'likely' else 'awaiting_response' end
                                      else sp.expected_start_status end,
         expected_start_set_at = case when v_outcome = 'rescheduled' then now() else sp.expected_start_set_at end,
         expected_start_set_by = case when v_outcome = 'rescheduled' then auth.uid() else sp.expected_start_set_by end,
         updated_at = now()
   where sp.agent_id = p_agent_id
  returning * into v_new;

  insert into public.agent_stage_moves (agent_id, field, from_value, to_value, note, moved_by, moved_by_agent_id)
  values (
    p_agent_id, 'start_outcome',
    coalesce(v_plan.start_outcome, 'none') || '@' || v_plan.expected_start_on::text,
    v_outcome || '@' || v_plan.expected_start_on::text
      || case when p_new_start_on is not null then '->' || p_new_start_on::text else '' end,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), public.current_agent_id());

  return jsonb_build_object(
    'ok', true,
    'agent_id', p_agent_id,
    'start_outcome', v_new.start_outcome,
    'start_outcome_on', v_new.start_outcome_on,
    'expected_start_on', v_new.expected_start_on,
    'expected_start_status', v_new.expected_start_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_onboarding_call_outcome — Attended / No-Show / Rescheduled on a booked
-- onboarding call (interview_events.call_track = 'onboarding'), the existing
-- record for that call. interview_events_outcome_check has no 'attended', so
-- Attended is stored as 'completed' (the existing vocabulary). Scoped like the
-- other writes; refuses any non-onboarding event.
-- ---------------------------------------------------------------------------
create or replace function public.record_onboarding_call_outcome(
  p_event_id uuid,
  p_outcome text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_outcome text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  v_stored text;
  v_ev public.interview_events;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_outcome is null or v_outcome <> all (array['attended', 'no_show', 'rescheduled']) then
    raise exception 'outcome must be attended, no_show or rescheduled' using errcode = '22023';
  end if;
  v_stored := case v_outcome when 'attended' then 'completed' else v_outcome end;

  select * into v_ev from public.interview_events ie where ie.id = p_event_id for update;
  if v_ev.id is null then
    raise exception 'onboarding call not found' using errcode = 'P0002';
  end if;
  if v_ev.call_track is distinct from 'onboarding' then
    raise exception 'not an onboarding call' using errcode = '22023';
  end if;
  if v_ev.agent_id is null then
    if not public.apex_is_admin() then
      raise exception 'this call is not linked to an agent; an admin must record it' using errcode = '42501';
    end if;
  elsif not public.fn_recruit_scope_ok(null::uuid, v_ev.agent_id) then
    raise exception 'not allowed to edit this person' using errcode = '42501';
  end if;
  if v_outcome in ('attended', 'no_show') and v_ev.scheduled_at > now() then
    raise exception 'the call has not happened yet' using errcode = '22023';
  end if;

  update public.interview_events ie
     set outcome = v_stored,
         outcome_at = now(),
         outcome_by = auth.uid(),
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), ie.notes),
         updated_at = now()
   where ie.id = p_event_id;

  return jsonb_build_object('ok', true, 'event_id', p_event_id, 'outcome', v_stored);
end;
$$;

-- ---------------------------------------------------------------------------
-- request_onboarding_call_booking — the exception queue's "send booking link".
-- Scope-checked wrapper over the existing fn_enqueue_onboarding_call_booking,
-- which queues the existing 'onboarding_call' email (agent_onboarding_queue,
-- sent by the existing dispatcher). It returns the inner verdict verbatim
-- ('queued' is not 'sent'). The inner function had EXECUTE for PUBLIC and anon
-- with no role check; it is narrowed to authenticated + service_role here (the
-- 15-minute sweep runs as the owner and is unaffected).
-- ---------------------------------------------------------------------------
create or replace function public.request_onboarding_call_booking(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_agent_id is null or not public.fn_recruit_scope_ok(null::uuid, p_agent_id) then
    raise exception 'not allowed to edit this person' using errcode = '42501';
  end if;
  return public.fn_enqueue_onboarding_call_booking(p_agent_id, 'exception_queue');
end;
$$;

revoke execute on function public.fn_enqueue_onboarding_call_booking(uuid, text) from public, anon;
grant execute on function public.fn_enqueue_onboarding_call_booking(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- onboarding_exception_facts — one row per live hire in the caller's scope with
-- the authoritative receipt behind every onboarding requirement. The browser
-- derives the exception rows (src/lib/onboardingExceptions.ts) so requirement
-- rules are unit-tested; this function only reports facts. Unknown stays null.
--   population: canonical, not a placeholder, not deactivated, not paused
--               (is_inactive), status active or pending.
--   scope: admin / va_manager / va -> all; manager -> fn_contracting_checkin_scope()
--          (the Recruit Stages manager scope) plus hires fn_can_move_hire admits.
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_exception_facts()
returns table (
  agent_id uuid,
  agent_name text,
  owner_agent_id uuid,
  owner_name text,
  agent_status text,
  license_status text,
  onboarding_stage text,
  hired_at timestamptz,
  start_date date,
  licensed_at timestamptz,
  has_account boolean,
  last_sign_in_at timestamptz,
  login_link_sent_at timestamptz,
  login_link_used_at timestamptz,
  has_profile boolean,
  licensing_ready boolean,
  intake_status text,
  intake_at timestamptz,
  contracting_started boolean,
  eo_on_file boolean,
  eft_on_file boolean,
  carrier_active_count integer,
  carrier_pending_count integer,
  carrier_first_active_at timestamptz,
  training_required_total integer,
  training_required_passed integer,
  training_started boolean,
  training_last_activity_at timestamptz,
  has_dialer_login boolean,
  onboarding_call_event_id uuid,
  onboarding_call_at timestamptz,
  onboarding_call_outcome text,
  first_deal_at timestamptz,
  expected_start_on date,
  expected_start_status text,
  expected_start_set_at timestamptz,
  start_outcome text,
  start_outcome_on date,
  start_outcome_at timestamptz,
  last_outreach_at timestamptz,
  last_outreach_kind text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_mgr boolean;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_staff := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  v_mgr := public.has_role(v_uid, 'manager');
  if not (v_staff or v_mgr) then
    raise exception 'onboarding exceptions are for staff and managers' using errcode = '42501';
  end if;

  return query
  with mgr_scope as (
    select s.agent_id as scoped_id
    from public.fn_contracting_checkin_scope() s
    where not v_staff
  ),
  base as (
    select g.*
    from public.agents g
    where g.canonical_agent_id is null
      and not public.is_placeholder_agent(g.agent_code, g.user_id)
      and coalesce(g.is_deactivated, false) = false
      and coalesce(g.is_inactive, false) = false
      and g.status::text = any (array['active', 'pending'])
      and (v_staff
           or g.id in (select ms.scoped_id from mgr_scope ms)
           or public.fn_can_move_hire(g.id))
  )
  select
    b.id,
    coalesce(nullif(btrim(b.display_name), ''), nullif(btrim(pr.full_name), ''))::text,
    own.id,
    nullif(btrim(own.display_name), '')::text,
    b.status::text,
    b.license_status::text,
    b.onboarding_stage::text,
    b.created_at,
    b.start_date,
    b.licensed_at,
    (b.user_id is not null),
    u.last_sign_in_at,
    lk.sent_at,
    lk.used_at,
    (pr.id is not null),
    public.fn_agent_licensing_ready(b.id),
    ci.status::text,
    ci.created_at,
    (exists (select 1 from public.contracting_intakes c2
              where c2.agent_id = b.id and c2.status = any (array['accepted', 'completed']))
       or public.fn_agent_contracting_matched_by_npn(b.id)),
    (nullif(btrim(coalesce(b.eo_certificate_url, '')), '') is not null
       or exists (select 1 from public.contracting_intakes c3
                   where (c3.agent_id = b.id or (nullif(btrim(coalesce(b.nipr_number, '')), '') is not null and c3.npn = b.nipr_number))
                     and nullif(btrim(coalesce(c3.eo_certificate_url, '')), '') is not null)
       or exists (select 1 from public.agent_documents d
                   where d.agent_id = b.id and d.kind = 'eo_certificate' and coalesce(d.status, '') <> 'rejected')),
    (coalesce(b.eft_ready, false)
       or exists (select 1 from public.contracting_intakes c4
                   where (c4.agent_id = b.id or (nullif(btrim(coalesce(b.nipr_number, '')), '') is not null and c4.npn = b.nipr_number))
                     and c4.eft_ready is true)
       or exists (select 1 from public.agent_documents d2
                   where d2.agent_id = b.id and d2.kind = 'voided_check' and coalesce(d2.status, '') <> 'rejected')),
    coalesce(cc.active_n, 0)::integer,
    coalesce(cc.pending_n, 0)::integer,
    cc.first_active_at,
    tr.required_total::integer,
    tr.required_passed::integer,
    coalesce(tp.started, false),
    tp.last_at,
    coalesce(b.has_dialer_login, false),
    oc.id,
    oc.scheduled_at,
    oc.outcome::text,
    b.first_deal_at,
    sp.expected_start_on,
    sp.expected_start_status,
    sp.expected_start_set_at,
    sp.start_outcome,
    sp.start_outcome_on,
    sp.start_outcome_at,
    lo.at,
    lo.kind
  from base b
  left join lateral (
    select p.id, p.full_name
    from public.profiles p
    where p.id = b.profile_id or (b.user_id is not null and p.user_id = b.user_id)
    order by (p.id = b.profile_id) desc nulls last, p.created_at desc nulls last
    limit 1
  ) pr on true
  left join public.agents own on own.id = coalesce(b.manager_id, b.invited_by_manager_id)
  left join auth.users u on u.id = b.user_id
  left join lateral (
    select max(t.created_at) as sent_at, max(t.used_at) as used_at
    from public.magic_login_tokens t
    where t.agent_id = b.id
  ) lk on true
  left join lateral (
    select c.status, c.created_at
    from public.contracting_intakes c
    where c.agent_id = b.id
       or (nullif(btrim(coalesce(b.nipr_number, '')), '') is not null and c.npn = b.nipr_number)
    order by c.created_at desc
    limit 1
  ) ci on true
  -- Carrier authorization: the AgentLink contract mirror (apex_carrier_contracts)
  -- and the native per-carrier checklist (agent_carrier_comp). 'not_started'
  -- checklist rows are an empty grid, not a record of anything.
  left join lateral (
    select count(*) filter (where cx.st = 'active') as active_n,
           count(*) filter (where cx.st = any (array['submitted', 'pending', 'pending_upline_assignment', 'requested',
                                                    'ready_to_send', 'sent', 'agent_action_required', 'issue'])) as pending_n,
           min(cx.active_at) filter (where cx.st = 'active') as first_active_at
    from (
      select lower(coalesce(ac.status, '')) as st, coalesce(ac.activated_date, ac.appointment_date) as active_at
      from public.apex_carrier_contracts ac
      where ac.agent_id = b.id
      union all
      select lower(coalesce(acc.contract_status, '')), acc.contract_completed_at
      from public.agent_carrier_comp acc
      where acc.agent_id = b.id
    ) cx
  ) cc on true
  left join public.v_training_required_completion tr on tr.agent_id = b.id
  left join lateral (
    select true as started, max(greatest(op.started_at, op.completed_at)) as last_at
    from public.onboarding_progress op
    where op.agent_id = b.id
    having count(*) > 0
  ) tp on true
  left join public.interview_events oc on oc.id = public.fn_agent_onboarding_call_booking(b.id)
  left join public.agent_start_plans sp on sp.agent_id = b.id
  left join lateral (
    select o.at, o.kind
    from (
      select m.sent_at as at, ('Next-step ' || m.channel || ' sent')::text as kind
      from public.next_step_messages m
      where m.agent_id = b.id and m.sent_at is not null and m.external_id is not null and m.failed_at is null
      union all
      select q.sent_at, (replace(q.email_kind, '_', ' ') || ' email sent')::text
      from public.agent_onboarding_queue q
      where q.agent_id = b.id and q.sent_at is not null and q.resend_message_id is not null
      union all
      select t.created_at, 'Login link issued'::text
      from public.magic_login_tokens t
      where t.agent_id = b.id
    ) o
    order by o.at desc
    limit 1
  ) lo on true
  order by b.created_at desc;
end;
$$;

revoke all on function public.set_expected_start(uuid, date, text, text) from public, anon;
revoke all on function public.record_start_outcome(uuid, text, date, text) from public, anon;
revoke all on function public.record_onboarding_call_outcome(uuid, text, text) from public, anon;
revoke all on function public.request_onboarding_call_booking(uuid) from public, anon;
revoke all on function public.onboarding_exception_facts() from public, anon;
grant execute on function public.set_expected_start(uuid, date, text, text) to authenticated, service_role;
grant execute on function public.record_start_outcome(uuid, text, date, text) to authenticated, service_role;
grant execute on function public.record_onboarding_call_outcome(uuid, text, text) to authenticated, service_role;
grant execute on function public.request_onboarding_call_booking(uuid) to authenticated, service_role;
grant execute on function public.onboarding_exception_facts() to authenticated, service_role;
