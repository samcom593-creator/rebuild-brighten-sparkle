-- Replace the tracked field-release course's legacy YouTube, Drive, and raw
-- screen-recording media with Sam's finished lesson videos. Existing module
-- ids and progress receipts are preserved; two duplicate foundation lessons
-- retire from the active path instead of forcing agents to repeat one video.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'training-videos',
  'training-videos',
  true,
  2147483648,
  array['video/mp4', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.onboarding_modules
  add column if not exists poster_url text;

alter table public.onboarding_modules
  add column if not exists video_parts jsonb not null default '[]'::jsonb;

alter table public.onboarding_modules
  drop constraint if exists onboarding_modules_video_parts_array;

alter table public.onboarding_modules
  add constraint onboarding_modules_video_parts_array
  check (jsonb_typeof(video_parts) = 'array');

comment on column public.onboarding_modules.poster_url is
  'Optional branded still displayed before a native lesson video begins.';

comment on column public.onboarding_modules.video_parts is
  'Ordered native-video chapters used when a finished lesson is stored as multiple streamable files.';

update public.onboarding_modules
set title = 'Closer Operating System: Start Here',
    description = 'Build the pre-call routine, reset protocol, and process-first confidence required to execute under pressure.',
    video_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-part-00.mp4',
    poster_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-closer-operating-system.jpg',
    video_parts = '[{"title":"The closer operating system","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-part-00.mp4","duration_seconds":240},{"title":"Emotional discipline","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-part-01.mp4","duration_seconds":240},{"title":"The five-minute call routine","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-part-02.mp4","duration_seconds":240},{"title":"Reset after a hard conversation","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-part-03.mp4","duration_seconds":240},{"title":"Standards under pressure","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-onboarding-part-04.mp4","duration_seconds":137}]'::jsonb,
    order_index = 0,
    is_active = true,
    phase_key = 'foundation',
    duration_seconds = 1097,
    learning_objectives = '["Build a repeatable five-minute pre-call routine","Reset cleanly after difficult conversations","Anchor confidence to skill and process instead of one call outcome"]'::jsonb,
    transcript_kind = 'lesson-notes',
    transcript_segments = '[{"time":"0:00","text":"Before learning a script, build a system capable of executing that script under pressure. This lesson introduces the five-minute call routine, a reset protocol, and the standard for the rest of training."},{"time":"1:00","text":"Confidence cannot depend on every call going perfectly. It comes from a repeatable skill and a process you can return to after a win, loss, or difficult conversation."},{"time":"Standard","text":"The course provides the language, structure, process, and tools. Your responsibility is to execute them consistently."}]'::jsonb,
    media_has_audio = true
where id = '262a15a3-463b-48d7-965f-9ec18b5a8567'::uuid;

update public.onboarding_modules
set title = 'Script Mastery: First Seconds to Close',
    description = 'Master the intentional language, tone, and authority that carry an approved APEX conversation from opener to close.',
    video_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-00.mp4',
    poster_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-mastery.jpg',
    video_parts = '[{"title":"First impression and opener","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-00.mp4","duration_seconds":240},{"title":"Qualification and need analysis","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-01.mp4","duration_seconds":240},{"title":"Presentation structure","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-02.mp4","duration_seconds":240},{"title":"Objection loops","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-03.mp4","duration_seconds":240},{"title":"Price presentation","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-04.mp4","duration_seconds":240},{"title":"Price objections and tonal tools","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-05.mp4","duration_seconds":240},{"title":"Banking and application flow","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-06.mp4","duration_seconds":240},{"title":"Solidification and retention","url":"https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-script-part-07.mp4","duration_seconds":51}]'::jsonb,
    order_index = 1,
    is_active = true,
    phase_key = 'foundation',
    duration_seconds = 1731,
    learning_objectives = '["Control the prospect’s first impression","Sound sharp, authoritative, and genuinely enthusiastic","Loop objections and pitch price with the approved structure"]'::jsonb,
    transcript_kind = 'lesson-notes',
    transcript_segments = '[{"time":"Opening","text":"The prospect forms an immediate picture of your competence and intent. The first seconds of the call are part of the close."},{"time":"Three signals","text":"Your delivery should sound sharp, expert, and enthusiastic. Use bottled enthusiasm: purposeful energy without sounding fake or overexcited."},{"time":"Language","text":"Every word in the approved opener is intentional. Practice the wording and tone together until the structure becomes automatic."}]'::jsonb,
    media_has_audio = true
where id = 'fe1ebd29-c76c-4bf3-a5d4-fb80f39960e1'::uuid;

-- These two lessons repeated material now taught in the finished Script
-- Mastery recording. Preserve their rows and historic completions, but remove
-- them from the active sequence so agents never watch duplicate old media.
update public.onboarding_modules
set is_active = false
where id in (
  '3d16a8a8-02be-4ebe-8fb3-2c0301df0fa0'::uuid,
  '680b414a-ba8d-42bc-b198-9ab6155cd571'::uuid
);

update public.onboarding_modules
set title = 'ReadyMode: Connect, Dial, and Disposition',
    description = 'Confirm the connection, enter background dialing, recover from errors, and record the true call result.',
    video_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-01-readymode.mp4',
    poster_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-01-readymode.jpg',
    video_parts = '[]'::jsonb,
    order_index = 2,
    duration_seconds = 211,
    media_has_audio = true,
    is_active = true
where id = 'a8e10000-0000-4000-8000-000000000001'::uuid;

update public.onboarding_modules
set title = 'ReadyMode: Review the Right Calls',
    description = 'Open the correct report, isolate the call, and use the recording to coach one behavior at a time.',
    video_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-02-call-review.mp4',
    poster_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-02-call-review.jpg',
    video_parts = '[]'::jsonb,
    order_index = 3,
    duration_seconds = 26,
    media_has_audio = false,
    is_active = true
where id = 'a8e10000-0000-4000-8000-000000000002'::uuid;

update public.onboarding_modules
set title = 'Pipeline: Client to Posted Deal',
    description = 'Create one clean client record, post the exact policy, and leave the next action visible.',
    video_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-03-pipeline.mp4',
    poster_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-03-pipeline.jpg',
    video_parts = '[]'::jsonb,
    order_index = 4,
    duration_seconds = 63,
    media_has_audio = false,
    is_active = true
where id = 'a8e10000-0000-4000-8000-000000000003'::uuid;

update public.onboarding_modules
set title = 'Quoting and Field Underwriting',
    description = 'Enter the real client details, compare the correct product, and protect placement quality before opening the e-application.',
    video_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-04-quoting.mp4',
    poster_url = 'https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/course/2026-08-31/apex-field-playbook-04-quoting.jpg',
    video_parts = '[]'::jsonb,
    order_index = 5,
    duration_seconds = 278,
    media_has_audio = true,
    is_active = true
where id = 'a8e10000-0000-4000-8000-000000000004'::uuid;

-- Keep the knowledge checks aligned with the finished foundation recordings.
update public.onboarding_questions
set question = 'What should a closer’s confidence be anchored to?',
    options = '["Every call going perfectly","A repeatable skill and process","The prospect already agreeing","A manager taking over"]'::jsonb,
    correct_answer = 1,
    explanation = 'Process-first confidence survives both wins and difficult conversations.'
where id = '8e063d15-15dc-49a9-baab-ab90e369e2e5'::uuid;

update public.onboarding_questions
set question = 'What does the first lesson give you before script training?',
    options = '["A five-minute call routine and reset protocol","A carrier appointment","A social media calendar","Permission to improvise every call"]'::jsonb,
    correct_answer = 0,
    explanation = 'The routine and reset protocol create the operating system used under pressure.'
where id = '3cba63bf-d24b-413e-a87a-4976272164f9'::uuid;

update public.onboarding_questions
set question = 'What is your responsibility once the course provides the process, language, structure, and tools?',
    options = '["Wait for motivation","Execute the process consistently","Rewrite the system immediately","Skip practice and take live calls"]'::jsonb,
    correct_answer = 1,
    explanation = 'Training supplies the tools; consistent execution is the agent’s responsibility.'
where id = '760e328a-6d06-42b5-92a6-97e81f536e3b'::uuid;

update public.onboarding_questions
set question = 'Which three impressions should your opening create?',
    options = '["Sharp, expert, and enthusiastic","Quiet, casual, and uncertain","Fast, loud, and aggressive","Funny, vague, and spontaneous"]'::jsonb,
    correct_answer = 0,
    explanation = 'The approved delivery is mentally sharp, authoritative, and genuinely enthusiastic.'
where id = 'a65dbf1b-5ff8-48b4-bd7b-23336631a71e'::uuid;

update public.onboarding_questions
set question = 'What does bottled enthusiasm mean?',
    options = '["Fake excitement","Purposeful energy without sounding overexcited","Speaking as loudly as possible","Ignoring the prospect’s tone"]'::jsonb,
    correct_answer = 1,
    explanation = 'Bottled enthusiasm sounds intentional and engaged without becoming fake.'
where id = 'a6c57649-cf79-423d-8977-f513a5df1120'::uuid;

update public.onboarding_questions
set question = 'What are the three steps for looping a social objection?',
    options = '["Acknowledge, add the needed information, and ask again","Argue, discount, and end the call","Skip, quote, and transfer","Apologize, pause, and hang up"]'::jsonb,
    correct_answer = 0,
    explanation = 'Acknowledge briefly, provide the missing security or context, then resubmit the request.'
where id = '3615b459-b9e1-4434-8926-d9ce05199340'::uuid;

commit;
