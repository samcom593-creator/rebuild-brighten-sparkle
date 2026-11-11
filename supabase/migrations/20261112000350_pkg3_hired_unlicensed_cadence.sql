-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 6/9: hired but unlicensed gets three plain nudges (decision N10).
--
-- WHAT: an unlicensed hire gets one "get licensed" email and a Slack invite on day 0, then nothing:
-- 5 of 5 unlicensed hires in the last 30 days heard nothing after day 0; the hired_unlicensed stage
-- has no cadence and no template; 30 of 36 active unlicensed agent rows never appeared in Xcel
-- (message_map 4a G2; timeline_forensics 5 row 3).
--
-- RULE (N10): at most 3 nudges, at day 1, 4 and 10 after hire (agents.created_at); stop on course
-- enrollment, course progress or license; forward-only from a NEW anchor set at apply time; plain copy
-- whose one next step is the pre-licensing course through the partner link, with the 10-minute
-- questions call as the secondary line (templates: hired_unlicensed, hired_unlicensed_d4,
-- hired_unlicensed_d10 from 20261112000320).
--
-- WHY A SEPARATE SWEEP: the shared fn_next_step_nudge_sweep (PKG1) times steps from
-- next_step_progress.entered_at (for agents that is start_date at midnight UTC or created_at), has no
-- per-stage anchor for this stage, and cannot stop on course enrollment because v_next_step_current
-- keeps an enrolled unlicensed agent in hired_unlicensed. So hired_unlicensed.reminder_cadence stays
-- empty and fn_course_lane_hired_unlicensed_sweep(p_dry_run default TRUE) owns the cadence. It uses the
-- shared parser (fn_next_step_cadence_due_local: exact elapsed day, 08:00-21:00 recipient time) and
-- the shared dedupe-key format <agent_id>:hired_unlicensed:day<N>, so nothing can send twice.
--
-- FORWARD-ONLY: system_settings.hired_unlicensed_nudges_from = the apply instant (kept on re-apply).
-- Missing or garbled -> nothing sends. People hired before it are the one-time catch-up's
-- (fn_catchup_hired_unlicensed, 20261112000360), never this sweep's.
--
-- NEVER: an open agent_access_suspensions row or an auth login ban (the agent's login or any login on
-- the same address), no login/email, bounced, unsubscribed, inactive or merged agent row, enrolled in
-- Xcel (matched agent, same email, or the source application), any course stamp, license_progress past
-- unlicensed, licensed. At most one automated email per 20h.
--
-- DISPATCH CONTRACT (PKG1): channel 'email' (the Telegram rung is off) and the step in
-- metadata.lane_step, never metadata.step: PKG1's fn_next_step_send_gate skips a row with a 'step' key
-- whose stage_key is not the person's current next_step_progress stage, and day 4 / day 10 render from
-- TEMPLATE stages (hired_unlicensed_d4 / _d10) that are never anyone's current stage. The sweep asks
-- the stop questions itself at queue time; the cron is scheduled by 20261112000380.
--
-- ROLLBACK: select cron.unschedule('pkg3-hired-unlicensed-sweep'); delete from system_settings
--   where key = 'hired_unlicensed_nudges_from';  (the sweep then sends nothing)

insert into public.system_settings (key, value)
values ('hired_unlicensed_nudges_from', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do nothing;

create or replace function public.fn_course_lane_hired_unlicensed_from()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when s.value ~ '^\d{4}-\d{2}-\d{2}' then s.value::timestamptz end
    from public.system_settings s
   where s.key = 'hired_unlicensed_nudges_from'
$$;

-- Course started in any form we can see: an Xcel identity for the agent (linked, same email, or the
-- source application), a course stamp or proof on the source application, or license_progress past
-- 'unlicensed'. Used to stop the cadence and to scope the catch-up.
create or replace function public.fn_course_lane_agent_course_started(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
           select 1
             from public.agents g
             left join public.profiles p on p.user_id = g.user_id
             left join public.applications a on a.id = g.source_application_id
            where g.id = p_agent_id
              and (public.fn_license_stage_rank(coalesce(g.license_progress, 'unlicensed')) >= 1
                   or a.course_purchased_at is not null or a.course_started_at is not null
                   or a.course_proof_submitted_at is not null
                   or public.fn_license_stage_rank(coalesce(a.license_progress, 'unlicensed')) >= 1
                   or exists (select 1 from public.xcel_pre_licensing_students s
                               where s.matched_agent_id = g.id
                                  or (p.email is not null and lower(btrim(s.email)) = lower(btrim(p.email)))
                                  or (g.source_application_id is not null and s.application_id = g.source_application_id))))
$$;

create or replace function public.fn_course_lane_hired_unlicensed_sweep(p_dry_run boolean default true, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_from timestamptz := public.fn_course_lane_hired_unlicensed_from();
  v_rows jsonb := '[]'::jsonb;
  v_zones text[];
  v_step text;
  v_tpl text;
  v_reason text;
  v_touch timestamptz;
  v_id uuid;
  v_queued int := 0;
  v_started timestamptz := clock_timestamp();
begin
  if v_from is null then
    return jsonb_build_object('dry_run', p_dry_run, 'queued', 0, 'rows', v_rows,
                              'note', 'hired_unlicensed_nudges_from missing or garbled: nothing sends');
  end if;

  for r in
    select g.id as agent_id, g.created_at,
           split_part(btrim(coalesce(nullif(btrim(g.display_name), ''), nullif(btrim(p.full_name), ''), 'there')), ' ', 1) as first_name,
           lower(btrim(p.email)) as email_lower
      from public.agents g
      left join public.profiles p on p.user_id = g.user_id
     where g.canonical_agent_id is null
       and coalesce(g.is_deactivated, false) = false
       and g.status::text = 'active'
       and g.license_status::text is distinct from 'licensed'
       and g.licensed_at is null
       and g.created_at >= v_from
       and g.created_at > now() - interval '12 days'
     order by g.created_at
  loop
    -- exact elapsed day 1, 4 or 10, inside 08:00-21:00 recipient time (the shared parser)
    v_zones := public.fn_next_step_send_zones(null, r.agent_id);
    v_step := public.fn_next_step_cadence_due_local('day:1,4,10', r.created_at, now(), v_zones);
    continue when v_step is null;
    continue when exists (select 1 from public.next_step_messages m
                           where m.dedupe_key = r.agent_id::text || ':hired_unlicensed:' || v_step);

    v_reason := public.fn_course_lane_block_reason(null, r.agent_id);
    if v_reason is null and public.fn_course_lane_agent_course_started(r.agent_id) then
      v_reason := 'course_started';
    end if;
    if v_reason is not null then
      v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'step', v_step,
                                             'action', 'skip', 'reason', v_reason);
      continue;
    end if;

    v_touch := public.fn_course_lane_recent_touch(r.email_lower, null, r.agent_id, interval '20 hours', true);
    if v_touch is not null then
      v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'step', v_step,
                                             'action', 'wait', 'reason', 'emailed_within_20h', 'last_touch_at', v_touch);
      continue;
    end if;

    v_tpl := case v_step when 'day1' then 'hired_unlicensed' when 'day4' then 'hired_unlicensed_d4' else 'hired_unlicensed_d10' end;
    if p_dry_run then
      v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'step', v_step,
                                             'template', v_tpl, 'action', 'would_send');
      continue;
    end if;

    v_id := null;
    -- channel 'email' and metadata.lane_step (never 'step'): see the header's dispatch contract
    insert into public.next_step_messages (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values (null, r.agent_id, v_tpl, 'email',
            'hired_unlicensed:' || v_step,
            r.agent_id::text || ':hired_unlicensed:' || v_step,
            jsonb_build_object('day', substring(v_step from 4)::int, 'lane_step', v_step, 'source', 'auto',
                               'send_zones', coalesce(to_jsonb(v_zones), '"unknown: ET+PT"'::jsonb),
                               'sender', 'fn_course_lane_hired_unlicensed_sweep', 'package', 'MP-ONBOARD-ANCHOR-PKG3'))
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_id;
    continue when v_id is null;
    v_queued := v_queued + 1;
    v_rows := v_rows || jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'step', v_step,
                                           'template', v_tpl, 'action', 'queued', 'message_id', v_id);
    exit when v_queued >= greatest(coalesce(p_limit, 50), 0);
  end loop;

  if not p_dry_run then
    insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body, duration_ms)
    values ('course-lane-hired-unlicensed-sweep', v_started, clock_timestamp(), 'success',
            jsonb_build_object('queued', v_queued, 'rows', v_rows),
            (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int);
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'anchor', v_from, 'queued', v_queued, 'rows', v_rows);
end;
$$;

comment on function public.fn_course_lane_hired_unlicensed_sweep(boolean, integer) is
  'PKG3 N10 (dry_run by default): day 1/4/10 after hire, unlicensed agents hired after system_settings.hired_unlicensed_nudges_from; stops on course enrollment/progress/license; never suspended/bounced/unsubscribed. Inserts next_step_messages (next-step-dispatch sends). Cron: pkg3-hired-unlicensed-sweep.';

revoke all on function public.fn_course_lane_hired_unlicensed_from() from public, anon, authenticated;
revoke all on function public.fn_course_lane_agent_course_started(uuid) from public, anon, authenticated;
revoke all on function public.fn_course_lane_hired_unlicensed_sweep(boolean, integer) from public, anon, authenticated;
grant execute on function public.fn_course_lane_hired_unlicensed_from() to service_role;
grant execute on function public.fn_course_lane_agent_course_started(uuid) to service_role;
grant execute on function public.fn_course_lane_hired_unlicensed_sweep(boolean, integer) to service_role;
