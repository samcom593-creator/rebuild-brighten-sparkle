-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 4/9: course finished -> one "book your state exam" message with
-- the state's exam vendor link and fee, plus an owner task. (DECISIONS: Course -> license.)
--
-- WHAT: finish -> license is the biggest unlicensed leak: 41 course finishers, 10 licensed on record
-- (funnel_now 4e). 8 of the last 10 finishers were never asked about the exam; exam date captured for
-- 0 of 10 (timeline_forensics 5, row 4). The finished_prelicense nudges said "the longer you wait,
-- the lower your pass rate" and linked a generic page.
--
-- HOW: fn_course_lane_exam_sweep(p_dry_run default TRUE) runs hourly from pg_cron (scheduled by the
-- integrator, not by this file). For each person whose course completion is FRESH, it inserts one
-- next_step_messages row; the existing insert trigger hands it to next-step-dispatch, which renders
-- the template row exam_push_<state> (20261112000320) with the vendor, fee and booking link:
--     push      at completion (first allowed hour)                 dedupe <id>:exam_push
--     reminder  push + 72h  (finished_prelicense copy)               dedupe <id>:finished_prelicense:exam_r1
--     last note push + 168h (finished_prelicense copy)               dedupe <id>:finished_prelicense:exam_r2
-- Three messages, the stage's old cap. Reminders only follow an automatic push to an applicant (a
-- one-time catch-up stays one message). The push also writes one inbox task to the recruit owner.
--
-- FORWARD-ONLY: fresh = the completion's latest possible instant is after
-- system_settings.xcel_writeback_messages_from (fn_xcel_event_upper_bound, 20261112000300) and the
-- completion is no older than 14 days. Non-Xcel completions (self-report, staff) use the
-- licensing_milestone_events instant. No cutoff configured = nothing is fresh = nothing sends.
-- Today exactly one person is fresh: Cooper (307a0955), the D1 defect.
--
-- WHO NEVER GETS IT (fn_course_lane_block_reason): an open agent_access_suspensions row (by user or by
-- email), no email, bounced (applications/agents.email_bounced_at or email_suppressions), unsubscribed,
-- do-not-contact, closed/duplicate/terminated, explicit email_consent_given=false on a form application,
-- an applicant who already has an agent row (the agent lane owns them), an exam date or pass on file,
-- licensed. Quiet hours 08:00-21:00 recipient time (fn_next_step_send_ok) and at most one automated
-- email per person per 20h (fn_course_lane_recent_touch) hold a step until the next tick.
--
-- OBJECTS: fn_course_lane_email_suspended, fn_course_lane_block_reason, fn_course_lane_recent_touch,
-- fn_course_lane_owner_user_id, fn_course_lane_course_state, v_course_lane_exam_people (internal),
-- fn_course_lane_exam_sweep. All service-role only.
-- ROLLBACK: select cron.unschedule('pkg3-course-lane-exam-sweep'); then drop the functions/view.

-- ---------------------------------------------------------------------------
-- 1. Shared gates (also used by the hired-unlicensed sweep and the catch-ups)
-- ---------------------------------------------------------------------------
create or replace function public.fn_course_lane_email_suspended(p_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(nullif(btrim(p_email), ''), '') <> ''
     and exists (
       select 1
         from public.agent_access_suspensions s
         left join auth.users u on u.id = s.user_id
         left join public.profiles p on p.user_id = s.user_id
        where s.lifted_at is null
          and (lower(btrim(u.email)) = lower(btrim(p_email)) or lower(btrim(p.email)) = lower(btrim(p_email))))
$$;

create or replace function public.fn_course_lane_block_reason(p_application_id uuid, p_agent_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_user uuid;
  v_bounced boolean := false;
  v_dnc boolean := false;
  v_consent boolean;
  v_source text;
  v_status text;
  v_closed boolean := false;
begin
  if p_application_id is not null then
    select lower(btrim(a.email)), a.email_bounced_at is not null, a.do_not_contact_at is not null,
           a.email_consent_given, a.source, a.status::text,
           (a.terminated_at is not null or a.closed_at is not null or coalesce(a.is_duplicate, false)
            or a.record_type is distinct from 'application')
      into v_email, v_bounced, v_dnc, v_consent, v_source, v_status, v_closed
      from public.applications a
     where a.id = p_application_id;
    if not found then return 'no_record'; end if;
    if v_closed or v_status in ('rejected', 'disqualified', 'lapsed') then return 'closed_or_duplicate'; end if;
    if v_dnc then return 'do_not_contact'; end if;
    -- a person who unticked email consent on the form is not emailed by a sender built here; an
    -- Xcel-roster record was never asked (it came from the partner report), so false there is a default
    if v_consent is false and coalesce(v_source, '') <> 'xcel_roster' then return 'email_consent_false'; end if;
    if public.fn_application_has_agent(p_application_id) then return 'has_agent_row'; end if;
  elsif p_agent_id is not null then
    select lower(btrim(p.email)), g.email_bounced_at is not null, g.user_id,
           (coalesce(g.is_deactivated, false) or g.status::text <> 'active' or g.canonical_agent_id is not null)
      into v_email, v_bounced, v_user, v_closed
      from public.agents g
      left join public.profiles p on p.user_id = g.user_id
     where g.id = p_agent_id;
    if not found then return 'no_record'; end if;
    if v_closed then return 'agent_inactive_or_merged'; end if;
    if v_user is null then return 'no_login'; end if;
    if exists (select 1 from public.agent_access_suspensions s where s.user_id = v_user and s.lifted_at is null) then
      return 'suspended';
    end if;
  else
    return 'no_record';
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then return 'no_email'; end if;
  if public.fn_course_lane_email_suspended(v_email) then return 'suspended'; end if;
  if v_bounced then return 'bounced'; end if;
  if exists (select 1 from public.email_suppressions s where lower(btrim(s.email)) = v_email) then return 'bounced'; end if;
  if exists (select 1 from public.email_unsubscribes u where lower(btrim(u.email)) = v_email) then return 'unsubscribed'; end if;
  return null;
end;
$$;

comment on function public.fn_course_lane_block_reason(uuid, uuid) is
  'PKG3: why a course-lane sender may not message this person now (NULL = may). Suspension (user or email), no email, bounced/suppressed, unsubscribed, do-not-contact, closed/duplicate, form consent false, applicant with an agent row, inactive/merged agent.';

-- Latest touch inside the window, NULL when none, ''infinity'' when it could not look (= do not send).
-- p_any=false counts campaign and ladder email only (the catch-up rule); p_any=true counts any
-- non-internal email (the one-a-day rule).
create or replace function public.fn_course_lane_recent_touch(
  p_email text, p_application_id uuid, p_agent_id uuid, p_since interval, p_any boolean default false)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_em text := lower(btrim(coalesce(p_email, '')));
  v_hash text;
  v_at timestamptz;
  v_t timestamptz;
begin
  select max(m.sent_at) into v_at
    from public.next_step_messages m
   where m.sent_at > now() - p_since
     and ((p_application_id is not null and m.application_id = p_application_id)
       or (p_agent_id is not null and m.agent_id = p_agent_id));

  if v_em <> '' then
    v_hash := encode(sha256(convert_to(v_em, 'UTF8')), 'hex');
    select max(e.created_at) into v_t
      from public.email_events e
     where e.recipient_hash = v_hash
       and e.created_at > now() - p_since
       and coalesce(e.template_hint, 'other') not in ('internal', 'sms_gateway')
       and (p_any or e.template_hint in ('next_step', 'applicant_campaign', 'applicant_followup',
                                         'licensing_drip', 'partial_recovery', 'seminar'));
    v_at := greatest(v_at, v_t);

    select max(coalesce(l.sent_at, l.created_at)) into v_t
      from public.email_delivery_log l
     where lower(btrim(l.recipient_email)) = v_em
       and coalesce(l.sent_at, l.created_at) > now() - p_since
       and coalesce(l.status, '') not in ('failed', 'error', 'suppressed', 'skipped', 'bounced')
       and coalesce(l.template, '') !~* '(admin|internal|owner)'
       and (p_any or coalesce(l.template, '') <> 'submit-application-applicant');
    v_at := greatest(v_at, v_t);

    -- 6e's shared read model, when it is live (contract: one row per email_lower)
    if to_regclass('public.v_recruit_last_touch') is not null then
      begin
        execute 'select greatest(last_campaign_at, last_ladder_at'
                || case when p_any then ', last_any_at' else '' end
                || ') from public.v_recruit_last_touch where email_lower = $1'
           into v_t using v_em;
        if v_t > now() - p_since then v_at := greatest(v_at, v_t); end if;
      exception when others then
        return 'infinity'::timestamptz;
      end;
    end if;
  end if;
  return v_at;
end;
$$;

create or replace function public.fn_course_lane_owner_user_id(p_application_id uuid, p_agent_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v uuid;
begin
  if p_application_id is not null then
    select a.recruiting_owner_user_id into v from public.applications a where a.id = p_application_id;
  end if;
  if v is null and p_agent_id is not null then
    select a.recruiting_owner_user_id into v
      from public.agents g join public.applications a on a.id = g.source_application_id
     where g.id = p_agent_id;
  end if;
  -- an owner who cannot sign in (open suspension, or an auth ban) cannot work the task
  if v is not null and (exists (select 1 from public.agent_access_suspensions s where s.user_id = v and s.lifted_at is null)
                        or exists (select 1 from auth.users u where u.id = v and u.banned_until > now())) then
    v := null;
  end if;
  if v is null then
    -- the recruit owner roster (system_settings.recruit_owner_roster), first active member
    select m.uid into v
      from (select (jsonb_array_elements_text(s.value::jsonb))::uuid as uid
              from public.system_settings s
             where s.key = 'recruit_owner_roster' and s.value ~ '^\s*\[') m
     where public.fn_recruit_user_is_active(m.uid)
     order by m.uid
     limit 1;
  end if;
  return coalesce(v, public.fn_recruit_sam_user_id());
end;
$$;

-- The state the person is getting licensed in: the Xcel course name first (it names the exam state),
-- then the record's own state.
create or replace function public.fn_course_lane_course_state(p_course_name text, p_fallback_state text)
returns text
language sql
stable
set search_path to 'public'
as $$
  -- "Wisconsin Life Pre-licensing" -> "Wisconsin" (\y is the word boundary in Postgres regexes)
  select coalesce(public.us_state_code(nullif(btrim(regexp_replace(coalesce(p_course_name, ''), '\s+Life\y.*$', '', 'i')), '')),
                  public.us_state_code(nullif(btrim(p_fallback_state), '')))
$$;

-- ---------------------------------------------------------------------------
-- 2. Everyone who finished the course and is not licensed, with the facts the senders need.
--    Internal (service role); one row per person (application, or agent when there is no
--    application the person still belongs to).
-- ---------------------------------------------------------------------------
create or replace view public.v_course_lane_exam_people as
with cfg as (
  select public.fn_xcel_cutoff_ts() as cutoff_ts,
         (now() at time zone 'America/Phoenix')::date as today
),
xi as (
  select x.application_id, x.matched_agent_id, x.completed_on, x.course_name,
         public.fn_xcel_event_upper_bound(x.completed_on, x.completed_first_seen_at) as ub
    from public.v_xcel_identity_rollup x
   where x.completed_on is not null
     and (x.application_id is not null or x.matched_agent_id is not null)
),
ev as (
  select e.application_id, e.agent_id, min(e.created_at) as at
    from public.licensing_milestone_events e
   where e.milestone_type = 'completed_course' and e.source <> 'xcel'
   group by 1, 2
),
apps as (
  select 'applicant'::text as person_kind, a.id as application_id, null::uuid as agent_id,
         split_part(btrim(coalesce(nullif(btrim(a.first_name), ''), 'there')), ' ', 1) as first_name,
         lower(btrim(a.email)) as email_lower,
         public.fn_course_lane_course_state(xi.course_name, a.state) as state,
         coalesce(xi.completed_on, (ev.at at time zone 'America/Phoenix')::date) as completed_on,
         nullif(least(coalesce(xi.ub, 'infinity'::timestamptz), coalesce(ev.at, 'infinity'::timestamptz)), 'infinity'::timestamptz) as completion_upper,
         case when xi.ub is not null then 'xcel' when ev.at is not null then 'milestone_event' end as completion_source,
         (a.exam_scheduled_at is not null or a.exam_passed_at is not null or a.test_scheduled_date is not null
          or public.fn_license_stage_rank(coalesce(a.license_progress, 'unlicensed')) >= 3) as exam_on_file,
         (a.license_status::text = 'licensed' or a.licensed_at is not null) as licensed
    from public.applications a
    left join lateral (select x.* from xi x where x.application_id = a.id order by x.completed_on limit 1) xi on true
    left join ev on ev.application_id = a.id
   where coalesce(a.is_duplicate, false) = false
     and coalesce(a.record_type, 'application') = 'application'
     and (xi.completed_on is not null or ev.at is not null or a.license_progress = 'finished_course')
),
agents_only as (
  select 'agent'::text, null::uuid, g.id,
         split_part(btrim(coalesce(nullif(btrim(g.display_name), ''), nullif(btrim(p.full_name), ''), 'there')), ' ', 1),
         lower(btrim(p.email)),
         public.fn_course_lane_course_state(xi.course_name, p.state),
         coalesce(xi.completed_on, (ev.at at time zone 'America/Phoenix')::date),
         nullif(least(coalesce(xi.ub, 'infinity'::timestamptz), coalesce(ev.at, 'infinity'::timestamptz)), 'infinity'::timestamptz),
         case when xi.ub is not null then 'xcel' when ev.at is not null then 'milestone_event' end,
         (public.fn_license_stage_rank(coalesce(g.license_progress, 'unlicensed')) >= 3),
         (g.license_status::text = 'licensed' or g.licensed_at is not null)
    from public.agents g
    left join public.profiles p on p.user_id = g.user_id
    left join lateral (select x.* from xi x where x.matched_agent_id = g.id order by x.completed_on limit 1) xi on true
    left join ev on ev.agent_id = g.id and ev.application_id is null
   where g.canonical_agent_id is null
     and (xi.completed_on is not null or ev.at is not null or g.license_progress = 'finished_course')
),
people as (
  -- an applicant who became an agent is the agent's (fn_course_lane_block_reason also says so)
  select * from apps
  union all
  select ao.* from agents_only ao
),
msgs as (
  select coalesce(m.application_id, m.agent_id) as person_id,
         (max(m.id::text) filter (where m.dedupe_key like '%:exam_push'))::uuid as push_id,
         max(m.metadata ->> 'source') filter (where m.dedupe_key like '%:exam_push') as push_source,
         max(m.created_at) filter (where m.dedupe_key like '%:exam_push') as push_created_at,
         max(m.sent_at) filter (where m.dedupe_key like '%:exam_push') as push_sent_at,
         bool_or(m.dedupe_key like '%:exam_r1') as r1_queued,
         bool_or(m.dedupe_key like '%:exam_r2') as r2_queued
    from public.next_step_messages m
   where m.dedupe_key like '%:exam_push' or m.dedupe_key like '%:finished_prelicense:exam_r_'
   group by 1
)
select pp.person_kind, pp.application_id, pp.agent_id,
       coalesce(pp.application_id, pp.agent_id) as person_id,
       pp.first_name, pp.email_lower, pp.state,
       pp.completed_on, pp.completion_upper, pp.completion_source,
       (cfg.cutoff_ts is not null and pp.completion_upper is not null
        and pp.completion_upper > cfg.cutoff_ts and pp.completed_on >= cfg.today - 14) as is_fresh,
       pp.exam_on_file, pp.licensed,
       case when exists (select 1 from public.next_step_stages s where s.stage_key = 'exam_push_' || lower(coalesce(pp.state, '')))
            then 'exam_push_' || lower(pp.state) else 'exam_push_generic' end as template_stage,
       m.push_id, m.push_source, m.push_created_at, m.push_sent_at,
       exists (select 1 from public.next_step_messages c
                where (c.id = m.push_id or c.fallback_of_id = m.push_id)
                  and c.channel = 'email' and c.external_id is not null and c.sent_at is not null) as push_receipt,
       coalesce(m.r1_queued, false) as r1_queued, coalesce(m.r2_queued, false) as r2_queued,
       public.fn_course_lane_block_reason(pp.application_id, pp.agent_id) as block_reason,
       public.fn_course_lane_owner_user_id(pp.application_id, pp.agent_id) as owner_user_id
  from people pp
  cross join cfg
  left join msgs m on m.person_id = coalesce(pp.application_id, pp.agent_id);

comment on view public.v_course_lane_exam_people is
  'PKG3 internal: every course finisher (Xcel or self/staff-reported) who is a person record, with completion instant, freshness against the Xcel cutoff, exam/licence state, exam-push message state and why they may not be messaged. Service role only (holds email_lower).';
revoke all on public.v_course_lane_exam_people from public, anon, authenticated;
grant select on public.v_course_lane_exam_people to service_role;

-- ---------------------------------------------------------------------------
-- 3. The sweep. dry_run by default; the cron passes p_dry_run => false.
-- ---------------------------------------------------------------------------
create or replace function public.fn_course_lane_exam_sweep(p_dry_run boolean default true, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_rows jsonb := '[]'::jsonb;
  v_step text;
  v_tpl text;
  v_key text;
  v_zones text[];
  v_touch timestamptz;
  v_channel text;
  v_id uuid;
  v_queued int := 0;
  v_days int;
  v_vendor text;
  v_started timestamptz := clock_timestamp();
begin
  if public.fn_xcel_cutoff_ts() is null then
    return jsonb_build_object('dry_run', p_dry_run, 'queued', 0, 'rows', v_rows,
                              'note', 'xcel_writeback_messages_from missing or garbled: nothing is fresh, nothing sends');
  end if;

  for r in
    select * from public.v_course_lane_exam_people p
     where p.is_fresh and not p.exam_on_file and not p.licensed
     order by p.completion_upper
  loop
    v_step := null;
    if r.push_id is null then
      v_step := 'exam_push';
    elsif r.person_kind = 'applicant' and r.push_source = 'auto' and r.push_sent_at is not null then
      if not r.r1_queued and now() >= r.push_sent_at + interval '72 hours' and now() < r.push_sent_at + interval '120 hours' then
        v_step := 'exam_r1';
      elsif not r.r2_queued and now() >= r.push_sent_at + interval '168 hours' and now() < r.push_sent_at + interval '216 hours' then
        v_step := 'exam_r2';
      end if;
    end if;
    continue when v_step is null;

    if r.block_reason is not null then
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'step', v_step, 'action', 'skip', 'reason', r.block_reason);
      continue;
    end if;

    v_zones := public.fn_next_step_send_zones(r.application_id, r.agent_id);
    if not public.fn_next_step_send_ok(v_zones, now()) then
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'step', v_step, 'action', 'wait', 'reason', 'quiet_hours');
      continue;
    end if;

    v_touch := public.fn_course_lane_recent_touch(r.email_lower, r.application_id, r.agent_id, interval '20 hours', true);
    if v_touch is not null then
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'step', v_step, 'action', 'wait', 'reason', 'emailed_within_20h',
                                             'last_touch_at', v_touch);
      continue;
    end if;

    v_tpl := case when v_step = 'exam_push' then r.template_stage else 'finished_prelicense' end;
    v_key := r.person_id::text || case when v_step = 'exam_push' then ':exam_push' else ':finished_prelicense:' || v_step end;
    v_days := greatest(1, floor(extract(epoch from (now() - r.completion_upper)) / 86400.0)::int);

    if p_dry_run then
      v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                             'state', r.state, 'step', v_step, 'template', v_tpl,
                                             'action', 'would_send', 'completed_on', r.completed_on);
      continue;
    end if;

    v_channel := case
      when (r.application_id is not null and exists (select 1 from public.applications a where a.id = r.application_id
                                                       and a.telegram_chat_id is not null and not coalesce(a.telegram_opt_out, false)))
        or (r.agent_id is not null and exists (select 1 from public.agents g where g.id = r.agent_id
                                                 and g.telegram_chat_id is not null and not coalesce(g.telegram_opt_out, false)))
      then 'telegram' else 'email' end;

    v_id := null;
    insert into public.next_step_messages
      (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values
      (r.application_id, r.agent_id, v_tpl, v_channel, case when v_step = 'exam_push' then 'exam_push' else 'finished_prelicense:' || v_step end,
       v_key,
       jsonb_build_object('day', v_days, 'step', v_step, 'source', 'auto', 'state', r.state,
                          'completed_on', r.completed_on, 'completion_source', r.completion_source,
                          'send_zones', coalesce(to_jsonb(v_zones), '"unknown: ET+PT"'::jsonb),
                          'sender', 'fn_course_lane_exam_sweep', 'package', 'MP-ONBOARD-ANCHOR-PKG3'))
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_id;

    if v_id is null then
      continue;  -- someone else queued this exact step first
    end if;
    v_queued := v_queued + 1;
    v_rows := v_rows || jsonb_build_object('person_kind', r.person_kind, 'id', r.person_id, 'first_name', r.first_name,
                                           'state', r.state, 'step', v_step, 'template', v_tpl, 'action', 'queued',
                                           'message_id', v_id);

    if v_step = 'exam_push' then
      select q.exam_vendor into v_vendor from public.licensing_state_requirements q where q.state = r.state and q.is_active;
      perform public.fn_emit_inbox_notification(
        r.owner_user_id, 'course_finished_exam_push',
        r.first_name || ' finished the pre-licensing course (' || coalesce(r.state, 'state not on file') || ')',
        'The exam message went out' || case when v_vendor is not null then ' with the ' || v_vendor || ' booking link' else '' end
          || '. Call within a day and help them pick an exam date.',
        case when r.application_id is not null then '/dashboard/recruiting?lead=' || r.application_id::text else '/dashboard/team' end,
        'high',
        jsonb_build_object('application_id', r.application_id, 'agent_id', r.agent_id, 'message_id', v_id,
                           'source', 'fn_course_lane_exam_sweep'));
    end if;
    v_id := null;
    exit when v_queued >= greatest(coalesce(p_limit, 25), 0);
  end loop;

  if not p_dry_run then
    insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body, duration_ms)
    values ('course-lane-exam-sweep', v_started, clock_timestamp(), 'success',
            jsonb_build_object('queued', v_queued, 'rows', v_rows),
            (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int);
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'queued', v_queued, 'rows', v_rows);
end;
$$;

comment on function public.fn_course_lane_exam_sweep(boolean, integer) is
  'PKG3 (dry_run by default): exam push at a fresh course completion, then reminders at +72h/+168h after an automatic push to an applicant. Inserts next_step_messages (next-step-dispatch sends) and one owner inbox task per push. Forward-only from xcel_writeback_messages_from. Cron: pkg3-course-lane-exam-sweep.';

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.fn_course_lane_email_suspended(text) from public, anon, authenticated;
revoke all on function public.fn_course_lane_block_reason(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_course_lane_recent_touch(text, uuid, uuid, interval, boolean) from public, anon, authenticated;
revoke all on function public.fn_course_lane_owner_user_id(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_course_lane_course_state(text, text) from public, anon, authenticated;
revoke all on function public.fn_course_lane_exam_sweep(boolean, integer) from public, anon, authenticated;
grant execute on function public.fn_course_lane_email_suspended(text) to service_role;
grant execute on function public.fn_course_lane_block_reason(uuid, uuid) to service_role;
grant execute on function public.fn_course_lane_recent_touch(text, uuid, uuid, interval, boolean) to service_role;
grant execute on function public.fn_course_lane_owner_user_id(uuid, uuid) to service_role;
grant execute on function public.fn_course_lane_course_state(text, text) to service_role;
grant execute on function public.fn_course_lane_exam_sweep(boolean, integer) to service_role;
