-- MP-ONBOARD-LANE-LADDER (2026-11-11)
--
-- The applicant ladder ignored two facts it already had: license status and bookings.
--   * every completed application derived to 'applied' and got three emails saying
--     "step 1: watch the 6-minute video" (64 licensed people among them);
--   * 45 licensed applicants at 'contacted' were told to "start your pre-license course";
--   * a booking never moved anyone: people with two booked calls stayed on "step 1".
-- Measured before this change: 75 applicants in 90 days, 3 with a recorded human contact.
--
-- This migration:
--   1. adds 'licensed_book_call' and 'call_booked' stages (retired seminar stages move
--      to order 95/96 to free the two unique order_index slots between contacted and
--      started_prelicense);
--   2. rewrites the 'applied' step for what it now is: an unlicensed applicant whose
--      next step is the licensing page (the same primary action as the confirmation page);
--   3. derives the stage from license status and interview_events;
--   4. recomputes a person when a booking is created, moved, cancelled or given an outcome;
--   5. is FORWARD-ONLY: fn_lane_ladder_cutoff() gates the new stage and the new long
--      steps, so nobody who applied before the cutoff receives a message from this change.

create or replace function public.fn_lane_ladder_cutoff()
returns timestamptz language sql immutable
set search_path = public
as $$ select timestamptz '2026-11-08 19:00:00+00' $$;

comment on function public.fn_lane_ladder_cutoff() is
  'Forward-only gate for 20261111220000: licensed_book_call nudges and the applied hour72/hour168 steps fire only for people who entered the stage after this instant.';

-- 1. free order_index 5 and 6 (retired stages, 0 progress rows)
update public.next_step_stages set order_index = 95 where stage_key = 'booked_seminar' and order_index = 5;
update public.next_step_stages set order_index = 96 where stage_key = 'attended_seminar' and order_index = 6;

insert into public.next_step_stages
  (stage_key, order_index, display_name, audience, owner_role, next_action_label, next_action_url,
   sla_hours, manager_alert_hours, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
   candidate_message_template, manager_alert_template, telegram_template, sms_template,
   email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes)
select
  'licensed_book_call', 5, 'Licensed: Book Call', 'applicant', 'sam',
  'Book your 15-minute call with Sam',
  'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone',
  72, c.manager_alert_hours, 'hour:1,24,72,168', 'flag', c.dashboard_section, c.color_hex, c.icon_name,
  '{{first_name}}, you''re licensed, so the next step is a 15-minute call with Sam. Pick a time: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone?utm_source=nextstep&utm_medium=sms&utm_content={{application_id}}',
  c.manager_alert_template,
  '{{first_name}}, you''re licensed, so the next step is a 15-minute call with Sam. Pick a time: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone?utm_source=nextstep&utm_medium=sms&utm_content={{application_id}}',
  '{{first_name}}, you''re licensed, so the next step is a 15-minute call with Sam. Pick a time: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone?utm_source=nextstep&utm_medium=sms&utm_content={{application_id}}',
  '{{first_name}}, book your call with Sam',
  '<p>{{first_name}},</p><p>You''re already licensed, so you skip the licensing steps. The next move is a 15-minute call with Sam James.</p><p>He calls the number you enter, so pick up even if you don''t recognize it. Have your NPN and the states you''re licensed in ready.</p><p><a href="https://calendly.com/apexfinancialempire/licensed-prospect-call-clone?email={{email}}&utm_source=nextstep&utm_medium=email&utm_content={{application_id}}">Pick your time</a></p><p>If none of the times work, reply to this email with two that do.</p><p>Galaxy Financial</p>'
  || E'\n<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>\n<p style="font-size:11px;color:#6b7280;line-height:1.5">Galaxy Financial · Recruiting Communications<br/>You received this because you applied to Galaxy Financial. You can <a href="https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u={{email}}" style="color:#6b7280">unsubscribe</a> or <a href="mailto:hello@apex-financial.org?subject=STOP">reply STOP</a> to stop these messages.<br/>Galaxy Financial · Dallas, TX</p>',
  false, 'on_call_booked', 'Licensed, never booked',
  'MP-ONBOARD-LANE-LADDER. Licensed applicant with no live booking. utm_content carries the bare application UUID so calendly-webhook attributes the booking exactly. Forward-only via fn_lane_ladder_cutoff().'
from public.next_step_stages c where c.stage_key = 'contacted'
on conflict (stage_key) do nothing;

insert into public.next_step_stages
  (stage_key, order_index, display_name, audience, owner_role, next_action_label, next_action_url,
   sla_hours, manager_alert_hours, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
   candidate_message_template, manager_alert_template, telegram_template, sms_template,
   email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes)
select
  'call_booked', 6, 'Call Booked', 'applicant', 'hiring_manager',
  'Take the call, then record the outcome', null,
  24, c.manager_alert_hours, '', 'flag', c.dashboard_section, c.color_hex, c.icon_name,
  '{{first_name}}, your call is booked. Pick up from a number you don''t recognize.',
  c.manager_alert_template, '{{first_name}}, your call is booked. Pick up from a number you don''t recognize.', '{{first_name}}, your call is booked. Pick up from a number you don''t recognize.',
  'Your call is booked', '<p>{{first_name}}, your call is booked. Pick up from a number you don''t recognize.</p>',
  false, 'on_call_outcome', 'Call held, no outcome recorded',
  'MP-ONBOARD-LANE-LADDER. Applicant has a booking that is not cancelled and has no dead outcome. entered_at is the call time, so the 24h SLA stalls the row one day AFTER the call if nobody recorded an outcome. reminder_cadence is empty on purpose: Calendly sends the reminders, the ladder stays quiet.'
from public.next_step_stages c where c.stage_key = 'contacted'
on conflict (stage_key) do nothing;

-- 2. 'applied' is now only reached by unlicensed/pending applicants with no booking
update public.next_step_stages set
  display_name = 'Applied: Start Licensing',
  next_action_label = 'Start your licensing (video + course)',
  next_action_url = 'https://apex-financial.org/get-licensed',
  reminder_cadence = 'hour:1,24,72,168',
  email_subject_template = '{{first_name}}, your next step: get licensed',
  email_body_template =
    '<p>{{first_name}},</p><p>We have your application. Before you can write business you need a state life insurance license, and the whole path is on one page: a short video that walks it start to finish, then the pre-license course.</p><p><a href="https://apex-financial.org/get-licensed?applicationId={{application_id}}#licensing-video">Start step 1</a></p><p>Once you enroll, upload your receipt on that same page. That unlocks your licensing call with Sam.</p><p>If you get stuck, reply to this email.</p><p>Galaxy Financial</p>'
    || E'\n<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>\n<p style="font-size:11px;color:#6b7280;line-height:1.5">Galaxy Financial · Recruiting Communications<br/>You received this because you applied to Galaxy Financial. You can <a href="https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u={{email}}" style="color:#6b7280">unsubscribe</a> or <a href="mailto:hello@apex-financial.org?subject=STOP">reply STOP</a> to stop these messages.<br/>Galaxy Financial · Dallas, TX</p>',
  candidate_message_template = '{{first_name}}, Galaxy has your application. Your next step is getting licensed. Start here: https://apex-financial.org/get-licensed?applicationId={{application_id}}#licensing-video',
  notes = 'MP-ONBOARD-LANE-LADDER 2026-11-11: was "step 1: watch the 6-minute video" sent to every completed applicant incl. licensed ones. Now unlicensed-only and points at the licensing page, matching ApplicationConfirmationV2. hour72/hour168 are forward-only (fn_lane_ladder_cutoff).',
  updated_at = now()
where stage_key = 'applied';

-- 3. derive from license status + bookings. Rewritten in place from the live definition
--    (CREATE OR REPLACE keeps the 4 dependent views); every replacement is asserted.
do $mig$
declare
  v_def text := pg_get_viewdef('public.v_next_step_current'::regclass, true);
  v_live text := $q$(EXISTS ( SELECT 1 FROM interview_events ie WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome::text <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text])))))$q$;
  v_a1 text := $q$WHEN a.last_contacted_at IS NOT NULL THEN 'contacted'::text$q$;
  v_a2 text := $q$WHEN a.seminar_attended_at IS NOT NULL THEN a.seminar_attended_at$q$;
  v_new text;
begin
  if strpos(v_def, 'call_booked') > 0 then
    raise notice 'v_next_step_current already lane-aware; skipping';
    return;
  end if;
  if strpos(v_def, v_a1) = 0 or strpos(v_def, v_a2) = 0 then
    raise exception 'v_next_step_current anchors not found; refusing to rewrite';
  end if;
  v_new := replace(v_def, v_a1,
    'WHEN ' || v_live || $q$ THEN 'call_booked'::text
                    WHEN a.license_status::text = 'licensed'::text THEN 'licensed_book_call'::text
                    $q$ || v_a1);
  v_new := replace(v_new, v_a2,
    'WHEN ' || v_live || $q$ THEN ( SELECT max(ie2.scheduled_at) FROM interview_events ie2 WHERE ie2.application_id = a.id AND ie2.canceled_at IS NULL AND NOT COALESCE(ie2.is_backfill_duplicate, false))
                    $q$ || v_a2);
  if v_new = v_def or strpos(v_new, 'licensed_book_call') = 0 then
    raise exception 'v_next_step_current rewrite did not land';
  end if;
  execute 'create or replace view public.v_next_step_current as ' || v_new;
end
$mig$;

-- 4. a booking moves the person
create or replace function public.fn_next_step_interview_recompute_trigger()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  begin
    if new.application_id is not null then
      perform public.fn_next_step_recompute_one(new.application_id, null);
    end if;
    if tg_op = 'UPDATE' and old.application_id is not null
       and old.application_id is distinct from new.application_id then
      perform public.fn_next_step_recompute_one(old.application_id, null);
    end if;
  exception when others then
    -- the ladder must never roll back a booking write
    raise warning 'fn_next_step_interview_recompute_trigger: %', sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.fn_next_step_interview_recompute_trigger() from public, anon, authenticated;

drop trigger if exists trg_next_step_interview_events_recompute on public.interview_events;
create trigger trg_next_step_interview_events_recompute
  after insert or update of application_id, canceled_at, outcome, scheduled_at, is_backfill_duplicate, call_track
  on public.interview_events
  for each row execute function public.fn_next_step_interview_recompute_trigger();

-- 5. forward-only gate inside the sweep (asserted in-place edit of the live function)
do $mig$
declare
  v_def text := pg_get_functiondef('public.fn_next_step_nudge_sweep()'::regprocedure);
  v_anchor text := 'continue when v_key is null;';
  v_new text;
begin
  if strpos(v_def, 'fn_lane_ladder_cutoff') > 0 then
    raise notice 'nudge sweep already gated; skipping';
    return;
  end if;
  if strpos(v_def, v_anchor) = 0 then
    raise exception 'nudge sweep anchor not found; refusing to edit';
  end if;
  v_new := replace(v_def, v_anchor, v_anchor || $q$
    -- MP-ONBOARD-LANE-LADDER (20261111220000) is forward-only: the new licensed stage and
    -- the new long 'applied' steps never fire for someone who entered before the cutoff.
    continue when r.entered_at < public.fn_lane_ladder_cutoff()
      and (r.current_stage_key = 'licensed_book_call'
        or (r.current_stage_key = 'applied' and v_key in ('hour72', 'hour168')));$q$);
  if v_new = v_def then raise exception 'nudge sweep edit did not land'; end if;
  execute v_new;
end
$mig$;

-- 6. settle every row onto the new derivation (no sends: see the gate above)
select * from public.fn_next_step_recompute_all();

-- 7. the 10-minute "Licensing Questions" call (Calendly event created 2026-11-11) is the
--    human path BEFORE the course purchase. 72 unlicensed applicants in 90 days, 4 bought
--    the course while the only call sat behind a receipt upload.
update public.next_step_stages set
  email_body_template = replace(email_body_template,
    '<p>If you get stuck, reply to this email.</p>',
    '<p>Want to talk it through before you buy anything? <a href="https://calendly.com/apexfinancialempire/licensing-questions?email={{email}}&utm_source=nextstep&utm_medium=email&utm_content={{application_id}}">Book a 10-minute questions call</a>.</p>'),
  candidate_message_template = candidate_message_template
    || ' Questions first? 10-min call: https://calendly.com/apexfinancialempire/licensing-questions?utm_source=nextstep&utm_medium=sms&utm_content={{application_id}}',
  updated_at = now()
where stage_key = 'applied' and strpos(email_body_template, 'licensing-questions') = 0;

-- 8. a license_status change must move the person too (it was not in the trigger's column
--    list, so an applicant marked licensed stayed on the unlicensed step until some other
--    column happened to change).
drop trigger if exists trg_next_step_applications_update on public.applications;
create trigger trg_next_step_applications_update
  after update of vsl_watched_at, contacted_at, last_contacted_at, seminar_registered_at, seminar_date,
    seminar_attended_at, course_started_at, course_purchased_at, license_progress, license_status,
    exam_scheduled_at, exam_passed_at, fingerprints_submitted_at, fingerprint_done, license_approved_at,
    licensed_at, contracted_at, status, first_deal_at, terminated_at, closed_at, is_duplicate
  on public.applications
  for each row execute function public.fn_next_step_applications_recompute_trigger();

-- 9. health: one row in every state (scalar subqueries only, never blank-green).
--    Graded operands are things the system controls. Conversion counts are published,
--    never graded: a quiet week is weather, not a defect.
create or replace view public.v_applicant_lane_ladder_health
with (security_invoker = true) as
select
  -- the derivation itself regressed (someone replaced v_next_step_current)
  (select count(*)::int from public.v_next_step_current c
     join public.applications a on a.id = c.application_id
    where a.license_status::text = 'licensed'
      and c.derived_stage_key in ('applied', 'watched_vsl', 'contacted'))            as derivation_licensed_leak,
  -- progress rows that disagree with the derivation (a recompute trigger stopped firing)
  (select count(*)::int from public.next_step_progress p
     join public.v_next_step_current c on c.application_id = p.application_id
    where p.status = 'active' and p.manual_stage_key is null
      and (p.current_stage_key in ('applied', 'watched_vsl', 'contacted', 'licensed_book_call', 'call_booked')
        or c.derived_stage_key in ('applied', 'watched_vsl', 'contacted', 'licensed_book_call', 'call_booked'))
      and p.current_stage_key <> c.derived_stage_key)                                as progress_drift,
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.interview_events'::regclass
      and tgname = 'trg_next_step_interview_events_recompute' and tgenabled <> 'D')  as booking_trigger_enabled,
  -- a {{token}} the dispatcher does not know renders as an empty string in a live email
  (select coalesce(string_agg(distinct s.stage_key || ':' || m[1], ', '), '')
     from public.next_step_stages s,
          lateral regexp_matches(
            coalesce(s.email_subject_template, '') || coalesce(s.email_body_template, '') ||
            coalesce(s.candidate_message_template, '') || coalesce(s.sms_template, '') ||
            coalesce(s.telegram_template, ''), '\{\{\s*([\w_.]+)\s*\}\}', 'g') m
    where s.stage_key in ('applied', 'licensed_book_call', 'call_booked')
      and m[1] not in ('first_name', 'last_name', 'next_action_url', 'seminar_date', 'exam_date',
                       'phone', 'email', 'application_id', 'agent_id', 'days_in_stage')) as unknown_tokens,
  (select strpos(pg_get_functiondef('public.fn_next_step_nudge_sweep()'::regprocedure),
                 'fn_lane_ladder_cutoff') > 0)                                         as sweep_gate_present,
  public.fn_lane_ladder_cutoff()                                                      as cutoff_at,
  -- published context (not graded)
  (select count(*)::int from public.applications a
    where a.created_at >= public.fn_lane_ladder_cutoff() and not coalesce(a.is_duplicate, false)
      and a.license_status::text = 'licensed')                                         as licensed_apps_since,
  (select count(distinct ie.application_id)::int from public.interview_events ie
     join public.applications a on a.id = ie.application_id
    where a.created_at >= public.fn_lane_ladder_cutoff() and a.license_status::text = 'licensed'
      and ie.canceled_at is null and not coalesce(ie.is_backfill_duplicate, false))   as licensed_booked_since,
  (select count(*)::int from public.applications a
    where a.created_at >= public.fn_lane_ladder_cutoff() and not coalesce(a.is_duplicate, false)
      and a.license_status::text <> 'licensed')                                        as unlicensed_apps_since,
  (select count(distinct ie.application_id)::int from public.interview_events ie
     join public.applications a on a.id = ie.application_id
    where a.created_at >= public.fn_lane_ladder_cutoff() and a.license_status::text <> 'licensed'
      and ie.canceled_at is null and not coalesce(ie.is_backfill_duplicate, false))   as unlicensed_booked_since,
  (select count(*)::int from public.applications a
    where a.created_at >= public.fn_lane_ladder_cutoff() and not coalesce(a.is_duplicate, false)
      and a.license_status::text <> 'licensed'
      and (a.course_purchased_at is not null or a.course_started_at is not null))      as unlicensed_course_since,
  (select count(*)::int from public.next_step_messages m
    where m.stage_key = 'licensed_book_call' and m.sent_at is not null)               as licensed_step_sends,
  (select count(*)::int from public.next_step_messages m
    where m.stage_key = 'applied' and m.sent_at is not null
      and m.created_at >= timestamptz '2026-11-11 19:40:00+00')                        as applied_step_sends_new_copy;

revoke all on public.v_applicant_lane_ladder_health from anon, authenticated;
grant select on public.v_applicant_lane_ladder_health to service_role;
