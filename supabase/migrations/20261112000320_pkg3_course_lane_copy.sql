-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 3/9: course and licensing copy without claims, and the
-- template rows the course-lane senders render.
--
-- WHAT (copy): the course/licensing stage rows and the licensing milestone notes carried
-- unverifiable numbers and hype: "Median finish is day 10", "If you're stuck, text your manager",
-- "the longer you wait, the lower your pass rate", "Most people pass on the first try if they test
-- within 7 days of finishing", "Sleep, hydrate, breathe ... Win this.", "LICENSE IS IN. Real work
-- starts now.", "Watch for the contracting link in the next 24h", "We'll text the second it's issued"
-- (message_map_and_copy 2b, 4d). Rewritten as plain steps in Sam's voice, one clear link, brand
-- Galaxy Financial, and the dead "reply STOP" mailto removed from the footer (DECISIONS: Reply path).
-- Replies reach info@kingofsales.net through next-step-dispatch's Reply-To.
--
-- WHAT (cadence; every change below sends FEWER messages to anyone already in a stage):
--   finished_prelicense  hour:24,48,72 -> ''  The exam push and its two reminders now come from
--                        fn_course_lane_exam_sweep (20261112000330), anchored on the push itself:
--                        push at completion, reminder at +72h, last note at +168h (cap 3, unchanged).
--                        The stage cadence ran from a SYNTHETIC entered_at (noon of the enrolment
--                        day), so a finisher who enrolled a week earlier got no exam nudge at all.
--   exam_scheduled       day:-2,-1,0,1 -> ''  Negative day steps never match the parser; day0 landed
--                        on top of the test_scheduled milestone note. The note is the one message.
--   passed_exam          hour:24,48,72 -> hour:72,168  The passed_test note is the first message.
--   hired_unlicensed     '' (unchanged)  Its day 1/4/10 nudges (decision N10) come from
--                        fn_course_lane_hired_unlicensed_sweep (20261112000350), which has its own
--                        forward-only anchor and stop rules that the shared sweep cannot express.
--   started_prelicense   unchanged cadence; copy only.
--   license_milestone_templates.finished_course -> is_active=false: the exam push replaces it
--                        (C10: the note and the ladder fired for the same event).
--
-- WHAT (template rows): next-step-dispatch renders a message from the next_step_stages row named by
-- next_step_messages.stage_key, and supports only fixed placeholders. A per-state exam message needs
-- the state's vendor, fee and booking link in the text, so each state gets a template row
-- (exam_push_<st>, generated from licensing_state_requirements by fn_course_lane_sync_exam_templates
-- and kept in sync by a trigger), plus exam_push_generic for a state without a row, plus
-- hired_unlicensed_d4 / _d10 / _catchup for N10. Same pattern as reactivation_2026_11 (stage 98):
-- no next_step_progress row ever points at them, so the shared sweep never fires them. retired_at is
-- set so the stage pickers (RecruitPipeline, worklist) hide them; next-step-dispatch does not read
-- retired_at. order_index is taken from 300-399.
--
-- PREIMAGE: ops_preimage_snapshots reason 'pkg3_course_lane_copy_preimage' (the five stage rows and
-- the six milestone templates as they were).
-- ROLLBACK: restore the rows from that snapshot (update ... from jsonb_populate_record), and
--   delete from next_step_stages where stage_key like 'exam_push_%' or stage_key like 'hired_unlicensed\_%';
--   (only after no next_step_messages row references them, or keep them: they are inert).

-- ---------------------------------------------------------------------------
-- 0. Preimage (once)
-- ---------------------------------------------------------------------------
insert into public.ops_preimage_snapshots (reason, payload)
select 'pkg3_course_lane_copy_preimage',
       jsonb_build_object(
         'next_step_stages', (select jsonb_agg(to_jsonb(s) order by s.order_index)
                                from public.next_step_stages s
                               where s.stage_key in ('started_prelicense', 'finished_prelicense', 'exam_scheduled',
                                                     'passed_exam', 'hired_unlicensed')),
         'license_milestone_templates', (select jsonb_agg(to_jsonb(t) order by t.template_key)
                                           from public.license_milestone_templates t))
where not exists (select 1 from public.ops_preimage_snapshots where reason = 'pkg3_course_lane_copy_preimage');

-- ---------------------------------------------------------------------------
-- 1. Shared footers (one place, so the next copy pass edits one string)
-- ---------------------------------------------------------------------------
create or replace function public.fn_course_lane_footer(p_audience text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select '<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>'
      || chr(10)
      || '<p style="font-size:11px;color:#6b7280;line-height:1.5">Galaxy Financial · Recruiting Communications<br/>'
      || case p_audience
           when 'agent' then 'You received this because you joined Galaxy Financial.'
           when 'both' then 'You received this because you are getting licensed with Galaxy Financial.'
           else 'You received this because you applied to Galaxy Financial.'
         end
      || ' You can <a href="https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u={{email}}" style="color:#6b7280">unsubscribe</a> at any time.<br/>Galaxy Financial · Dallas, TX</p>'
$$;
comment on function public.fn_course_lane_footer(text) is
  'PKG3: email footer for course-lane templates. Unsubscribe link only; the dead "reply STOP" mailto is gone (replies go to the Reply-To next-step-dispatch sets).';

-- The 10-minute questions call (N2). utm_content carries the id calendly-webhook matches first.
create or replace function public.fn_course_lane_questions_link(p_id_token text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select 'https://calendly.com/apexfinancialempire/licensing-questions?email={{email}}&utm_source=nextstep&utm_medium=email&utm_content={{' || p_id_token || '}}'
$$;

-- ---------------------------------------------------------------------------
-- 2. Stage rows (PKG3-owned: course, exam, licensing, hired_unlicensed)
-- ---------------------------------------------------------------------------
update public.next_step_stages set
  email_subject_template = 'Day {{days_in_stage}} of your pre-licensing course',
  email_body_template = '<p>{{first_name}},</p><p>You are {{days_in_stage}} days into the pre-licensing course. When you finish it, your next step is booking your state exam.</p><p>If something is slowing you down, <a href="'
    || public.fn_course_lane_questions_link('application_id') || '">book a 10-minute questions call</a>.</p><p>Sam</p>'
    || chr(10) || public.fn_course_lane_footer('applicant'),
  sms_template = 'Galaxy Financial: {{first_name}}, day {{days_in_stage}} of your pre-licensing course. Questions? Book 10 min: https://calendly.com/apexfinancialempire/licensing-questions',
  telegram_template = 'Galaxy Financial: {{first_name}}, day {{days_in_stage}} of your pre-licensing course. Questions? Book 10 min: https://calendly.com/apexfinancialempire/licensing-questions',
  candidate_message_template = '{{first_name}}, you are {{days_in_stage}} days into the pre-licensing course. When you finish it, your next step is booking your state exam.',
  manager_alert_template = '{{first_name}} {{last_name}} is {{days_in_stage}} days into the pre-licensing course.',
  notes = 'PKG3 2026-11-12: copy rewritten without unverifiable numbers ("Median finish is day 10", "text your manager"). Cadence unchanged (day:3,7,14,21 plus 30,45,60 for entries after the WP3 cutoff).',
  updated_at = now()
where stage_key = 'started_prelicense';

update public.next_step_stages set
  reminder_cadence = '',
  next_action_label = 'Book your state exam',
  email_subject_template = 'Exam booked yet, {{first_name}}?',
  email_body_template = '<p>{{first_name}},</p><p>You finished the course {{days_in_stage}} days ago. Have you booked your state exam? Add the date on your page so we can line up the next step, or reply if booking it is the problem.</p><p><a href="https://apex-financial.org/status/{{application_id}}">Open your page</a></p><p>Sam</p>'
    || chr(10) || public.fn_course_lane_footer('applicant'),
  sms_template = 'Galaxy Financial: {{first_name}}, have you booked your state exam? Add the date: https://apex-financial.org/status/{{application_id}}',
  telegram_template = 'Galaxy Financial: {{first_name}}, have you booked your state exam? Add the date: https://apex-financial.org/status/{{application_id}}',
  candidate_message_template = '{{first_name}}, you finished the course. Your next step is booking your state exam.',
  manager_alert_template = '{{first_name}} {{last_name}} finished the pre-licensing course and has no exam date on file.',
  notes = 'PKG3 2026-11-12: reminder_cadence emptied on purpose. fn_course_lane_exam_sweep sends the per-state exam push (template exam_push_<st>) at completion and this row''s copy as reminders at +72h and +168h after the push (3 messages, the old cap). Forward-only from system_settings.xcel_writeback_messages_from.',
  updated_at = now()
where stage_key = 'finished_prelicense';

update public.next_step_stages set
  reminder_cadence = '',
  next_action_label = 'Take your state exam',
  email_subject_template = 'Your state exam is on the calendar',
  email_body_template = '<p>{{first_name}},</p><p>Your state exam is on the calendar. Bring a government-issued photo ID and plan to arrive early. After the exam, tell us how it went on your page.</p><p><a href="https://apex-financial.org/status/{{application_id}}">Open your page</a></p><p>Sam</p>'
    || chr(10) || public.fn_course_lane_footer('applicant'),
  sms_template = 'Galaxy Financial: {{first_name}}, your state exam is on the calendar. Bring a photo ID and plan to arrive early.',
  telegram_template = 'Galaxy Financial: {{first_name}}, your state exam is on the calendar. Bring a photo ID and plan to arrive early.',
  candidate_message_template = '{{first_name}}, your state exam is on the calendar. Bring a photo ID and plan to arrive early.',
  manager_alert_template = '{{first_name}} {{last_name}} has a state exam on the calendar.',
  notes = 'PKG3 2026-11-12: reminder_cadence emptied. day:-2,-1,0,1 could only ever fire day0/day1 (the parser never matches a negative day), and day0 landed on top of the test_scheduled milestone note, which stays the one message.',
  updated_at = now()
where stage_key = 'exam_scheduled';

update public.next_step_stages set
  reminder_cadence = 'hour:72,168',
  next_action_label = 'Fingerprints and your license application',
  email_subject_template = '{{first_name}}, next is your license application',
  email_body_template = '<p>{{first_name}},</p><p>You passed your exam {{days_in_stage}} days ago. Next are fingerprints, if your state requires them, and your license application with the state. When your license number posts, add your NPN on your page.</p><p><a href="https://apex-financial.org/status/{{application_id}}">Open your page</a></p><p>Sam</p>'
    || chr(10) || public.fn_course_lane_footer('applicant'),
  sms_template = 'Galaxy Financial: {{first_name}}, add your NPN when your license posts: https://apex-financial.org/status/{{application_id}}',
  telegram_template = 'Galaxy Financial: {{first_name}}, add your NPN when your license posts: https://apex-financial.org/status/{{application_id}}',
  candidate_message_template = '{{first_name}}, you passed your exam. Next are fingerprints, if your state requires them, and your license application.',
  manager_alert_template = '{{first_name}} {{last_name}} passed the state exam. The license application is next.',
  notes = 'PKG3 2026-11-12: hour:24,48,72 -> hour:72,168. The passed_test milestone note is the first message; three nudges on three consecutive days broke the one-a-day rule.',
  updated_at = now()
where stage_key = 'passed_exam';

update public.next_step_stages set
  reminder_cadence = '',
  next_action_label = 'Get licensed: start the pre-license course',
  next_action_url = 'https://apex-financial.org/get-licensed',
  email_subject_template = '{{first_name}}, your first step is your license',
  email_body_template = '<p>{{first_name}},</p><p>Welcome to Galaxy. Your first job is getting your state life insurance license, and that starts with the pre-licensing course.</p><p><a href="https://partners.xcelsolutions.com/afe">Start the pre-licensing course</a></p><p>If you have questions first, <a href="'
    || public.fn_course_lane_questions_link('agent_id') || '">book a 10-minute call</a>.</p><p>Sam</p>'
    || chr(10) || public.fn_course_lane_footer('agent'),
  sms_template = 'Galaxy Financial: {{first_name}}, your first step is your state license. Start the pre-licensing course: https://partners.xcelsolutions.com/afe',
  telegram_template = 'Galaxy Financial: {{first_name}}, your first step is your state license. Start the pre-licensing course: https://partners.xcelsolutions.com/afe',
  candidate_message_template = '{{first_name}}, your first step at Galaxy is your state license. It starts with the pre-licensing course.',
  manager_alert_template = '{{first_name}} {{last_name}} was hired unlicensed and has not started the pre-licensing course.',
  notes = 'PKG3 2026-11-12 (decision N10): day 1 copy. reminder_cadence stays empty on purpose: fn_course_lane_hired_unlicensed_sweep sends day 1 (this row), day 4 (hired_unlicensed_d4) and day 10 (hired_unlicensed_d10) after agents.created_at, only for hires after system_settings.hired_unlicensed_nudges_from, and stops on course enrollment, course progress or license.',
  updated_at = now()
where stage_key = 'hired_unlicensed';

-- ---------------------------------------------------------------------------
-- 3. Template rows. Upsert by key; a new key takes the next free order_index in 300-399.
-- ---------------------------------------------------------------------------
create or replace function public.fn_course_lane_upsert_template(
  p_stage_key text, p_display_name text, p_audience text, p_label text, p_url text,
  p_subject text, p_body_html text, p_short text, p_manager_alert text, p_notes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order int;
begin
  if p_stage_key !~ '^(exam_push_[a-z]{2}|exam_push_generic|hired_unlicensed_(d4|d10|catchup))$' then
    raise exception 'fn_course_lane_upsert_template: % is not a course-lane template key', p_stage_key;
  end if;
  if exists (select 1 from public.next_step_stages where stage_key = p_stage_key) then
    update public.next_step_stages set
      display_name = p_display_name, audience = p_audience, next_action_label = p_label, next_action_url = p_url,
      email_subject_template = p_subject, email_body_template = p_body_html,
      sms_template = p_short, telegram_template = p_short, candidate_message_template = p_short,
      manager_alert_template = p_manager_alert, notes = p_notes,
      reminder_cadence = '', retired_at = coalesce(retired_at, now()), updated_at = now()
     where stage_key = p_stage_key;
    return;
  end if;
  select coalesce(max(order_index), 299) + 1 into v_order
    from public.next_step_stages where order_index between 300 and 399;
  if v_order > 399 then
    raise exception 'fn_course_lane_upsert_template: order_index range 300-399 is full';
  end if;
  insert into public.next_step_stages (
    stage_key, order_index, display_name, audience, owner_role, next_action_label, next_action_url,
    sla_hours, manager_alert_hours, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
    candidate_message_template, manager_alert_template, telegram_template, sms_template,
    email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
  values (
    p_stage_key, v_order, p_display_name, p_audience, 'hiring_manager', p_label, p_url,
    null, null, '', 'flag', 'pre-license', '#06b6d4', 'academic-cap',
    p_short, p_manager_alert, p_short, p_short,
    p_subject, p_body_html, false, 'template_only', 'Template row (never a stage)', p_notes, now());
end;
$$;

-- Exam push per state, generated from licensing_state_requirements (one source for the fees).
create or replace function public.fn_course_lane_sync_exam_templates()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_n int := 0;
  v_fee text;
  v_url text;
  v_note constant text := 'PKG3 template row: the exam push for one state, rendered by next-step-dispatch for next_step_messages rows that fn_course_lane_exam_sweep and fn_catchup_course_finishers insert. Generated from licensing_state_requirements by fn_course_lane_sync_exam_templates; edit the table, not this row.';
begin
  for r in
    select q.state, coalesce(q.state_name, q.state) as state_name, q.exam_vendor,
           coalesce(q.exam_schedule_url, q.exam_vendor_url) as url, q.exam_fee_usd
      from public.licensing_state_requirements q
     where q.is_active and q.exam_vendor is not null
       and coalesce(q.exam_schedule_url, q.exam_vendor_url) ~ '^https://'
  loop
    v_fee := case when r.exam_fee_usd is null then null
                  else '$' || trim(to_char(r.exam_fee_usd, 'FM999990.00')) end;
    v_fee := regexp_replace(v_fee, '\.00$', '');
    v_url := r.url;
    perform public.fn_course_lane_upsert_template(
      'exam_push_' || lower(r.state),
      'Exam push template (' || r.state || ')',
      'both',
      'Book your ' || r.state_name || ' exam with ' || r.exam_vendor,
      v_url,
      '{{first_name}}, book your ' || r.state_name || ' exam',
      '<p>{{first_name}},</p><p>You finished the pre-licensing course. Your next step is the ' || r.state_name
        || ' life insurance exam with ' || r.exam_vendor
        || case when v_fee is null then '.' else ', and the exam fee is ' || v_fee || '.' end
        || '</p><p><a href="' || v_url || '">Book your exam with ' || r.exam_vendor || '</a></p><p>Sam</p>'
        || chr(10) || public.fn_course_lane_footer('both'),
      -- SMS/Telegram text: the gateway keeps 160 characters, so the brand leads and nothing trails the link
      'Galaxy Financial: {{first_name}}, course done. Book your ' || r.state_name || ' exam with ' || r.exam_vendor
        || case when v_fee is null then '' else ' (' || v_fee || ' fee)' end || ': ' || v_url,
      '{{first_name}} {{last_name}} finished the pre-licensing course. The ' || r.state_name || ' exam push went out.',
      v_note);
    v_n := v_n + 1;
  end loop;

  perform public.fn_course_lane_upsert_template(
    'exam_push_generic',
    'Exam push template (state not on file)',
    'both',
    'Book your state exam',
    'https://content.naic.org/state-insurance-departments',
    '{{first_name}}, time to book your state exam',
    '<p>{{first_name}},</p><p>You finished the pre-licensing course. Your next step is your state life insurance exam, and your state insurance department lists the testing company and how to book it.</p><p><a href="https://content.naic.org/state-insurance-departments">Find your state insurance department</a></p><p>Sam</p>'
      || chr(10) || public.fn_course_lane_footer('both'),
    'Galaxy Financial: {{first_name}}, course done. Your state insurance department lists how to book the exam: https://content.naic.org/state-insurance-departments',
    '{{first_name}} {{last_name}} finished the pre-licensing course. Their state has no exam row, so the generic exam push went out.',
    v_note);
  return v_n + 1;
end;
$$;

create or replace function public.fn_course_lane_sync_exam_templates_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.fn_course_lane_sync_exam_templates();
  return null;
exception when others then
  -- a template refresh must never block a fee edit; the doctor drop-in 56 compares the two
  raise warning 'fn_course_lane_sync_exam_templates_trigger: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_course_lane_sync_exam_templates on public.licensing_state_requirements;
create trigger trg_course_lane_sync_exam_templates
  after insert or update or delete on public.licensing_state_requirements
  for each statement execute function public.fn_course_lane_sync_exam_templates_trigger();

do $$
begin
  perform public.fn_course_lane_sync_exam_templates();
end $$;

-- Hired, unlicensed (N10): day 4, day 10 and the one-time catch-up. Day 1 is the hired_unlicensed row.
do $$
declare
  v_note constant text := 'PKG3 template row (decision N10): rendered by next-step-dispatch for next_step_messages rows inserted by fn_course_lane_hired_unlicensed_sweep (d4, d10) or fn_catchup_hired_unlicensed (catchup). Never a stage anyone sits in.';
begin
  perform public.fn_course_lane_upsert_template(
    'hired_unlicensed_d4', 'Hired unlicensed: day 4 (template)', 'agent',
    'Start the pre-licensing course', 'https://partners.xcelsolutions.com/afe',
    'Started the course yet, {{first_name}}?',
    '<p>{{first_name}},</p><p>Have you started the pre-licensing course? It is the step that comes before your state exam.</p><p><a href="https://partners.xcelsolutions.com/afe">Start the pre-licensing course</a></p><p>If cost or timing is in the way, <a href="'
      || public.fn_course_lane_questions_link('agent_id') || '">book 10 minutes</a> and we will talk it through.</p><p>Sam</p>'
      || chr(10) || public.fn_course_lane_footer('agent'),
    'Galaxy Financial: {{first_name}}, have you started the pre-licensing course? It is here: https://partners.xcelsolutions.com/afe',
    '{{first_name}} {{last_name}} is 4 days past hire and has not started the pre-licensing course.',
    v_note);

  perform public.fn_course_lane_upsert_template(
    'hired_unlicensed_d10', 'Hired unlicensed: day 10 (template)', 'agent',
    'Start the pre-licensing course', 'https://partners.xcelsolutions.com/afe',
    '{{first_name}}, my last note about the course',
    '<p>{{first_name}},</p><p>This is my last automatic note about the pre-licensing course. When you are ready, it is here.</p><p><a href="https://partners.xcelsolutions.com/afe">Start the pre-licensing course</a></p><p>Or <a href="'
      || public.fn_course_lane_questions_link('agent_id') || '">book a 10-minute questions call</a> and ask me anything about getting licensed.</p><p>Sam</p>'
      || chr(10) || public.fn_course_lane_footer('agent'),
    'Galaxy Financial: {{first_name}}, last note from me on the pre-licensing course. When you are ready: https://partners.xcelsolutions.com/afe',
    '{{first_name}} {{last_name}} is 10 days past hire with no course started. This was the last automatic note.',
    v_note);

  perform public.fn_course_lane_upsert_template(
    'hired_unlicensed_catchup', 'Hired unlicensed: one-time catch-up (template)', 'agent',
    'Start the pre-licensing course', 'https://partners.xcelsolutions.com/afe',
    '{{first_name}}, your first step is your license',
    '<p>{{first_name}},</p><p>Your first step at Galaxy is your state life insurance license, and it starts with the pre-licensing course.</p><p><a href="https://partners.xcelsolutions.com/afe">Start the pre-licensing course</a></p><p>If you have questions before you start, <a href="'
      || public.fn_course_lane_questions_link('agent_id') || '">book a 10-minute call</a>.</p><p>Sam</p>'
      || chr(10) || public.fn_course_lane_footer('agent'),
    'Galaxy Financial: {{first_name}}, your first step is your state license. Start the pre-licensing course: https://partners.xcelsolutions.com/afe',
    '{{first_name}} {{last_name}} got the one-time course catch-up note.',
    v_note);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Licensing milestone notes (fn_license_milestone_emit; SMS first, email fallback; <= 160 chars)
-- ---------------------------------------------------------------------------
update public.license_milestone_templates set
  body = '{first_name}, your pre-licensing course enrollment is confirmed. Work the modules in order. When you finish, your next step is your state exam. -Galaxy',
  updated_at = now()
where template_key = 'course_purchased';

-- Retired: the per-state exam push from fn_course_lane_exam_sweep is the one message for this event.
update public.license_milestone_templates set
  body = '{first_name}, you finished the pre-licensing course. Your next step is booking your state exam. -Galaxy',
  is_active = false,
  updated_at = now()
where template_key = 'finished_course';

update public.license_milestone_templates set
  body = '{first_name}, your state exam is booked. Bring a government-issued photo ID and plan to arrive early. -Galaxy',
  updated_at = now()
where template_key = 'test_scheduled';

update public.license_milestone_templates set
  body = '{first_name}, congratulations on passing your exam. Next are fingerprints, if your state requires them, and your license application. -Galaxy',
  updated_at = now()
where template_key = 'passed_test';

update public.license_milestone_templates set
  body = '{first_name}, your license application is with the state. When your license number posts, your next step is a 15-minute call with Sam. -Galaxy',
  updated_at = now()
where template_key = 'waiting_on_license';

update public.license_milestone_templates set
  body = '{first_name}, your license is in. Your next step is a 15-minute call with Sam: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone -Galaxy',
  updated_at = now()
where template_key = 'licensed';

-- ---------------------------------------------------------------------------
-- 5. Privileges: template plumbing is internal.
-- ---------------------------------------------------------------------------
revoke all on function public.fn_course_lane_footer(text) from public, anon, authenticated;
revoke all on function public.fn_course_lane_questions_link(text) from public, anon, authenticated;
revoke all on function public.fn_course_lane_upsert_template(text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_course_lane_sync_exam_templates() from public, anon, authenticated;
revoke all on function public.fn_course_lane_sync_exam_templates_trigger() from public, anon, authenticated;
grant execute on function public.fn_course_lane_footer(text) to service_role;
grant execute on function public.fn_course_lane_questions_link(text) to service_role;
grant execute on function public.fn_course_lane_upsert_template(text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.fn_course_lane_sync_exam_templates() to service_role;
