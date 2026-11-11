-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 7/9: two one-time catch-ups, dry_run by default, never scheduled.
--
-- WHAT: the forward-only senders (exam sweep, hired-unlicensed sweep) never reach people whose moment
-- came before the cutoffs. DECISIONS allows exactly one catch-up message per person for two groups:
--   (a) fn_catchup_course_finishers: Xcel (or self/staff-reported) course finishers in the last 30 days
--       with no license, no exam date and no exam pass on record -> one "book your state exam" message
--       (the same per-state template and the SAME dedupe key <id>:exam_push as the automatic push, so a
--       person can never get both), plus one owner inbox task.
--   (b) fn_catchup_hired_unlicensed: active unlicensed agents hired 45 days ago or less, before the
--       N10 anchor, not enrolled in Xcel -> one course message (hired_unlicensed_catchup,
--       dedupe <agent_id>:hired_unlicensed:catchup).
--
-- EXCLUDED (each row of the dry run says why): an open agent_access_suspensions row; bounced or
-- provider-suppressed; unsubscribed; do-not-contact; closed/duplicate; explicit form consent=false;
-- an applicant who is now an agent (the agent lane owns them); exam booked/passed or licensed;
-- already sent; (a) touched by any campaign or ladder email in the last 7 days, (b) any email in the
-- last 7 days (fn_course_lane_recent_touch, which reads 6e's v_recruit_last_touch when it exists and
-- next_step_messages + email_events + email_delivery_log always); (a) a FRESH finisher (the exam sweep
-- owns them); (b) a hire after the N10 anchor (the sweep owns them). Quiet hours hold a row
-- ("wait_quiet_hours"): run it again inside 08:00-21:00 recipient time.
--
-- HOW TO RUN (integrator): dry run, review the list, then the same call with p_dry_run => false and the
-- reviewed ids in p_ids. p_max caps the batch (10 / 25). Nothing schedules these.
-- ROLLBACK: nothing to roll back before a live run; a sent message cannot be unsent.

create or replace function public.fn_catchup_course_finishers(
  p_dry_run boolean default true, p_ids uuid[] default null, p_max integer default 10)
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
  v_zones text[];
  v_id uuid;
  v_vendor text;
  v_n int := 0;
  v_eligible int := 0;
  v_excluded int := 0;
begin
  for r in
    select * from public.v_course_lane_exam_people p
     where p.completed_on >= (now() at time zone 'America/Phoenix')::date - 30
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

    v_eligible := v_eligible + 1;
    if p_dry_run then
      v_n := v_n + 1;
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'completed_on', r.completed_on, 'template', r.template_stage,
                                             'action', 'would_send');
      continue;
    end if;

    v_id := null;
    insert into public.next_step_messages (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values (r.application_id, r.agent_id, r.template_stage, 'email', 'exam_push', r.person_id::text || ':exam_push',
            jsonb_build_object('day', greatest(1, (now() at time zone 'America/Phoenix')::date - r.completed_on),
                               'step', 'exam_push', 'source', 'catchup', 'state', r.state,
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
                            'excluded', v_excluded, 'rows', v_rows);
end;
$$;

comment on function public.fn_catchup_course_finishers(boolean, uuid[], integer) is
  'PKG3 one-time catch-up (dry_run by default, never scheduled): one per-state exam message to course finishers of the last 30 days the forward-only sweep cannot reach. Shares the dedupe key <id>:exam_push with fn_course_lane_exam_sweep.';

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
  v_zones text[];
  v_id uuid;
  v_n int := 0;
  v_excluded int := 0;
begin
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
                               'step', 'catchup', 'source', 'catchup', 'sender', 'fn_catchup_hired_unlicensed',
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
  'PKG3 one-time catch-up (dry_run by default, never scheduled): one course message to active unlicensed agents hired 45 days ago or less, before the N10 anchor, not enrolled in Xcel and not emailed in 7 days.';

revoke all on function public.fn_catchup_course_finishers(boolean, uuid[], integer) from public, anon, authenticated;
revoke all on function public.fn_catchup_hired_unlicensed(boolean, uuid[], integer) from public, anon, authenticated;
grant execute on function public.fn_catchup_course_finishers(boolean, uuid[], integer) to service_role;
grant execute on function public.fn_catchup_hired_unlicensed(boolean, uuid[], integer) to service_role;
