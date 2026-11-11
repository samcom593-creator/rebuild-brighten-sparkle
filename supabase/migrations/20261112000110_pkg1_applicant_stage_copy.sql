-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 2/9: one applicant drip, per-step copy, live reply path.
--
-- WHAT
--   1. public.next_step_step_copy: per-step email copy (stage_key, step_key) that
--      next-step-dispatch prefers over the stage template (step_key = the cadence step,
--      e.g. 'hour72', or 'rearm' after a missed call). Service role only.
--   2. Applicant stage rows owned by PKG1 (applied, licensed_book_call, call_booked,
--      contacted, completed_application, watched_vsl, and the retired seminar stages):
--        * the dead "reply STOP" mailto (mailto:hello@apex-financial.org, which returns
--          550) is removed from every email footer; the working unsubscribe link stays;
--        * 'applied' and 'licensed_book_call' cadence -> hour:24,72,168 (day 0 is the
--          welcome email; the hour-1 step collided with it, message_map C1);
--        * 'call_booked' cadence -> hour:24: ONE post-call message the day after the call
--          (entered_at is the call time). The sweep only sends it for calls after the
--          PKG1 cutoff and while the call has no outcome (20261112000140);
--        * copy rewritten in Sam's voice: 1-3 short sentences, one link, no income claim,
--          no unverifiable number ("95% of agents...", "6-min"), no promised call-back
--          ("a manager will reach out within 24h"), no emoji, signed Sam.
--   3. email_template_families: the new welcome and ladder subjects map to their families,
--      so email_events receipts keep grading (applicant_welcome / next_step).
-- WHY
--   message_map_and_copy.md sections 4b-4d and 5b/5c; DECISIONS.md "One drip", "Reply path",
--   "After the call". Copy for other packages' stage rows is not touched here; the
--   dispatcher strips the dead mailto from every rendered body at send time.
-- FORWARD-ONLY
--   Cadence and copy changes act only on steps the sweep queues from now on; the existing
--   gates (fn_lane_ladder_cutoff, fn_wp3_cutoff, the 20h step window, dedupe keys) still
--   stop any old applicant from receiving a step they already passed.
-- ROLLBACK
--   The previous rows are snapshotted into system_settings 'anchor_pkg1_stage_backup'
--   (jsonb text). Restore with:
--     update public.next_step_stages s set
--       reminder_cadence = b->>'reminder_cadence', email_subject_template = b->>'email_subject_template',
--       email_body_template = b->>'email_body_template', sms_template = b->>'sms_template',
--       telegram_template = b->>'telegram_template', candidate_message_template = b->>'candidate_message_template',
--       notes = b->>'notes', updated_at = now()
--     from jsonb_array_elements((select value::jsonb from public.system_settings
--                                 where key = 'anchor_pkg1_stage_backup')) b
--     where s.stage_key = b->>'stage_key';
--   drop table public.next_step_step_copy;  (after reverting next-step-dispatch)

-- 0. snapshot the rows this migration edits (first apply only)
insert into public.system_settings (key, value, updated_at)
select 'anchor_pkg1_stage_backup',
       jsonb_agg(jsonb_build_object(
         'stage_key', s.stage_key, 'reminder_cadence', s.reminder_cadence,
         'email_subject_template', s.email_subject_template, 'email_body_template', s.email_body_template,
         'sms_template', s.sms_template, 'telegram_template', s.telegram_template,
         'candidate_message_template', s.candidate_message_template, 'notes', s.notes))::text,
       now()
  from public.next_step_stages s
 where s.stage_key in ('applied', 'watched_vsl', 'completed_application', 'contacted', 'licensed_book_call',
                       'call_booked', 'booked_seminar', 'attended_seminar')
on conflict (key) do nothing;

-- 1. per-step copy
create table if not exists public.next_step_step_copy (
  stage_key     text not null references public.next_step_stages (stage_key) on delete cascade,
  step_key      text not null check (step_key ~ '^(hour[0-9]+|day-?[0-9]+|rearm)$'),
  email_subject text not null,
  email_body    text not null,
  notes         text,
  updated_at    timestamptz not null default now(),
  primary key (stage_key, step_key)
);

comment on table public.next_step_step_copy is
  'MP-ONBOARD-ANCHOR-PKG1: per-step email copy for next-step stages. next-step-dispatch reads it through fn_next_step_send_gate (copy for metadata.variant, else metadata.step) and falls back to next_step_stages.email_*_template. Tokens: {{first_name}} {{email}} {{application_id}} {{next_action_url}} only.';

alter table public.next_step_step_copy enable row level security;
revoke all on public.next_step_step_copy from public, anon, authenticated;
grant select, insert, update, delete on public.next_step_step_copy to service_role;

do $mig$
declare
  -- the footer every PKG1 stage email ends with: unsubscribe link kept, dead mailto gone
  f text := E'\n<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>\n<p style="font-size:11px;color:#6b7280;line-height:1.5">Galaxy Financial · Recruiting Communications<br/>You received this because you applied to Galaxy Financial. You can <a href="https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u={{email}}" style="color:#6b7280">unsubscribe</a> to stop these messages.<br/>Galaxy Financial · Dallas, TX</p>';
  licensed_call text := 'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone?email={{email}}&utm_source=nextstep&utm_medium=email&utm_content={{application_id}}';
  questions_call text := 'https://calendly.com/apexfinancialempire/licensing-questions?email={{email}}&utm_source=nextstep&utm_medium=email&utm_content={{application_id}}';
  licensing_page text := 'https://apex-financial.org/get-licensed?applicationId={{application_id}}';
  status_page text := 'https://apex-financial.org/status/{{application_id}}';
  v_left int;
begin
  -- 2a. applied: unlicensed / pending applicant, no booking (U1-U3, message_map 5b)
  update public.next_step_stages set
    reminder_cadence = 'hour:24,72,168',
    email_subject_template = '{{first_name}}, your licensing steps',
    email_body_template = '<p>{{first_name}}, step 1 is a short video that lays out the whole path to your state license, from the course to the exam.</p><p><a href="' || licensing_page || '#licensing-video">Watch step 1</a></p><p>Sam</p>' || f,
    sms_template = 'Galaxy Financial: {{first_name}}, your licensing steps are here: ' || licensing_page || ' Reply STOP to opt out.',
    telegram_template = '{{first_name}}, your licensing steps are here: ' || licensing_page,
    notes = 'MP-ONBOARD-ANCHOR-PKG1 2026-11-12: cadence hour:24,72,168 (day 0 is the welcome email). Step copy in next_step_step_copy (hour24 video, hour72 questions call, hour168 last note, rearm after a missed call). hour72/hour168 stay forward-only via fn_lane_ladder_cutoff().',
    updated_at = now()
  where stage_key = 'applied';

  -- 2b. licensed_book_call: licensed applicant with no live booking (B1-B3, message_map 5c)
  update public.next_step_stages set
    reminder_cadence = 'hour:24,72,168',
    email_subject_template = '{{first_name}}, pick a time',
    email_body_template = '<p>{{first_name}}, you applied as a licensed agent and haven''t picked a call time yet. If none of the times work, reply with two that do.</p><p><a href="' || licensed_call || '">Pick a time</a></p><p>Sam</p>' || f,
    notes = 'MP-ONBOARD-ANCHOR-PKG1 2026-11-12: cadence hour:24,72,168 (day 0 is the welcome email, which already asks for the booking). Step copy in next_step_step_copy; rearm = after a no_answer/no_show outcome (one per missed call, at most 2). Forward-only via fn_lane_ladder_cutoff() and fn_anchor_pkg1_cutoff().',
    updated_at = now()
  where stage_key = 'licensed_book_call';

  -- 2c. call_booked: ONE post-call message the day after the call (B4, message_map 5c / G1)
  update public.next_step_stages set
    reminder_cadence = 'hour:24',
    email_subject_template = '{{first_name}}, did we connect?',
    email_body_template = '<p>{{first_name}}, we had a call on the calendar yesterday. If we spoke, reply here with any question about your next step. If we missed each other, pick a new time.</p><p><a href="{{next_action_url}}">Pick a new time</a></p><p>Sam</p>' || f,
    sms_template = 'Galaxy Financial: {{first_name}}, did we connect on yesterday''s call? If we missed each other, the email I sent has a link to pick a new time. Reply STOP to opt out.',
    telegram_template = '{{first_name}}, did we connect on yesterday''s call? If we missed each other, the email I sent has a link to pick a new time.',
    notes = 'MP-ONBOARD-ANCHOR-PKG1 2026-11-12: entered_at is the call time, cadence hour:24 = one message the day after the call. The sweep sends it only for calls after fn_anchor_pkg1_cutoff() and only while that call has no outcome; an agent row stops it (dispatcher gate). {{next_action_url}} is set per person by next-step-dispatch to the call they booked (rebook.ts). candidate_message_template is the pre-call page copy and is unchanged.',
    updated_at = now()
  where stage_key = 'call_booked';

  -- 2d. contacted: no unverifiable number, no "your manager called"
  update public.next_step_stages set
    email_subject_template = '{{first_name}}, your next step is the course',
    email_body_template = '<p>{{first_name}}, your next step is the pre-license course. The course link and every step after it are on your licensing page.</p><p><a href="' || licensing_page || '">Open my licensing page</a></p><p>Questions first? Reply here.</p><p>Sam</p>' || f,
    telegram_template = '{{first_name}}, your next step is the pre-license course: {{next_action_url}}',
    candidate_message_template = '{{first_name}}, your next step is the pre-license course. Start it here: {{next_action_url}}',
    updated_at = now()
  where stage_key = 'contacted';

  -- 2e. completed_application (not derived today; reachable only by a manual stage): no promise
  update public.next_step_stages set
    email_subject_template = '{{first_name}}, your application is in',
    email_body_template = '<p>{{first_name}}, your application is in. Your next step is on your page.</p><p><a href="' || status_page || '">Open my page</a></p><p>Sam</p>' || f,
    sms_template = 'Galaxy Financial: {{first_name}}, your application is in. Your next step: ' || status_page || ' Reply STOP to opt out.',
    telegram_template = '{{first_name}}, your application is in. Your next step: ' || status_page,
    candidate_message_template = '{{first_name}}, your application is in. Your next step is on your page.',
    updated_at = now()
  where stage_key = 'completed_application';

  -- 2f. watched_vsl: no promised call-back, no number
  update public.next_step_stages set
    email_subject_template = '{{first_name}}, finish your application',
    email_body_template = '<p>{{first_name}}, you watched the video. Finishing the application is the next step, and it''s short.</p><p><a href="{{next_action_url}}">Finish my application</a></p><p>Sam</p>' || f,
    telegram_template = '{{first_name}}, you watched the video. Finish your application here: {{next_action_url}}',
    candidate_message_template = '{{first_name}}, you watched the video. Finish your application here: {{next_action_url}}',
    updated_at = now()
  where stage_key = 'watched_vsl';

  -- 2g. retired seminar stages: footer only (nothing derives them)
  update public.next_step_stages set
    email_body_template = replace(email_body_template,
      ' or <a href="mailto:hello@apex-financial.org?subject=STOP">reply STOP</a> to stop these messages.',
      ' to stop these messages.'),
    updated_at = now()
  where stage_key in ('booked_seminar', 'attended_seminar')
    and strpos(email_body_template, 'mailto:hello@apex-financial.org') > 0;

  -- 3. step copy
  insert into public.next_step_step_copy (stage_key, step_key, email_subject, email_body, notes) values
    ('applied', 'hour24', '{{first_name}}, your licensing steps',
     '<p>{{first_name}}, step 1 is a short video that lays out the whole path to your state license, from the course to the exam.</p><p><a href="' || licensing_page || '#licensing-video">Watch step 1</a></p><p>Sam</p>' || f,
     'U1, message_map 5b'),
    ('applied', 'hour72', 'Questions before you start the course?',
     '<p>{{first_name}}, if something is holding you back from starting the course, I''d rather hear it. Book 10 minutes and ask me.</p><p><a href="' || questions_call || '">Book a 10-minute call</a></p><p>Sam</p>' || f,
     'U2, message_map 5b'),
    ('applied', 'hour168', '{{first_name}}, last note from me',
     '<p>{{first_name}}, this is my last automatic note. Your licensing page stays open whenever you''re ready. If the timing is wrong, reply and tell me.</p><p><a href="' || status_page || '">Open my licensing page</a></p><p>Sam</p>' || f,
     'U3, message_map 5b. After this the person sits in the owner queue, no more automated email.'),
    ('applied', 'rearm', '{{first_name}}, we missed each other',
     '<p>{{first_name}}, we had a call on the calendar and didn''t connect. Pick a new time that works for you.</p><p><a href="' || questions_call || '">Pick a new time</a></p><p>Sam</p>' || f,
     'After a no_answer / no_show outcome on an unlicensed applicant''s call. One per missed call, at most 2.'),
    ('licensed_book_call', 'hour24', '{{first_name}}, pick a time',
     '<p>{{first_name}}, you applied as a licensed agent and haven''t picked a call time yet. If none of the times work, reply with two that do.</p><p><a href="' || licensed_call || '">Pick a time</a></p><p>Sam</p>' || f,
     'B1, message_map 5c'),
    ('licensed_book_call', 'hour72', '15 minutes, {{first_name}}',
     '<p>{{first_name}}, I''d still like to talk. It''s a 15-minute call, and you''ll know by the end whether Galaxy fits.</p><p><a href="' || licensed_call || '">Pick a time</a></p><p>Sam</p>' || f,
     'B2, message_map 5c'),
    ('licensed_book_call', 'hour168', '{{first_name}}, closing the loop',
     '<p>{{first_name}}, I haven''t heard back, so this is my last note. If you want the call later, this link still works.</p><p><a href="' || licensed_call || '">Pick a time</a></p><p>Sam</p>' || f,
     'B3, message_map 5c. After this the person sits in the owner queue.'),
    ('licensed_book_call', 'rearm', '{{first_name}}, did we connect?',
     '<p>{{first_name}}, I had us down for a call and we didn''t connect. Pick a new time here.</p><p><a href="' || licensed_call || '">Pick a new time</a></p><p>Sam</p>' || f,
     'B4 after a no_answer / no_show outcome. One per missed call, at most 2.')
  on conflict (stage_key, step_key) do update
    set email_subject = excluded.email_subject, email_body = excluded.email_body,
        notes = excluded.notes, updated_at = now();

  -- 4. assert: no PKG1 stage row or step copy still carries the dead mailto
  select count(*) into v_left
    from public.next_step_stages
   where stage_key in ('applied', 'watched_vsl', 'completed_application', 'contacted', 'licensed_book_call',
                       'call_booked', 'booked_seminar', 'attended_seminar')
     and strpos(coalesce(email_body_template, ''), 'mailto:') > 0;
  if v_left > 0 then
    raise exception 'PKG1: % applicant stage row(s) still carry a mailto footer', v_left;
  end if;
  select count(*) into v_left from public.next_step_step_copy where strpos(email_body, 'mailto:') > 0;
  if v_left > 0 then
    raise exception 'PKG1: % step copy row(s) carry a mailto', v_left;
  end if;
end
$mig$;

-- 5. receipts keep grading: the new subjects map to their families (first match by priority)
update public.email_template_families
   set subject_pattern = subject_pattern || '|your galaxy application is in$|book your call with sam$',
       notes = coalesce(notes, '') || ' | PKG1 2026-11-12: day-0 subjects "{first}, your Galaxy application is in" / "{first}, book your call with Sam".'
 where family = 'applicant_welcome'
   and strpos(subject_pattern, 'your galaxy application is in') = 0;

update public.email_template_families
   set subject_pattern = subject_pattern || '|your licensing steps$|questions before you start the course|last note from me$|we missed each other$|, pick a time$|^15 minutes, |closing the loop$|did we connect\?$|your next step is the course$|finish your application$|, your application is in$',
       notes = coalesce(notes, '') || ' | PKG1 2026-11-12: applicant ladder step subjects.'
 where family = 'next_step'
   and strpos(subject_pattern, 'your licensing steps') = 0;
