-- Turn the post-hire sales course into a complete lesson experience: every
-- lesson can carry objectives, timed transcript/visual notes, duration, and a
-- truthful source-audio state. Progress continues to use onboarding_progress.

begin;

alter table public.onboarding_modules
  add column if not exists phase_key text,
  add column if not exists duration_seconds integer,
  add column if not exists learning_objectives jsonb not null default '[]'::jsonb,
  add column if not exists transcript_segments jsonb not null default '[]'::jsonb,
  add column if not exists transcript_kind text not null default 'lesson-notes',
  add column if not exists media_has_audio boolean not null default true;

alter table public.onboarding_modules
  drop constraint if exists onboarding_modules_phase_key_check,
  add constraint onboarding_modules_phase_key_check
    check (phase_key is null or phase_key in ('foundation', 'systems')),
  drop constraint if exists onboarding_modules_duration_seconds_check,
  add constraint onboarding_modules_duration_seconds_check
    check (duration_seconds is null or duration_seconds >= 0),
  drop constraint if exists onboarding_modules_learning_objectives_check,
  add constraint onboarding_modules_learning_objectives_check
    check (jsonb_typeof(learning_objectives) = 'array'),
  drop constraint if exists onboarding_modules_transcript_segments_check,
  add constraint onboarding_modules_transcript_segments_check
    check (jsonb_typeof(transcript_segments) = 'array'),
  drop constraint if exists onboarding_modules_transcript_kind_check,
  add constraint onboarding_modules_transcript_kind_check
    check (transcript_kind in ('verbatim', 'edited-transcript', 'visual-notes', 'lesson-notes'));

comment on column public.onboarding_modules.transcript_segments is
  'Ordered [{time,text}] transcript or clearly labeled visual lesson notes.';
comment on column public.onboarding_modules.media_has_audio is
  'Truthful source-recording audio state; transcript narration remains available in the client.';

-- Give the four existing foundation lessons useful notes and accurate run
-- times without pretending the notes are word-for-word transcripts.
update public.onboarding_modules
set phase_key = 'foundation',
    duration_seconds = case id
      when '262a15a3-463b-48d7-965f-9ec18b5a8567'::uuid then 1358
      when 'fe1ebd29-c76c-4bf3-a5d4-fb80f39960e1'::uuid then 3868
      when '3d16a8a8-02be-4ebe-8fb3-2c0301df0fa0'::uuid then 575
      when '680b414a-ba8d-42bc-b198-9ab6155cd571'::uuid then 2708
    end,
    learning_objectives = case id
      when '262a15a3-463b-48d7-965f-9ec18b5a8567'::uuid then '["Understand the APEX daily operating standard","Know where to get live-call help","Start with the activity targets that create production"]'::jsonb
      when 'fe1ebd29-c76c-4bf3-a5d4-fb80f39960e1'::uuid then '["Use the five-stage APEX sales flow","Move from contact to submission without skipping discovery","Practice the approved language before live appointments"]'::jsonb
      when '3d16a8a8-02be-4ebe-8fb3-2c0301df0fa0'::uuid then '["Identify the five core objections","Clarify the real concern before responding","Educate without arguing or pressuring"]'::jsonb
      else '["Own the opener, qualification, and presentation scripts","Use the direct close confidently","Stay word-for-word until repetition creates mastery"]'::jsonb
    end,
    transcript_kind = 'lesson-notes',
    transcript_segments = case id
      when '262a15a3-463b-48d7-965f-9ec18b5a8567'::uuid then '[{"time":"Start","text":"Welcome to APEX. This orientation explains the standard, the daily rhythm, and how support works after release."},{"time":"Activity","text":"Consistent dialing and the weekday huddle create the repetitions required to improve. Treat the activity floor as the beginning, not the ceiling."},{"time":"Support","text":"When a live call gets difficult, use the manager-support path inside the system instead of guessing with a client."}]'::jsonb
      when 'fe1ebd29-c76c-4bf3-a5d4-fb80f39960e1'::uuid then '[{"time":"Framework","text":"The APEX sales system moves in order: Contact, Qualify, Present, Close, and Submit."},{"time":"Conversation","text":"Use the approved questions to understand the client before presenting a solution. The recommendation should follow the need you uncovered."},{"time":"Action","text":"Keep the official script open during practice and live calls until the flow becomes automatic."}]'::jsonb
      when '3d16a8a8-02be-4ebe-8fb3-2c0301df0fa0'::uuid then '[{"time":"Listen","text":"An objection is usually a request for clarity. Slow down and identify the specific concern before answering."},{"time":"Clarify","text":"For “I need to think about it,” ask what specifically needs more thought. Respond to that concern instead of delivering a generic rebuttal."},{"time":"Educate","text":"For work coverage, explain the difference between group and individual protection without arguing with the prospect."}]'::jsonb
      else '[{"time":"Repetition","text":"Master the opener, qualification, and presentation scripts word for word before improvising."},{"time":"Close","text":"The direct close is simple: ask whether the client is ready to complete the application together now."},{"time":"Standard","text":"Repetition creates confidence. Keep using the approved language until your submitted-application volume proves mastery."}]'::jsonb
    end
where id in (
  '262a15a3-463b-48d7-965f-9ec18b5a8567'::uuid,
  'fe1ebd29-c76c-4bf3-a5d4-fb80f39960e1'::uuid,
  '3d16a8a8-02be-4ebe-8fb3-2c0301df0fa0'::uuid,
  '680b414a-ba8d-42bc-b198-9ab6155cd571'::uuid
);

insert into public.onboarding_modules (
  id, order_index, title, description, video_url, pass_threshold, is_active,
  phase_key, duration_seconds, learning_objectives, transcript_segments,
  transcript_kind, media_has_audio
)
values
  (
    'a8e10000-0000-4000-8000-000000000001'::uuid, 4,
    'ReadyMode: Start Dialing the Right Way',
    'Connect your phone and microphone, enter background dialing, troubleshoot connection errors, and disposition calls correctly.',
    'https://www.awesomescreenshot.com/video/55929817?key=4bfc6466537d3beb5c7b33e80a35f639',
    80, true, 'systems', 283,
    '["Confirm phone and microphone readiness before dialing","Recover from a ReadyMode connection error","Choose accurate call dispositions, especially Do Not Call"]'::jsonb,
    '[{"time":"0:00","text":"Welcome to the field-release systems series. These lessons cover daily tools from dialing and call review through quoting, applications, deal posting, and book-of-business management."},{"time":"0:34","text":"Sign in to the APEX ReadyMode site. A manager view may look slightly different from an agent view, but the same operating rules apply."},{"time":"0:57","text":"Before clicking Ready, confirm that Phone Status says Connected and that the correct microphone is enabled and working."},{"time":"1:24","text":"Move from Break to Ready. After the countdown, Background Dialing confirms that ReadyMode is actively calling the selected lead type."},{"time":"1:54","text":"If ReadyMode reports a phone connection error, return to Break. Open the wrench beside Phone Status, run the phone network test, refresh the page, and wait for Initialized, Connecting, then Connected before resuming."},{"time":"3:00","text":"When a call ends, select the result that accurately describes the conversation. Do Not Call is only for a prospect who explicitly asks not to be contacted again; it is not a substitute for a normal unsuccessful-call disposition."},{"time":"4:06","text":"Confirm the call result so ReadyMode returns to background dialing. At the end of the day, move to Break and sign out completely."}]'::jsonb,
    'edited-transcript', true
  ),
  (
    'a8e10000-0000-4000-8000-000000000002'::uuid, 5,
    'ReadyMode: Review Calls and Improve',
    'Find call recordings, narrow the report to the right activity, and use real conversations for self-coaching.',
    'https://www.awesomescreenshot.com/video/55930238?key=0ba4f078af40155aba2874aa17179fa6',
    80, true, 'systems', 179,
    '["Open the ReadyMode call log report","Filter the report to the call you need","Use recordings to coach specific behaviors"]'::jsonb,
    '[{"time":"0:00","text":"This source recording is silent. Follow the highlighted cursor and use these visual notes as the lesson narration."},{"time":"0:20","text":"In ReadyMode, stay on Break while reviewing activity. Open Reports in the left navigation, then choose Call Logs."},{"time":"0:40","text":"The Call Log Report lists agent, time, disposition, call length, and contact. Use the date range and the user, campaign, file, and source filters to isolate the right call."},{"time":"1:00","text":"Use the recording control on the call row to listen in the browser or download the MP3 when deeper review is needed."},{"time":"1:35","text":"Use duration and call-type filters to remove short connections and focus coaching on conversations long enough to evaluate."},{"time":"2:20","text":"Review a small set of calls with one improvement target at a time: opener, discovery, objection handling, close, or accurate disposition."}]'::jsonb,
    'visual-notes', false
  ),
  (
    'a8e10000-0000-4000-8000-000000000003'::uuid, 6,
    'Pipeline: Add Clients and Post Deals',
    'Keep every prospect in the APEX pipeline and record each policy in the canonical production ledger.',
    'https://www.awesomescreenshot.com/video/55934385?key=72a639912e732c5d61a870d4445f2a68',
    80, true, 'systems', 294,
    '["Create and open a client workspace","Move a client through the pipeline","Post complete policy data against the correct client"]'::jsonb,
    '[{"time":"0:00","text":"This source recording is silent. Follow the highlighted cursor and use these visual notes as the lesson narration."},{"time":"0:15","text":"Open Clients, then Pipeline. Search before creating a record so the same person is not added twice."},{"time":"0:40","text":"Choose Add Client, enter the client identity and contact information, and open the new client workspace. Use the stage bar to keep the next sales action visible."},{"time":"1:20","text":"When a policy is written, choose Post a Deal. Select Existing Client when the client already lives in the pipeline and confirm the linked person before continuing."},{"time":"2:00","text":"Enter the carrier, product, policy number, effective date, canonical sale date, face amount, monthly premium, payment method, draft day, frequency, lead source, and current policy status accurately."},{"time":"3:20","text":"Add beneficiaries, notes, or a supporting document when useful. These are optional; core policy and premium fields drive production reporting."},{"time":"4:20","text":"Review the record before posting. The deal saves first, while notifications and downstream delivery run separately, so a delayed side effect cannot erase the production receipt."}]'::jsonb,
    'visual-notes', false
  ),
  (
    'a8e10000-0000-4000-8000-000000000004'::uuid, 7,
    'Quoting and Field Underwriting',
    'Use Insurance Toolkits or Quotify to match health, product, state, and carrier before opening the e-application.',
    'https://www.awesomescreenshot.com/video/55934661?key=ff71c35c0c7f86265caee1c754b40529',
    80, true, 'systems', 330,
    '["Quote the correct product category and client profile","Use health and drug details before comparing rates","Choose carrier placement for fit and business quality, not price alone"]'::jsonb,
    '[{"time":"0:00","text":"Quoting and field underwriting are core broker skills. The goal is not simply the cheapest number; it is the appropriate product and carrier for the client’s actual situation."},{"time":"0:29","text":"APEX agents can use Insurance Toolkits, Quotify, or the APEX quoting option. Insurance Toolkits can move directly from a quote into a carrier e-application."},{"time":"0:53","text":"Customize the carrier list to companies you are contracted to write. Before entering data, verify the product category—FEX for final expense, or the appropriate term or IUL category."},{"time":"1:43","text":"Enter coverage amount, product type, gender, state, date of birth, height, weight, nicotine use, and payment type accurately. State availability and build or nicotine rules can materially change the result."},{"time":"2:59","text":"Use the drug and health sections. If a client has COPD or another condition, enter it and answer the follow-up questions rather than quoting the client as healthy."},{"time":"3:29","text":"Health information can change both price and eligible carrier. Accurate field underwriting prevents a quote from moving unexpectedly and improves submitted-to-approved placement quality."},{"time":"4:20","text":"Use drug lookup, the health cheat sheet, and available products to choose the strongest option for that client before submitting an application."},{"time":"4:50","text":"After Get Quote, compare company, monthly premium, coverage type, and the specific product—not just the carrier name—before opening the e-application."}]'::jsonb,
    'edited-transcript', true
  )
on conflict (id) do update set
  order_index = excluded.order_index,
  title = excluded.title,
  description = excluded.description,
  video_url = excluded.video_url,
  pass_threshold = excluded.pass_threshold,
  is_active = excluded.is_active,
  phase_key = excluded.phase_key,
  duration_seconds = excluded.duration_seconds,
  learning_objectives = excluded.learning_objectives,
  transcript_segments = excluded.transcript_segments,
  transcript_kind = excluded.transcript_kind,
  media_has_audio = excluded.media_has_audio;

delete from public.onboarding_questions
where module_id in (
  'a8e10000-0000-4000-8000-000000000001'::uuid,
  'a8e10000-0000-4000-8000-000000000002'::uuid,
  'a8e10000-0000-4000-8000-000000000003'::uuid,
  'a8e10000-0000-4000-8000-000000000004'::uuid
);

insert into public.onboarding_questions
  (id, module_id, question, options, correct_answer, explanation, order_index)
values
  ('a8e11000-0000-4000-8000-000000000001', 'a8e10000-0000-4000-8000-000000000001', 'What must be true before you move ReadyMode from Break to Ready?', '["The lead list is visible","Phone Status says Connected and the microphone works","A manager is already on the call","Every report filter is cleared"]', 1, 'Confirm both the phone connection and microphone before dialing.', 1),
  ('a8e11000-0000-4000-8000-000000000002', 'a8e10000-0000-4000-8000-000000000001', 'ReadyMode shows a phone connection error. What is the correct first recovery path?', '["Keep clicking Ready","Return to Break, run the phone network test, refresh, and wait for Connected","Mark the lead Do Not Call","Post a deal"]', 1, 'Do not keep dialing through a connection error. Reset from Break and verify Connected.', 2),
  ('a8e11000-0000-4000-8000-000000000003', 'a8e10000-0000-4000-8000-000000000001', 'When should you use the Do Not Call disposition?', '["Any time a sale does not close","When the prospect explicitly asks not to be contacted again","When a call is under 30 seconds","At the end of every shift"]', 1, 'Do Not Call removes the prospect from future contact; use it only for a real opt-out.', 3),

  ('a8e12000-0000-4000-8000-000000000001', 'a8e10000-0000-4000-8000-000000000002', 'Where do you find recordings for call review in ReadyMode?', '["Reports, then Call Logs","My Files, then Shared Files","Manage, then Users","Dashboard, then Settings"]', 0, 'The Call Log Report is under Reports → Call Logs.', 1),
  ('a8e12000-0000-4000-8000-000000000002', 'a8e10000-0000-4000-8000-000000000002', 'Which filters help isolate a specific coaching call?', '["Only page number","Date, user, campaign, duration, type, file, and source","Browser zoom and theme","Phone status only"]', 1, 'Use the report dimensions to isolate the right activity before reviewing.', 2),
  ('a8e12000-0000-4000-8000-000000000003', 'a8e10000-0000-4000-8000-000000000002', 'What is the strongest self-coaching approach?', '["Review random calls with no goal","Focus each review on one behavior such as opener, discovery, objections, or close","Only review completed sales","Download every call and never listen"]', 1, 'One target per review produces a concrete adjustment for the next call block.', 3),

  ('a8e13000-0000-4000-8000-000000000001', 'a8e10000-0000-4000-8000-000000000003', 'What should you do before adding a new pipeline client?', '["Post a blank deal","Search for the person to avoid a duplicate","Move every client to Sold","Create a second record for safety"]', 1, 'Search first so one client keeps one canonical workspace.', 1),
  ('a8e13000-0000-4000-8000-000000000002', 'a8e10000-0000-4000-8000-000000000003', 'Which date records when the deal counts toward production?', '["The canonical sale date in Post a Deal","The day you opened the browser","The client birthday","Any future date"]', 0, 'The sale date is the production date; enter the actual date the policy was written.', 2),
  ('a8e13000-0000-4000-8000-000000000003', 'a8e10000-0000-4000-8000-000000000003', 'Which fields are core to an accurate posted policy?', '["Carrier, product, policy details, premium, dates, payment, and status","A social caption only","A profile photo and theme","Only the client first name"]', 0, 'Complete policy and premium fields drive production and commission reporting.', 3),

  ('a8e14000-0000-4000-8000-000000000001', 'a8e10000-0000-4000-8000-000000000004', 'What is the primary goal of quoting?', '["Find the cheapest number regardless of fit","Match the client to an appropriate product and carrier using accurate information","Use the same carrier for everyone","Skip health questions to save time"]', 1, 'Price matters, but fit and accurate field underwriting come first.', 1),
  ('a8e14000-0000-4000-8000-000000000002', 'a8e10000-0000-4000-8000-000000000004', 'What should you verify before comparing final-expense rates?', '["That the product category is FEX","That the client has social media","That the cheapest carrier is selected","That the health section is blank"]', 0, 'The wrong product category produces irrelevant rates.', 2),
  ('a8e14000-0000-4000-8000-000000000003', 'a8e10000-0000-4000-8000-000000000004', 'A client reports COPD. What should you do in the quoting tool?', '["Quote the client as healthy","Enter COPD and answer the treatment, diagnosis, oxygen, and medication questions","Remove the client from the pipeline","Choose any carrier before entering health"]', 1, 'Accurate health details change eligibility and rate, and protect placement quality.', 3);

commit;
