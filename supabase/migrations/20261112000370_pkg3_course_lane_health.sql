-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 8/9: guard row for apex-doctor drop-in 56 and the owner's task list.
--
-- v_course_lane_health: exactly ONE row in every state (scalar subqueries), so the drop-in can never go
-- blank-green. Graded by 56-course-lane.sh:
--   WARN  a finisher whose completion is after the Xcel cutoff instant (so the system owns it), who can
--         be messaged (no block reason), finished more than 2 days ago and has no exam message with a
--         provider receipt (Resend id on the email row)
--   WARN  licensing_state_requirements has no active row, or its oldest as_of is more than 180 days old
--   WARN  the newest Xcel report is more than 48h old
--   WARN  an active state row has no exam_push template (the sync trigger failed), or the exam sweep cron
--         is not scheduled while fresh finishers exist
-- History finishers (completion before the cutoff) are context only ("awaiting catch-up"): grading them
-- would keep the check yellow until a human sends a backlog message, which is the wrong incentive.
--
-- v_course_lane_owner_tasks: what the recruit owner should do next in this lane (help a finisher book
-- the exam; call a new Xcel-roster record). Read by the recruit digest (PKG2, cross-package request) and
-- by staff. No contact fields.
-- ROLLBACK: drop view public.v_course_lane_owner_tasks; drop view public.v_course_lane_health;

create or replace view public.v_course_lane_health as
with cfg as (select (now() at time zone 'America/Phoenix')::date as today)
select
  (select count(*) from public.licensing_state_requirements q where q.is_active)::int as lsr_active_rows,
  (select min(q.as_of) from public.licensing_state_requirements q where q.is_active) as lsr_oldest_as_of,
  (select cfg.today - min(q.as_of) from public.licensing_state_requirements q where q.is_active) as lsr_age_days,
  (select count(*) from public.licensing_state_requirements q
    where q.is_active and q.exam_vendor is not null
      and coalesce(q.exam_schedule_url, q.exam_vendor_url) ~ '^https://'
      and not exists (select 1 from public.next_step_stages s where s.stage_key = 'exam_push_' || lower(q.state)))::int
    as lsr_states_missing_template,
  (select max(r.received_at) from public.xcel_pre_licensing_reports r) as latest_xcel_report_at,
  (select (extract(epoch from (now() - max(r.received_at))) / 3600)::int from public.xcel_pre_licensing_reports r)
    as xcel_report_age_hours,
  public.fn_xcel_cutoff_ts() as xcel_cutoff_at,
  (select count(*) from public.v_course_lane_exam_people p
    where p.is_fresh and not p.exam_on_file and not p.licensed and p.block_reason is null
      and p.completion_upper < now() - interval '2 days' and not p.push_receipt)::int as fresh_finishers_unreceipted_2d,
  (select string_agg(p.first_name || ' ' || left(p.person_id::text, 8), ', ' order by p.completion_upper)
     from public.v_course_lane_exam_people p
    where p.is_fresh and not p.exam_on_file and not p.licensed and p.block_reason is null
      and p.completion_upper < now() - interval '2 days' and not p.push_receipt) as fresh_finishers_unreceipted_2d_list,
  (select count(*) from public.v_course_lane_exam_people p
    where p.is_fresh and not p.exam_on_file and not p.licensed)::int as fresh_finishers_open,
  (select count(*) from public.v_course_lane_exam_people p
    where p.is_fresh and not p.exam_on_file and not p.licensed and p.block_reason is not null)::int as fresh_finishers_blocked,
  (select count(*) from public.v_course_lane_exam_people p
    where not p.is_fresh and not p.exam_on_file and not p.licensed and p.push_id is null
      and p.completed_on >= cfg.today - 30)::int as recent_finishers_awaiting_catchup,
  (select count(*) from public.next_step_messages m
    where m.dedupe_key like '%:exam_push' and m.created_at > now() - interval '7 days')::int as exam_messages_7d,
  (select count(*) from public.next_step_messages m
    where m.dedupe_key like '%:exam_push' and m.created_at > now() - interval '7 days'
      and exists (select 1 from public.next_step_messages c
                   where (c.id = m.id or c.fallback_of_id = m.id) and c.channel = 'email'
                     and c.external_id is not null and c.sent_at is not null))::int as exam_messages_receipted_7d,
  (select count(*) from cron.job j where j.jobname = 'pkg3-course-lane-exam-sweep' and j.active)::int as exam_sweep_cron_active,
  (select count(*) from cron.job j where j.jobname = 'pkg3-hired-unlicensed-sweep' and j.active)::int as hired_unlicensed_cron_active,
  (select max(l.triggered_at) from public.automation_run_log l where l.job_name = 'course-lane-exam-sweep') as last_exam_sweep_at,
  public.fn_course_lane_hired_unlicensed_from() as hired_unlicensed_anchor,
  (select count(*) from public.next_step_messages m
    where m.dedupe_key like '%:hired_unlicensed:day%' and m.created_at > now() - interval '7 days')::int as hired_unlicensed_nudges_7d,
  (select count(*) from public.v_xcel_identity_rollup x where not x.is_linked and x.is_active)::int as xcel_unmatched_active
  from cfg;

comment on view public.v_course_lane_health is
  'PKG3 guard (apex-doctor drop-in 56): one row of scalar operands for the course lane: state fee table freshness, Xcel report age, fresh finishers without a receipted exam message, cron presence, template sync.';
revoke all on public.v_course_lane_health from public, anon, authenticated;
grant select on public.v_course_lane_health to service_role;

create or replace view public.v_course_lane_owner_tasks as
select 'help_book_exam'::text as task,
       p.owner_user_id,
       public.fn_staff_first_name(p.owner_user_id) as owner_first_name,
       p.person_kind, p.application_id, p.agent_id, p.first_name, p.state,
       p.completed_on as event_on,
       p.push_sent_at as since,
       'Finished the course; the exam message went out. Help them pick an exam date.'::text as next_action
  from public.v_course_lane_exam_people p
 where p.push_sent_at is not null
   and p.push_sent_at > now() - interval '14 days'
   and not p.exam_on_file and not p.licensed
   and coalesce(p.block_reason, '') not in ('suspended', 'unsubscribed', 'do_not_contact')
union all
select 'call_new_xcel_record',
       a.recruiting_owner_user_id,
       public.fn_staff_first_name(a.recruiting_owner_user_id),
       'applicant', a.id, null::uuid,
       split_part(btrim(a.first_name), ' ', 1), a.state,
       (a.created_at at time zone 'America/Phoenix')::date,
       a.created_at,
       'Xcel student with no application until now. Call to confirm their state and next step.'
  from public.applications a
 where a.source = 'xcel_roster' and 'pkg3' = any(coalesce(a.tags, '{}'::text[]))
   and a.created_at > now() - interval '14 days'
   and a.human_last_contact_at is null
   and not public.fn_course_lane_email_suspended(a.email);

comment on view public.v_course_lane_owner_tasks is
  'PKG3: the recruit owner''s course-lane tasks (help a finisher book the exam after the exam message; call a new Xcel-roster record). First names only, no contact fields. Service role (digest) only.';
revoke all on public.v_course_lane_owner_tasks from public, anon, authenticated;
grant select on public.v_course_lane_owner_tasks to service_role;
