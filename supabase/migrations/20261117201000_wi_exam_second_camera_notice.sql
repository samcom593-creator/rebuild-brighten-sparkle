-- MP-WI-EXAM-SECOND-CAMERA (2026-11-17). PSI's Wisconsin Insurance landing page, the exam_schedule_url we
-- send every WI course finisher (exam_push_wi / exam_catchup_wi), now says: "Starting November 10, 2026, all
-- Remote Proctored tests offered for Wisconsin Insurance will require a smartphone as a second camera security
-- device." Read live from https://test-takers.psiexams.com/wiins on 2026-11-17. Put it where the applicant meets
-- the link so nobody fails check-in on test day. Idempotent: each statement is a no-op once the note is present.
update public.licensing_state_requirements
   set watch_outs = array_append(coalesce(watch_outs, array[]::text[]),
         'Exam: remote-proctored PSI exams need a smartphone as a second camera (PSI rule since Nov 10, 2026). Do a dry run before test day.'),
       updated_at = now()
 where state = 'WI'
   and not exists (select 1 from unnest(coalesce(watch_outs, array[]::text[])) w where w ilike '%second camera%');

update public.next_step_stages
   set email_body_template = replace(email_body_template,
         'The exam fee is $75 (official source, checked Nov 11, 2026).</p>',
         'The exam fee is $75 (official source, checked Nov 11, 2026). Testing remotely? Since Nov 10, 2026 PSI requires a smartphone as a second camera, so set it up before test day.</p>')
 where stage_key in ('exam_push_wi', 'exam_catchup_wi')
   and email_body_template like '%The exam fee is $75 (official source, checked Nov 11, 2026).</p>%'
   and email_body_template not like '%second camera%';
