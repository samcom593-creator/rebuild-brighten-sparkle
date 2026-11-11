-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 7/9: two one-time catch-ups, dry_run by default, never scheduled.
--
-- WHAT: the forward-only senders (exam sweep, hired-unlicensed sweep) never reach people whose moment
-- came before the cutoffs. DECISIONS allows exactly one catch-up message per person for two groups:
--   (a) fn_catchup_course_finishers: Xcel (or self/staff-reported) course finishers in the last
--       p_window_days (default 30; up to 120 covers the whole S1 list) with no license, no exam date
--       and no exam pass on record -> one "book your state exam" message (template exam_catchup_<st>,
--       the same text as the automatic push, and the SAME dedupe key <id>:exam_push, so a person can
--       never get both), plus one owner inbox task.
--   (b) fn_catchup_hired_unlicensed: active unlicensed agents hired 45 days ago or less, before the
--       N10 anchor, not enrolled in Xcel -> one course message (hired_unlicensed_catchup,
--       dedupe <agent_id>:hired_unlicensed:catchup).
--
-- CAMPAIGN TOUCH (DECISIONS integration note, peer 6e's read model): both are campaign touches, not
-- ladder steps. Each person must pass fn_recruit_campaign_touch_ok(email) = true (NULL = could not
-- look = skip), and the two stage keys are registered in recruit_touch_kinds as 'campaign' before the
-- first send, so v_recruit_touches, every other campaign's gate and doctor #53 count them. (The read
-- model classifies next_step_messages by stage_key, which is why the catch-up has its own
-- exam_catchup_<st> template keys.) next_step_messages is one of the nine ledgers the model reads, so
-- the send itself is recorded where the gate looks.
--
-- EXCLUDED (each row of the dry run says why): suspended or login-banned (own login or any login on
-- the address); bounced or provider-suppressed; unsubscribed; do-not-contact; closed/duplicate;
-- explicit form consent=false; an applicant who is now an agent (the agent lane owns them); exam
-- booked/passed or licensed; already has an exam message (also through the source application of an
-- agent); campaign touch inside 7 days (shared gate); (a) any campaign or ladder email in the last 7
-- days, (b) any email in the last 7 days (fn_course_lane_recent_touch: 6e's v_recruit_last_touch plus
-- next_step_messages, email_events, email_delivery_log); (a) a FRESH finisher (the exam sweep owns
-- them); (b) a hire after the N10 anchor (the sweep owns them). Quiet hours hold a row
-- ("wait_quiet_hours"): run it again inside 08:00-21:00 recipient time.
--
-- HOW TO RUN (integrator): dry run, review the list, then the same call with p_dry_run => false AND the
-- reviewed ids in p_ids (a live run without an explicit list raises). p_max caps the batch (10 / 25).
-- Nothing schedules these. Rows are channel 'email' with metadata.lane_step (never 'step': PKG1's send
-- gate would read it as a shared-ladder step and skip the row as 'stage_changed').
-- ROLLBACK: nothing to roll back before a live run; a sent message cannot be unsent. The two
-- recruit_touch_kinds rows: delete from public.recruit_touch_kinds where note like 'PKG3%';

-- ---------------------------------------------------------------------------
-- 1. The shared campaign gate, read safely: NULL when it is missing or errors (= do not send).
-- ---------------------------------------------------------------------------
create or replace function public.fn_course_lane_campaign_touch_ok(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v boolean;
begin
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    return null;
  end if;
  if to_regprocedure('public.fn_recruit_campaign_touch_ok(text, interval)') is null then
    return null;
  end if;
  execute 'select public.fn_recruit_campaign_touch_ok($1, interval ''7 days'')' into v using p_email;
  return v;
exception when others then
  return null;
end;
$$;

comment on function public.fn_course_lane_campaign_touch_ok(text) is
  'PKG3: peer 6e''s fn_recruit_campaign_touch_ok(email, 7 days) for the catch-ups. true = no campaign touch in 7 days; false = there is one; NULL = blank address, gate missing or failed (never send on NULL).';

-- Register the catch-up keys as campaign touches (6e's registry; skipped if it does not exist yet).
do $$
begin
  if to_regclass('public.recruit_touch_kinds') is not null then
    insert into public.recruit_touch_kinds (source, key_pattern, kind, note) values
      ('next_step_messages', 'exam\_catchup\_%', 'campaign',
       'PKG3 one-time course-finisher catch-up (fn_catchup_course_finishers): stage exam_catchup_<state>'),
      ('next_step_messages', 'hired\_unlicensed\_catchup', 'campaign',
       'PKG3 one-time hired-unlicensed catch-up (fn_catchup_hired_unlicensed)')
    on conflict (source, key_pattern) do nothing;
  else
    raise warning 'PKG3: public.recruit_touch_kinds does not exist; the catch-up keys are not registered as campaign touches';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. (a) course finishers
-- ---------------------------------------------------------------------------
create or replace function public.fn_catchup_course_finishers(
  p_dry_run boolean default true, p_ids uuid[] default null, p_max integer default 10, p_window_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_rows jsonb := '[]'::jsonb;
  v_reason text;
  v_touch timestamptz;
  v_gate boolean;
  v_zones text[];
  v_id uuid;
  v_vendor text;
  v_n int := 0;
  v_excluded int := 0;
  v_window int := least(greatest(coalesce(p_window_days, 30), 1), 120);
begin
  if not coalesce(p_dry_run, true) and p_ids is null then
    raise exception 'fn_catchup_course_finishers: a live run needs the reviewed ids in p_ids (run the dry run first)';
  end if;

  for r in
    select * from public.v_course_lane_exam_people p
     where p.completed_on >= (now() at time zone 'America/Phoenix')::date - v_window
     order by p.completed_on desc, p.first_name
  loop
    v_reason := null;
    v_touch := null;
    if r.licensed then v_reason := 'licensed';
    elsif r.exam_on_file then v_reason := 'exam_on_file';
    elsif r.push_id is not null then v_reason := 'already_has_exam_message';
    elsif r.is_fresh then v_reason := 'fresh_finisher_owned_by_exam_sweep';
    else
      v_reason := r.block_reason;
      if v_reason is null then
        v_gate := public.fn_course_lane_campaign_touch_ok(r.email_lower);
        if v_gate is null then v_reason := 'campaign_gate_unreadable';
        elsif not v_gate then v_reason := 'campaign_touch_within_7d';
        end if;
      end if;
      if v_reason is null then
        v_touch := public.fn_course_lane_recent_touch(r.email_lower, r.application_id, r.agent_id, interval '7 days', false);
        if v_touch is not null then v_reason := 'campaign_or_ladder_email_within_7d'; end if;
      end if;
    end if;
    if v_reason is null and p_ids is not null and not (r.person_id = any(p_ids)) then
      v_reason := 'not_in_p_ids';
    end if;
    if v_reason is null then
      v_zones := public.fn_next_step_send_zones(r.application_id, r.agent_id);
      if not public.fn_next_step_send_ok(v_zones, now()) then v_reason := 'wait_quiet_hours'; end if;
    end if;
    if v_reason is null and v_n >= greatest(coalesce(p_max, 10), 0) then v_reason := 'over_p_max'; end if;

    if v_reason is not null then
      v_excluded := v_excluded + 1;
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'completed_on', r.completed_on, 'action', 'skip',
                                             'reason', v_reason, 'last_touch_at', v_touch);
      continue;
    end if;

    if p_dry_run then
      v_n := v_n + 1;
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'completed_on', r.completed_on, 'template', r.catchup_template_stage,
                                             'action', 'would_send');
      continue;
    end if;

    v_id := null;
    insert into public.next_step_messages (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values (r.application_id, r.agent_id, r.catchup_template_stage, 'email', 'exam_catchup', r.person_id::text || ':exam_push',
            jsonb_build_object('day', greatest(1, (now() at time zone 'America/Phoenix')::date - r.completed_on),
                               'lane_step', 'exam_catchup', 'source', 'catchup', 'state', r.state,
                               'completed_on', r.completed_on, 'sender', 'fn_catchup_course_finishers',
                               'package', 'MP-ONBOARD-ANCHOR-PKG3'))
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_id;
    if v_id is null then
      v_rows := v_rows || jsonb_build_object('id', r.person_id, 'first_name', r.first_name, 'action', 'skip', 'reason', 'raced_existing_message');
      continue;
    end if;
    v_n := v_n + 1;
    select q.exam_vendor into v_vendor from public.licensing_state_requirements q where q.state = r.state and q.is_active;
    perform public.fn_emit_inbox_notification(
      r.owner_user_id, 'course_finished_exam_push',
      r.first_name || ' finished the pre-licensing course (' || coalesce(r.state, 'state not on file') || ')',
      'The one-time exam message went out' || case when v_vendor is not null then ' with the ' || v_vendor || ' booking link' else '' end
        || '. Call and help them pick an exam date.',
      case when r.application_id is not null then '/dashboard/recruiting?lead=' || r.application_id::text else '/dashboard/team' end,
      'high', jsonb_build_object('application_id', r.application_id, 'agent_id', r.agent_id, 'message_id', v_id,
                                 'source', 'fn_catchup_course_finishers'));
    v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                           'state', r.state, 'action', 'queued', 'message_id', v_id);
  end loop;

  if not p_dry_run then
    insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body)
    values ('course-lane-catchup-finishers', now(), clock_timestamp(), 'success', jsonb_build_object('queued', v_n, 'rows', v_rows));
  end if;
  return jsonb_build_object('dry_run', p_dry_run, case when p_dry_run then 'would_send' else 'queued' end, v_n,
                            'excluded', v_excluded, 'window_days', v_window, 'rows', v_rows);
end;
$$;

comment on function public.fn_catchup_course_finishers(boolean, uuid[], integer, integer) is
  'PKG3 one-time catch-up (dry_run by default, never scheduled; a live run needs p_ids): one per-state exam message (template exam_catchup_<st>, a campaign touch) to course finishers of the last p_window_days (default 30, max 120) the forward-only sweep cannot reach. Shares the dedupe key <id>:exam_push with fn_course_lane_exam_sweep; gated on fn_recruit_campaign_touch_ok.';

-- ---------------------------------------------------------------------------
-- 3. (b) hired, unlicensed
-- ---------------------------------------------------------------------------
create or replace function public.fn_catchup_hired_unlicensed(
  p_dry_run boolean default true, p_ids uuid[] default null, p_max integer default 25)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_from timestamptz := public.fn_course_lane_hired_unlicensed_from();
  v_rows jsonb := '[]'::jsonb;
  v_reason text;
  v_touch timestamptz;
  v_gate boolean;
  v_zones text[];
  v_id uuid;
  v_n int := 0;
  v_excluded int := 0;
begin
  if not coalesce(p_dry_run, true) and p_ids is null then
    raise exception 'fn_catchup_hired_unlicensed: a live run needs the reviewed ids in p_ids (run the dry run first)';
  end if;

  for r in
    select g.id as agent_id, g.created_at, g.user_id,
           split_part(btrim(coalesce(nullif(btrim(g.display_name), ''), nullif(btrim(p.full_name), ''), 'there')), ' ', 1) as first_name,
           lower(btrim(p.email)) as email_lower
      from public.agents g
      left join public.profiles p on p.user_id = g.user_id
     where g.canonical_agent_id is null
       and coalesce(g.is_deactivated, false) = false
       and g.status::text = 'active'
       and g.license_status::text is distinct from 'licensed'
       and g.licensed_at is null
       and g.created_at >= now() - interval '45 days'
     order by g.created_at desc
  loop
    v_reason := null;
    v_touch := null;
    if v_from is not null and r.created_at >= v_from then
      v_reason := 'hired_after_n10_anchor_owned_by_sweep';
    elsif exists (select 1 from public.next_step_messages m where m.dedupe_key = r.agent_id::text || ':hired_unlicensed:catchup') then
      v_reason := 'already_sent';
    else
      v_reason := public.fn_course_lane_block_reason(null, r.agent_id);
      if v_reason is null and public.fn_course_lane_agent_course_started(r.agent_id) then
        v_reason := 'enrolled_or_course_progress';
      end if;
      if v_reason is null then
        v_gate := public.fn_course_lane_campaign_touch_ok(r.email_lower);
        if v_gate is null then v_reason := 'campaign_gate_unreadable';
        elsif not v_gate then v_reason := 'campaign_touch_within_7d';
        end if;
      end if;
      if v_reason is null then
        v_touch := public.fn_course_lane_recent_touch(r.email_lower, null, r.agent_id, interval '7 days', true);
        if v_touch is not null then v_reason := 'emailed_within_7d'; end if;
      end if;
    end if;
    if v_reason is null and p_ids is not null and not (r.agent_id = any(p_ids)) then v_reason := 'not_in_p_ids'; end if;
    if v_reason is null then
      v_zones := public.fn_next_step_send_zones(null, r.agent_id);
      if not public.fn_next_step_send_ok(v_zones, now()) then v_reason := 'wait_quiet_hours'; end if;
    end if;
    if v_reason is null and v_n >= greatest(coalesce(p_max, 25), 0) then v_reason := 'over_p_max'; end if;

    if v_reason is not null then
      v_excluded := v_excluded + 1;
      v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name,
                                             'hired_on', (r.created_at at time zone 'America/Phoenix')::date,
                                             'action', 'skip', 'reason', v_reason, 'last_touch_at', v_touch);
      continue;
    end if;

    if p_dry_run then
      v_n := v_n + 1;
      v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name,
                                             'hired_on', (r.created_at at time zone 'America/Phoenix')::date,
                                             'template', 'hired_unlicensed_catchup', 'action', 'would_send');
      continue;
    end if;

    v_id := null;
    insert into public.next_step_messages (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values (null, r.agent_id, 'hired_unlicensed_catchup', 'email', 'hired_unlicensed:catchup',
            r.agent_id::text || ':hired_unlicensed:catchup',
            jsonb_build_object('day', greatest(1, (now()::date - (r.created_at at time zone 'utc')::date)),
                               'lane_step', 'catchup', 'source', 'catchup', 'sender', 'fn_catchup_hired_unlicensed',
                               'package', 'MP-ONBOARD-ANCHOR-PKG3'))
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_id;
    if v_id is null then
      v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'action', 'skip', 'reason', 'raced_existing_message');
      continue;
    end if;
    v_n := v_n + 1;
    v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'action', 'queued', 'message_id', v_id);
  end loop;

  if not p_dry_run then
    insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body)
    values ('course-lane-catchup-hired-unlicensed', now(), clock_timestamp(), 'success', jsonb_build_object('queued', v_n, 'rows', v_rows));
  end if;
  return jsonb_build_object('dry_run', p_dry_run, case when p_dry_run then 'would_send' else 'queued' end, v_n,
                            'excluded', v_excluded, 'anchor', v_from, 'rows', v_rows);
end;
$$;

comment on function public.fn_catchup_hired_unlicensed(boolean, uuid[], integer) is
  'PKG3 one-time catch-up (dry_run by default, never scheduled; a live run needs p_ids): one course message (hired_unlicensed_catchup, a campaign touch) to active unlicensed agents hired 45 days ago or less, before the N10 anchor, not enrolled in Xcel, not emailed in 7 days; gated on fn_recruit_campaign_touch_ok.';

revoke all on function public.fn_course_lane_campaign_touch_ok(text) from public, anon, authenticated;
revoke all on function public.fn_catchup_course_finishers(boolean, uuid[], integer, integer) from public, anon, authenticated;
revoke all on function public.fn_catchup_hired_unlicensed(boolean, uuid[], integer) from public, anon, authenticated;
grant execute on function public.fn_course_lane_campaign_touch_ok(text) to service_role;
grant execute on function public.fn_catchup_course_finishers(boolean, uuid[], integer, integer) to service_role;
grant execute on function public.fn_catchup_hired_unlicensed(boolean, uuid[], integer) to service_role;
