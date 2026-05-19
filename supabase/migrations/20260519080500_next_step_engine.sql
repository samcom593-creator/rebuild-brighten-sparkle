-- =====================================================================
-- NEXT STEP ENGINE — 18-stage pipeline schema
-- Apex Financial · 2026-05-19
--
-- Design principles:
-- - Does NOT refactor the 4 existing enums (application_status, license_progress,
--   onboarding_stage, agent.status). Stays additive.
-- - Derives "current stage" from existing timestamps (single source of truth via
--   v_next_step_current). next_step_progress is a fast-read cache,
--   recomputed on every meaningful change.
-- - One unified surface for both applicants (rows in `applications`) and agents
--   (rows in `agents`). person_type discriminates.
-- - Everything is event-driven via next_step_events for full auditability.
-- =====================================================================

-- ---------- Stage definition table (18 rows, one per stage) -----------
create table if not exists public.next_step_stages (
  stage_key            text primary key,
  order_index          integer not null unique,
  display_name         text not null,
  audience             text not null check (audience in ('applicant','agent','both')),
  owner_role           text not null check (owner_role in ('self','recruiter','hiring_manager','kj','sam','system')),
  next_action_label    text not null,
  next_action_url      text,
  sla_hours            integer,
  manager_alert_hours  integer,
  reminder_cadence     text not null,          -- e.g. 'day:1,3,7' or 'hour:24,72,168'
  stall_action         text not null check (stall_action in ('reassign','auto_close','flag','escalate','retry')),
  dashboard_section    text not null,          -- candidate-side panel grouping
  color_hex            text not null,
  icon_name            text not null,
  candidate_message_template text not null,    -- handlebars-style {{first_name}}
  manager_alert_template     text not null,
  telegram_template          text not null,
  sms_template               text not null,
  email_subject_template     text not null,
  email_body_template        text not null,
  is_terminal          boolean not null default false,
  success_event        text not null,          -- name of the trigger that fires the advance
  failure_label        text not null,          -- shown on the stuck dashboard
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------- Person-level pipeline state ------------------------------
create table if not exists public.next_step_progress (
  id                uuid primary key default gen_random_uuid(),
  person_type       text not null check (person_type in ('applicant','agent')),
  application_id    uuid references public.applications(id) on delete cascade,
  agent_id          uuid references public.agents(id) on delete cascade,
  current_stage_key text not null references public.next_step_stages(stage_key),
  entered_at        timestamptz not null default now(),
  sla_due_at        timestamptz,
  owner_user_id     uuid,
  owner_role        text,
  last_nudged_at    timestamptz,
  nudge_count       integer not null default 0,
  is_stalled        boolean not null default false,
  stalled_at        timestamptz,
  stall_reason      text,
  status            text not null default 'active' check (status in ('active','completed','stalled','closed_lost')),
  completed_at      timestamptz,
  prior_stage_key   text,
  metadata          jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  constraint nsp_one_id check ((application_id is not null) <> (agent_id is not null))
);

create unique index if not exists nsp_one_application_uniq on public.next_step_progress(application_id) where application_id is not null;
create unique index if not exists nsp_one_agent_uniq on public.next_step_progress(agent_id) where agent_id is not null;
create index if not exists nsp_owner_idx on public.next_step_progress(owner_user_id) where status='active';
create index if not exists nsp_stage_idx on public.next_step_progress(current_stage_key) where status='active';
create index if not exists nsp_stalled_idx on public.next_step_progress(is_stalled, sla_due_at) where status='active';

-- ---------- Append-only event log ------------------------------------
create table if not exists public.next_step_events (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid references public.applications(id) on delete cascade,
  agent_id        uuid references public.agents(id) on delete cascade,
  from_stage      text references public.next_step_stages(stage_key),
  to_stage        text references public.next_step_stages(stage_key),
  event_type      text not null check (event_type in ('advance','stall','unstall','reassign','nudge','message_sent','message_failed','manual_override','closed_lost','reopened','recompute','seed')),
  actor_user_id   uuid,
  source          text not null check (source in ('trigger','manual','cron','webhook','self','seed','recompute')),
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists nse_app_idx on public.next_step_events(application_id, created_at desc) where application_id is not null;
create index if not exists nse_agent_idx on public.next_step_events(agent_id, created_at desc) where agent_id is not null;
create index if not exists nse_stage_idx on public.next_step_events(to_stage, created_at desc);

-- ---------- Outbound message log -------------------------------------
create table if not exists public.next_step_messages (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid references public.applications(id) on delete cascade,
  agent_id         uuid references public.agents(id) on delete cascade,
  stage_key        text not null references public.next_step_stages(stage_key),
  channel          text not null check (channel in ('telegram','sms','email','in_app','discord','manager_task')),
  template_key     text not null,
  recipient        text,
  body             text,
  subject          text,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  failed_at        timestamptz,
  error            text,
  fallback_of_id   uuid references public.next_step_messages(id),
  dedupe_key       text,
  external_id      text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists nsm_app_idx on public.next_step_messages(application_id, sent_at desc) where application_id is not null;
create index if not exists nsm_agent_idx on public.next_step_messages(agent_id, sent_at desc) where agent_id is not null;
create unique index if not exists nsm_dedupe_uniq on public.next_step_messages(dedupe_key) where dedupe_key is not null;

-- ---------- Additive columns to existing tables (no enum churn) ------
-- VSL tracking (stage 2)
alter table public.applications
  add column if not exists vsl_watched_at        timestamptz,
  add column if not exists vsl_watch_percent     integer default 0,
  add column if not exists telegram_chat_id      bigint,
  add column if not exists telegram_opt_out      boolean default false,
  add column if not exists next_step_stage_key   text references public.next_step_stages(stage_key),
  add column if not exists next_step_due_at      timestamptz;

alter table public.agents
  add column if not exists first_appointment_at  timestamptz,   -- stage 16
  add column if not exists first_appointment_set_by uuid,
  add column if not exists first_deal_at         timestamptz,   -- stage 17 (cache; deals table is authoritative)
  add column if not exists first_10k_at          timestamptz,   -- stage 18
  add column if not exists telegram_chat_id      bigint,
  add column if not exists telegram_opt_out      boolean default false,
  add column if not exists next_step_stage_key   text references public.next_step_stages(stage_key),
  add column if not exists next_step_due_at      timestamptz;

create index if not exists applications_next_step_idx on public.applications(next_step_stage_key, next_step_due_at) where status not in ('rejected','disqualified','lapsed');
create index if not exists agents_next_step_idx on public.agents(next_step_stage_key, next_step_due_at) where is_deactivated is not true;

-- RLS ---------------------------------------------------------------
alter table public.next_step_stages enable row level security;
alter table public.next_step_progress enable row level security;
alter table public.next_step_events enable row level security;
alter table public.next_step_messages enable row level security;

drop policy if exists nss_read_all on public.next_step_stages;
create policy nss_read_all on public.next_step_stages for select using (true);

drop policy if exists nsp_read_own_or_manager on public.next_step_progress;
create policy nsp_read_own_or_manager on public.next_step_progress for select using (
  (owner_user_id = auth.uid())
  or (agent_id in (select id from public.agents where user_id = auth.uid()))
  or (agent_id in (select id from public.agents where manager_id in (select id from public.agents where user_id = auth.uid())))
  or exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','manager'))
);

drop policy if exists nse_read_admin on public.next_step_events;
create policy nse_read_admin on public.next_step_events for select using (
  exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','manager'))
);

drop policy if exists nsm_read_admin on public.next_step_messages;
create policy nsm_read_admin on public.next_step_messages for select using (
  exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','manager'))
);
-- =====================================================================
-- NEXT STEP ENGINE — 18 stage definitions
-- =====================================================================

insert into public.next_step_stages
(stage_key, order_index, display_name, audience, owner_role,
 next_action_label, next_action_url,
 sla_hours, manager_alert_hours, reminder_cadence, stall_action, dashboard_section,
 color_hex, icon_name,
 candidate_message_template, manager_alert_template, telegram_template, sms_template,
 email_subject_template, email_body_template,
 success_event, failure_label, notes)
values

-- 1. APPLIED — applications row exists, status='new', contacted_at is null
('applied', 1, 'Applied', 'applicant', 'recruiter',
 'Watch the recruit video — 6 minutes',
 'https://apex-financial.org/welcome',
 24, 12, 'hour:1,12,24', 'reassign', 'getting-started',
 '#3b82f6', 'document-plus',
 'Hey {{first_name}} — Apex got your application. Step 1 is a 6-minute video that explains exactly how we pay you. Watch it here: {{next_action_url}}',
 '{{first_name}} {{last_name}} just applied — nobody has contacted them yet. Claim them in the dashboard before 12h pass.',
 '👋 Welcome to Apex, {{first_name}}. Tap below to watch your 6-min onboarding video.',
 'Apex: Welcome {{first_name}}. Quick 6-min video that shows you the path: {{next_action_url}}',
 'Welcome to Apex Financial, {{first_name}} — step 1',
 '<p>Hey {{first_name}},</p><p>You applied to Apex Financial — congrats on the first move. Step 1 is a 6-minute video that walks you through how we pay you, what the licensing path looks like, and what your first 30 days will be.</p><p><a href="{{next_action_url}}">Watch the 6-min video here</a></p><p>— The Apex Team</p>',
 'on_apply', 'No video watched within 24h', NULL),

-- 2. WATCHED VSL — vsl_watched_at IS NOT NULL
('watched_vsl', 2, 'Watched VSL', 'applicant', 'recruiter',
 'Complete your full application (license info + state)',
 'https://apex-financial.org/apply?step=full',
 24, 24, 'hour:6,24,48', 'reassign', 'getting-started',
 '#22d3ee', 'play-circle',
 '{{first_name}}, glad you watched the video. Next: take 4 minutes to complete the full application — we need license state + experience: {{next_action_url}}',
 '{{first_name}} watched the VSL but has not completed the full application. Tap to nudge.',
 '🎬 You watched the video, {{first_name}}. Last step before we can route you to a manager → finish the application: {{next_action_url}}',
 'Apex: {{first_name}}, finish your app so we can call you: {{next_action_url}}',
 '{{first_name}}, finish the application',
 '<p>{{first_name}},</p><p>You watched the video — let''s keep momentum. Finish the application (license state + experience, 4 min) and a manager will reach out within 24h.</p><p><a href="{{next_action_url}}">Finish my application</a></p>',
 'on_vsl_watch_complete', 'Stalled before completing full application', NULL),

-- 3. COMPLETED APPLICATION — application fully filled, hiring_manager not assigned OR not yet contacted
('completed_application', 3, 'Application Complete', 'applicant', 'recruiter',
 'Wait for a manager to reach out (within 24h)',
 'https://apex-financial.org/dashboard',
 24, 12, 'hour:12,24', 'escalate', 'in-review',
 '#0ea5e9', 'check-circle',
 'Locked in, {{first_name}}. Your application is on a manager''s desk — expect a call/text within 24h. Make sure your phone {{phone}} is open.',
 'UNASSIGNED applicant: {{first_name}} {{last_name}} ({{phone}}). Auto-route fired. Confirm pickup.',
 '✅ Your application is in, {{first_name}}. A manager will reach out in <24h. Keep your phone open.',
 'Apex: {{first_name}}, your app is in. A manager will reach out within 24h. Keep your phone open.',
 'Application received — a manager will reach out shortly',
 '<p>{{first_name}},</p><p>Application received. A manager will reach out by phone within 24 hours. If you don''t hear from us, reply to this email and we will escalate.</p><p>— Apex Financial</p>',
 'on_application_complete', 'No manager contact in 12h', NULL),

-- 4. CONTACTED BY MANAGER — applications.contacted_at IS NOT NULL
('contacted', 4, 'Contacted', 'applicant', 'hiring_manager',
 'Book your APEX seminar (Tue/Thu 8pm CT)',
 'https://apex-financial.org/seminar',
 48, 24, 'hour:24,48,72', 'reassign', 'in-review',
 '#f59e0b', 'phone',
 '{{first_name}} — your manager spoke with you. Next: lock your seat for the Apex Standard Seminar. Pick a date: {{next_action_url}}',
 '{{first_name}} {{last_name}} was contacted but has not booked the seminar. Tap to text them.',
 '📞 Good call, {{first_name}}. Lock your seat for the Apex seminar → {{next_action_url}}',
 'Apex: {{first_name}}, lock your seminar seat: {{next_action_url}}',
 'Next step: book your Apex seminar',
 '<p>{{first_name}},</p><p>Your manager called. Next step is the Apex Standard Seminar — runs Tue and Thu at 8pm CT. Pick a date:</p><p><a href="{{next_action_url}}">Book my seminar seat</a></p>',
 'on_first_contact', 'No seminar booked in 48h', NULL),

-- 5. BOOKED SEMINAR — applications.seminar_registered_at OR seminar_date IS NOT NULL
('booked_seminar', 5, 'Seminar Booked', 'applicant', 'kj',
 'Attend the seminar on {{seminar_date}} 8pm CT',
 'https://us02web.zoom.us/j/apex-seminar',
 NULL, NULL, 'day:-3,-1,0', 'flag', 'in-review',
 '#a855f7', 'calendar',
 '{{first_name}}, your Apex seminar is locked for {{seminar_date}} 8pm CT. Calendar invite + Zoom link landed in your email. See you there.',
 '{{first_name}} {{last_name}} is registered for seminar on {{seminar_date}}. KJ will see them in the room.',
 '🗓️ Your seminar is locked: {{seminar_date}} 8pm CT. Zoom link inbound 1h before.',
 'Apex Reminder: Seminar {{seminar_date}} 8pm CT. Zoom link incoming.',
 'Apex Seminar locked: {{seminar_date}} 8pm CT',
 '<p>{{first_name}},</p><p>You''re registered for the Apex Standard Seminar on <strong>{{seminar_date}} 8pm CT</strong>. Calendar invite is attached. You''ll get the Zoom link 1 hour before start.</p>',
 'on_seminar_register', 'Did not attend seminar', 'seminar_date relative cadence handled in dispatcher'),

-- 6. ATTENDED SEMINAR — applications.seminar_attended_at IS NOT NULL
('attended_seminar', 6, 'Attended Seminar', 'applicant', 'hiring_manager',
 'Decide & start your pre-license course',
 'https://apex-financial.org/get-licensed',
 48, 24, 'hour:12,24,48,72', 'reassign', 'pre-license',
 '#8b5cf6', 'check-badge',
 'Great work on the seminar, {{first_name}}. The next move is the pre-license course — Xcel is the partner we use. Start it here: {{next_action_url}}',
 '{{first_name}} {{last_name}} attended the seminar — they''re hot. Get them into the course this week or the heat dies.',
 '🔥 You showed up, {{first_name}}. Now lock in your pre-license course → {{next_action_url}}',
 'Apex: {{first_name}}, you attended! Lock in your course: {{next_action_url}}',
 'You attended — here''s the path forward',
 '<p>{{first_name}},</p><p>You showed up. Most don''t. The next move is the pre-license course (Xcel). 95% of agents who start the course inside 48h pass on the first try.</p><p><a href="{{next_action_url}}">Start my course</a></p>',
 'on_seminar_attended', 'No course purchase in 48h', NULL),

-- 7. STARTED PRE-LICENSE — applications.course_purchased_at OR course_started_at IS NOT NULL
('started_prelicense', 7, 'In Pre-License', 'applicant', 'hiring_manager',
 'Finish your pre-license course',
 'https://apex-financial.org/get-licensed',
 360, 168, 'day:3,7,14,21', 'flag', 'pre-license',
 '#a78bfa', 'book-open',
 '{{first_name}}, the course is on. Average finish-time is 10 days of focused study. You''re on day {{days_in_stage}}.',
 '{{first_name}} {{last_name}} has been in the course for {{days_in_stage}} days. Median is 10. Check in.',
 '📚 Day {{days_in_stage}} in the course, {{first_name}}. Don''t let momentum die — finish strong.',
 'Apex: {{first_name}}, day {{days_in_stage}} of course. Keep going — finish target is day 10.',
 'Course progress check-in — day {{days_in_stage}}',
 '<p>{{first_name}},</p><p>You''re on day {{days_in_stage}} of the pre-license course. Median finish is day 10. If you''re stuck, text your manager.</p>',
 'on_course_start', 'Course stalled past 21 days', NULL),

-- 8. FINISHED PRE-LICENSE — license_progress = 'finished_course'
('finished_prelicense', 8, 'Pre-License Complete', 'applicant', 'hiring_manager',
 'Schedule your state exam (PSI / Pearson)',
 'https://apex-financial.org/schedule-exam',
 72, 48, 'hour:24,48,72', 'reassign', 'pre-license',
 '#06b6d4', 'academic-cap',
 'You finished the course, {{first_name}}. Lock your exam date THIS WEEK — heat dies fast after course completion. {{next_action_url}}',
 '{{first_name}} {{last_name}} finished the course. They MUST schedule the exam this week or comprehension drops.',
 '🎓 Course done, {{first_name}}. Schedule your exam now → {{next_action_url}}',
 'Apex: {{first_name}}, schedule your exam THIS WEEK: {{next_action_url}}',
 'Schedule your state exam this week',
 '<p>{{first_name}},</p><p>You finished the course. Lock your exam date this week — the longer you wait, the lower your pass rate.</p><p><a href="{{next_action_url}}">Schedule my exam</a></p>',
 'on_course_finish', 'No exam scheduled in 72h', NULL),

-- 9. EXAM SCHEDULED — applications.exam_scheduled_at IS NOT NULL
('exam_scheduled', 9, 'Exam Scheduled', 'applicant', 'hiring_manager',
 'Take and pass your state exam on {{exam_date}}',
 NULL,
 NULL, NULL, 'day:-2,-1,0,1', 'flag', 'pre-license',
 '#ec4899', 'pencil-square',
 '{{first_name}}, exam day is locked. Sleep, hydrate, breathe. Most pass on first try. You''ve got this.',
 '{{first_name}} {{last_name}} has exam on {{exam_date}}. Day-of motivation text fires automatically.',
 '🎯 Exam locked for {{exam_date}}, {{first_name}}. You''re ready. Trust the prep.',
 'Apex: Exam day {{exam_date}}, {{first_name}}. You''re ready.',
 'Your state exam is locked',
 '<p>{{first_name}},</p><p>Exam day is locked. Sleep, hydrate, breathe. You''ve done the prep. Win this.</p>',
 'on_exam_scheduled', 'Exam missed or no result logged', 'cadence relative to exam_scheduled_at'),

-- 10. PASSED EXAM — applications.exam_passed_at IS NOT NULL
('passed_exam', 10, 'Passed Exam', 'applicant', 'hiring_manager',
 'Get your fingerprints done (24-48h turnaround)',
 'https://apex-financial.org/fingerprints',
 72, 48, 'hour:24,48,72', 'reassign', 'pre-license',
 '#10b981', 'finger-print',
 'You PASSED, {{first_name}}. Now: fingerprints. We need them filed before the state issues your license. Here''s where: {{next_action_url}}',
 '{{first_name}} {{last_name}} PASSED the exam. Make sure they get fingerprints done — otherwise licensing stalls 2-3 weeks.',
 '🏆 You PASSED, {{first_name}}. Next: fingerprints → {{next_action_url}}',
 'Apex: {{first_name}} — YOU PASSED. Now fingerprints → {{next_action_url}}',
 'You passed — last admin step',
 '<p><strong>{{first_name}}, you passed!</strong></p><p>Last admin step is fingerprints — get them done in the next 72h so the state can issue your license.</p><p><a href="{{next_action_url}}">Fingerprints info</a></p>',
 'on_exam_pass', 'No fingerprints in 72h', NULL),

-- 11. CONTRACTING STARTED — applications.status = 'contracting' (or licensed and being onboarded)
('contracting', 11, 'In Contracting', 'applicant', 'sam',
 'Sign carrier contracts + ICA',
 'https://apex-financial.org/contracting',
 168, 72, 'day:1,3,7', 'flag', 'contracting',
 '#f97316', 'document-text',
 '{{first_name}}, you''re officially in contracting. Carrier appointments + ICA next. We''ll guide you stage by stage.',
 '{{first_name}} {{last_name}} is in contracting. Check ICA payment + carrier appointments.',
 '📋 You''re in contracting, {{first_name}}. We''ll guide you through carrier appointments.',
 'Apex: {{first_name}}, contracting started. Watch your email for carrier paperwork.',
 'Contracting started — your carrier paperwork is incoming',
 '<p>{{first_name}},</p><p>You''re officially in contracting. Carrier appointments + ICA are next. Watch your email for paperwork over the next 72h.</p>',
 'on_contracting_start', 'Stuck >7d in contracting', NULL),

-- 12. HIRED — agents row exists for this person
('hired', 12, 'Hired — Agent', 'agent', 'sam',
 'Start the Apex pre-selling course',
 'https://apex-financial.org/training',
 72, 24, 'hour:6,24,72', 'flag', 'onboarding',
 '#16a34a', 'user-plus',
 'You''re an Apex agent now, {{first_name}}. 🎉 Your pre-selling course is live in the portal: {{next_action_url}}',
 'NEW AGENT: {{first_name}} {{last_name}}. Discord invite + dialer login + course access — verify all 3 today.',
 '🎉 You''re hired, {{first_name}}. Apex pre-selling course is unlocked → {{next_action_url}}',
 'Apex: WELCOME {{first_name}}. Course unlocked: {{next_action_url}}',
 'Welcome to Apex — your pre-selling course is live',
 '<p>{{first_name}},</p><p>You are officially an Apex agent. Your pre-selling course is unlocked in the portal — start today and you''ll be field-ready in 5 days.</p><p><a href="{{next_action_url}}">Open my training</a></p>',
 'on_hire', 'Course not started in 72h', NULL),

-- 13. APEX PRE-SELLING COURSE STARTED — agents.has_training_course = true AND first onboarding_progress row exists
('course_started', 13, 'Apex Course Started', 'agent', 'sam',
 'Complete all pre-selling modules',
 'https://apex-financial.org/training',
 120, 72, 'day:1,3,5,7', 'flag', 'onboarding',
 '#15803d', 'play-circle',
 '{{first_name}}, you''re in the Apex pre-selling course. Average finish time is 5 days. You''re on day {{days_in_stage}}.',
 '{{first_name}} {{last_name}} is on day {{days_in_stage}} of Apex pre-selling. Median is 5.',
 '📺 Day {{days_in_stage}} of pre-selling, {{first_name}}. Finish line is close.',
 'Apex: {{first_name}}, day {{days_in_stage}} of pre-selling course. Keep moving.',
 'Day {{days_in_stage}} of training',
 '<p>{{first_name}},</p><p>Day {{days_in_stage}} of the Apex pre-selling course. Median finish is 5 days. Push through.</p>',
 'on_apex_course_start', 'Pre-selling course stalled past 7d', NULL),

-- 14. COURSE COMPLETED — agents.onboarding_completed_at IS NOT NULL
('course_completed', 14, 'Course Completed', 'agent', 'hiring_manager',
 'Schedule infield ride-along with your manager',
 'https://apex-financial.org/infield',
 72, 48, 'hour:24,48,72', 'flag', 'production',
 '#84cc16', 'check-badge',
 '{{first_name}}, pre-selling course is done. Time to ride with your manager and watch real closes happen. Book your infield: {{next_action_url}}',
 '{{first_name}} {{last_name}} finished pre-selling. Get them in the field this week — text/call now.',
 '✅ Pre-selling done, {{first_name}}. Book your infield ride-along → {{next_action_url}}',
 'Apex: {{first_name}}, book your infield ride-along: {{next_action_url}}',
 'You''re field-ready — let''s ride',
 '<p>{{first_name}},</p><p>Pre-selling course is complete. The next step is an infield ride-along with your manager. Schedule it before the heat dies.</p><p><a href="{{next_action_url}}">Schedule my ride-along</a></p>',
 'on_apex_course_complete', 'No infield session in 72h', NULL),

-- 15. INFIELD TRAINING — agents.field_training_started_at IS NOT NULL OR onboarding_stage='in_field_training'
('infield_training', 15, 'Infield Training', 'agent', 'hiring_manager',
 'Sit on 3 calls before your first solo',
 NULL,
 168, 72, 'day:1,3,5,7', 'flag', 'production',
 '#65a30d', 'users',
 '{{first_name}}, infield training is on. Sit on 3 real calls, then go solo. Take notes, ask questions.',
 '{{first_name}} {{last_name}} is in infield. Hit them with feedback after every call.',
 '👀 Day {{days_in_stage}} of infield, {{first_name}}. Watch, learn, then take the next call.',
 'Apex: {{first_name}}, infield day {{days_in_stage}}. Watch, learn, close.',
 'Infield training day {{days_in_stage}}',
 '<p>{{first_name}},</p><p>Day {{days_in_stage}} of infield. Watch your manager close 3 times then take a swing. Take notes.</p>',
 'on_infield_start', 'No first appointment in 7d', NULL),

-- 16. FIRST APPOINTMENT — agents.first_appointment_at IS NOT NULL
('first_appointment', 16, 'First Appointment', 'agent', 'hiring_manager',
 'Close your first deal',
 NULL,
 168, 72, 'hour:24,72,120,168', 'flag', 'production',
 '#d97706', 'phone-arrow-up-right',
 '{{first_name}} — your first appointment is locked. Close calm, listen long, present hard. You''ve got this.',
 '{{first_name}} {{last_name}} has first appointment. Be on standby for post-call debrief.',
 '📞 First appointment locked, {{first_name}}. Listen long, present hard.',
 'Apex: {{first_name}}, first appointment locked. You''ve got this.',
 'Your first appointment',
 '<p>{{first_name}},</p><p>Your first appointment is on. Listen long, present hard, ask for the close. Your manager is on standby for the debrief.</p>',
 'on_first_appointment', 'No first close in 7d after first appt', NULL),

-- 17. FIRST DEAL — agents.first_deal_at IS NOT NULL OR deals row exists for this agent
('first_deal', 17, 'First Deal Closed', 'agent', 'sam',
 'Run it back — hit $10K weekly production',
 'https://apex-financial.org/dashboard',
 720, 168, 'day:1,3,7,14,21,28', 'flag', 'production',
 '#22c55e', 'sparkles',
 '🎉 FIRST DEAL, {{first_name}}. Plaque incoming. Next target: $10K in a single week — that''s where the real money starts.',
 'FIRST DEAL: {{first_name}} {{last_name}}. Broadcast to Discord. Plaque auto-generates. Next: drive them to $10K week.',
 '🎉 FIRST DEAL closed, {{first_name}}. Next: $10K week.',
 'Apex: FIRST DEAL closed, {{first_name}}. 🎉 Next target: $10K week.',
 'FIRST DEAL — congratulations',
 '<p><strong>{{first_name}}, you closed your first deal.</strong></p><p>Plaque incoming, Discord ping coming. Next target: $10K in a single week. That''s when the income compounds.</p>',
 'on_first_deal', 'No $10K week in 30d', NULL),

-- 18. FIRST $10K — agents.first_10k_at IS NOT NULL (one or more weeks with $10K AP)
('first_10k_week', 18, 'First $10K Week', 'agent', 'system',
 'You''re an Apex producer — stay consistent',
 'https://apex-financial.org/dashboard',
 NULL, NULL, 'day:0,7,30', 'flag', 'production',
 '#facc15', 'trophy',
 '👑 {{first_name}}, you just hit your first $10K week. That''s the line. You''re officially in the producer tier.',
 'PRODUCER TIER: {{first_name}} {{last_name}} just hit $10K week. Discord ping + plaque + Sam personal text.',
 '👑 $10K WEEK, {{first_name}}. You''re in the producer tier now.',
 'Apex: $10K WEEK, {{first_name}}. 👑 Welcome to the producer tier.',
 '$10K week — you''re a producer',
 '<p><strong>{{first_name}}, $10K week.</strong></p><p>This is the line that separates Apex producers from everyone else. Stay consistent — the next milestone is $25K week.</p>',
 'on_first_10k_week', 'Inconsistent (no second $10K week in 30d)', NULL)

on conflict (stage_key) do update set
  order_index = excluded.order_index,
  display_name = excluded.display_name,
  audience = excluded.audience,
  owner_role = excluded.owner_role,
  next_action_label = excluded.next_action_label,
  next_action_url = excluded.next_action_url,
  sla_hours = excluded.sla_hours,
  manager_alert_hours = excluded.manager_alert_hours,
  reminder_cadence = excluded.reminder_cadence,
  stall_action = excluded.stall_action,
  dashboard_section = excluded.dashboard_section,
  color_hex = excluded.color_hex,
  icon_name = excluded.icon_name,
  candidate_message_template = excluded.candidate_message_template,
  manager_alert_template = excluded.manager_alert_template,
  telegram_template = excluded.telegram_template,
  sms_template = excluded.sms_template,
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  success_event = excluded.success_event,
  failure_label = excluded.failure_label,
  notes = excluded.notes,
  updated_at = now();
-- =====================================================================
-- NEXT STEP ENGINE — derived views (single source of truth)
-- v_next_step_current — computes current stage from existing timestamps
-- v_next_step_candidate — per-person surface
-- v_next_step_manager_board — manager command center
-- v_next_step_stuck_pool — anyone past SLA
-- v_next_step_funnel_health — counts + conversion + median time-in-stage
-- =====================================================================

-- ------- derive current stage from timestamps (source of truth) ------
-- Decision priority: highest stage they've earned, unless explicitly closed.
create or replace view public.v_next_step_current as
with applicants as (
  select
    a.id as application_id,
    null::uuid as agent_id,
    'applicant'::text as person_type,
    a.first_name,
    a.last_name,
    a.email,
    a.phone,
    a.status::text as legacy_status,
    a.license_progress::text as license_progress,
    a.hiring_manager_user_id as owner_user_id,
    case
      when a.status in ('rejected','disqualified','lapsed') then 'closed_lost'
      when a.exam_passed_at is not null and (a.fingerprint_done = true or a.fingerprints_submitted_at is not null) then 'passed_exam'
      when a.exam_passed_at is not null then 'passed_exam'
      when a.exam_scheduled_at is not null then 'exam_scheduled'
      when a.license_progress = 'finished_course' or a.license_progress = 'exam_passed' or a.license_progress = 'passed_test' then 'finished_prelicense'
      when a.course_started_at is not null or a.course_purchased_at is not null or a.license_progress = 'course_purchased' then 'started_prelicense'
      when a.seminar_attended_at is not null then 'attended_seminar'
      when a.seminar_registered_at is not null or a.seminar_date is not null then 'booked_seminar'
      when a.contacted_at is not null or a.last_contacted_at is not null then 'contacted'
      when a.vsl_watched_at is not null then 'watched_vsl'
      else 'applied'
    end as derived_stage_key,
    a.created_at as person_created_at,
    a.next_action_at,
    a.next_action_due_at,
    a.last_contacted_at,
    -- timestamp when current stage was entered
    case
      when a.exam_passed_at is not null then a.exam_passed_at
      when a.exam_scheduled_at is not null then a.exam_scheduled_at
      when a.license_progress in ('finished_course','exam_passed','passed_test') then a.updated_at
      when a.course_started_at is not null then a.course_started_at
      when a.course_purchased_at is not null then a.course_purchased_at
      when a.seminar_attended_at is not null then a.seminar_attended_at
      when a.seminar_registered_at is not null then a.seminar_registered_at
      when a.seminar_date is not null then a.created_at
      when a.contacted_at is not null then a.contacted_at
      when a.last_contacted_at is not null then a.last_contacted_at
      when a.vsl_watched_at is not null then a.vsl_watched_at
      else a.created_at
    end as stage_entered_at
  from public.applications a
  where coalesce(a.is_duplicate, false) = false
    and a.status not in ('approved')      -- approved → agents path
),
agents_part as (
  select
    null::uuid as application_id,
    g.id as agent_id,
    'agent'::text as person_type,
    coalesce(split_part(p.full_name,' ',1), split_part(g.display_name,' ',1)) as first_name,
    coalesce(nullif(regexp_replace(p.full_name, '^\S+\s*', ''), ''), split_part(g.display_name,' ',2)) as last_name,
    p.email as email,
    p.phone as phone,
    g.status::text as legacy_status,
    g.license_status::text as license_progress,
    g.manager_id as owner_user_id,
    case
      when g.is_deactivated = true or g.status = 'terminated' then 'closed_lost'
      when g.first_10k_at is not null or g.weekly_10k_badges > 0 then 'first_10k_week'
      when g.first_deal_at is not null then 'first_deal'
      when g.first_appointment_at is not null then 'first_appointment'
      when g.field_training_started_at is not null or g.onboarding_stage::text = 'in_field_training' then 'infield_training'
      when g.onboarding_completed_at is not null then 'course_completed'
      when g.has_training_course = true then 'course_started'
      else 'hired'
    end as derived_stage_key,
    g.created_at as person_created_at,
    null::timestamptz as next_action_at,
    null::timestamptz as next_action_due_at,
    null::timestamptz as last_contacted_at,
    case
      when g.first_10k_at is not null then g.first_10k_at
      when g.first_deal_at is not null then g.first_deal_at
      when g.first_appointment_at is not null then g.first_appointment_at
      when g.field_training_started_at is not null then g.field_training_started_at
      when g.onboarding_completed_at is not null then g.onboarding_completed_at
      when g.has_training_course = true then coalesce(g.production_unlocked_at, g.contracted_at, g.start_date::timestamptz, g.created_at)
      else coalesce(g.contracted_at, g.start_date::timestamptz, g.created_at)
    end as stage_entered_at
  from public.agents g
  left join public.profiles p on p.user_id = g.user_id
)
select x.*, s.display_name as stage_display_name, s.next_action_label, s.next_action_url,
       s.sla_hours, s.owner_role, s.color_hex, s.icon_name, s.dashboard_section,
       s.candidate_message_template, s.failure_label, s.is_terminal,
       case when s.sla_hours is null then null else x.stage_entered_at + (s.sla_hours||' hours')::interval end as sla_due_at,
       case when s.sla_hours is null then null
            when now() > x.stage_entered_at + (s.sla_hours||' hours')::interval then true else false end as is_stalled,
       extract(epoch from (now() - x.stage_entered_at))/86400.0 as days_in_stage
from (select * from applicants union all select * from agents_part) x
left join public.next_step_stages s on s.stage_key = x.derived_stage_key;

-- ------- candidate-facing per-person view -----------------------------
create or replace view public.v_next_step_candidate as
select
  c.person_type,
  c.application_id,
  c.agent_id,
  c.first_name,
  c.last_name,
  c.derived_stage_key as stage_key,
  c.stage_display_name,
  c.next_action_label,
  c.next_action_url,
  c.stage_entered_at,
  c.sla_due_at,
  c.is_stalled,
  c.days_in_stage,
  s.candidate_message_template,
  s.icon_name,
  s.color_hex,
  s.dashboard_section,
  -- distance to terminal stage (18)
  s.order_index,
  18 as total_stages,
  round(100.0 * s.order_index / 18.0, 0) as percent_complete,
  -- ordered list of upcoming stages for the candidate progress strip
  (select jsonb_agg(jsonb_build_object('key', n.stage_key, 'name', n.display_name, 'order', n.order_index) order by n.order_index)
   from public.next_step_stages n where n.order_index >= s.order_index) as upcoming_stages,
  (select jsonb_agg(jsonb_build_object('key', n.stage_key, 'name', n.display_name, 'order', n.order_index) order by n.order_index)
   from public.next_step_stages n where n.order_index < s.order_index) as completed_stages
from public.v_next_step_current c
left join public.next_step_stages s on s.stage_key = c.derived_stage_key
where c.derived_stage_key is not null;

-- ------- manager command center: per-manager team summary -------------
create or replace view public.v_next_step_manager_board as
select
  c.owner_user_id as manager_user_id,
  c.derived_stage_key as stage_key,
  c.stage_display_name,
  s.order_index,
  s.color_hex,
  count(*)::int as person_count,
  count(*) filter (where c.is_stalled)::int as stalled_count,
  count(*) filter (where c.days_in_stage > 7)::int as over_week_count,
  avg(c.days_in_stage) as avg_days_in_stage,
  max(c.days_in_stage) as max_days_in_stage,
  array_agg(json_build_object(
    'application_id', c.application_id,
    'agent_id', c.agent_id,
    'first_name', c.first_name,
    'last_name', c.last_name,
    'days_in_stage', round(c.days_in_stage::numeric, 1),
    'is_stalled', c.is_stalled,
    'sla_due_at', c.sla_due_at
  ) order by c.is_stalled desc, c.days_in_stage desc) as persons
from public.v_next_step_current c
left join public.next_step_stages s on s.stage_key = c.derived_stage_key
where c.derived_stage_key not in ('closed_lost') and c.derived_stage_key is not null
group by c.owner_user_id, c.derived_stage_key, c.stage_display_name, s.order_index, s.color_hex;

-- ------- stuck pool: anyone past SLA ----------------------------------
create or replace view public.v_next_step_stuck_pool as
select
  c.*,
  case
    when c.days_in_stage > 30 then 'critical'
    when c.days_in_stage > 14 then 'high'
    when c.days_in_stage > 7 then 'medium'
    else 'low'
  end as severity
from public.v_next_step_current c
where c.is_stalled = true and c.derived_stage_key <> 'closed_lost'
order by c.days_in_stage desc;

-- ------- funnel health: conversion + median time per stage ------------
create or replace view public.v_next_step_funnel_health as
with cohort as (
  select c.derived_stage_key as stage_key,
         s.order_index,
         s.display_name,
         count(*)::int as in_stage,
         percentile_cont(0.5) within group (order by c.days_in_stage) as median_days,
         avg(c.days_in_stage) as avg_days,
         count(*) filter (where c.is_stalled)::int as stalled
  from public.v_next_step_current c
  left join public.next_step_stages s on s.stage_key = c.derived_stage_key
  where c.derived_stage_key is not null
  group by c.derived_stage_key, s.order_index, s.display_name
)
select stage_key, order_index, display_name, in_stage, stalled,
       round(median_days::numeric, 1) as median_days,
       round(avg_days::numeric, 1) as avg_days,
       (lead(in_stage) over (order by order_index))::int as next_stage_count,
       case
         when in_stage = 0 then null
         else round(100.0 * coalesce(lead(in_stage) over (order by order_index), 0) / in_stage, 1)
       end as conversion_to_next_pct
from cohort
order by order_index nulls last;
-- =====================================================================
-- NEXT STEP ENGINE — RPCs, triggers, cron sweepers
-- =====================================================================

-- ---------------- recompute one person's progress row -----------------
create or replace function public.fn_next_step_recompute_one(p_application_id uuid default null, p_agent_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_prior text;
  v_status text;
begin
  if p_application_id is null and p_agent_id is null then return; end if;

  select * into v_row
  from public.v_next_step_current
  where (application_id = p_application_id and p_application_id is not null)
     or (agent_id = p_agent_id and p_agent_id is not null)
  limit 1;

  if not found then return; end if;

  select current_stage_key into v_prior
  from public.next_step_progress
  where (application_id = p_application_id and p_application_id is not null)
     or (agent_id = p_agent_id and p_agent_id is not null)
  limit 1;

  v_status := case when v_row.derived_stage_key = 'closed_lost' then 'closed_lost'
                   when v_row.is_terminal then 'completed'
                   else 'active' end;

  if p_application_id is not null then
    if exists (select 1 from public.next_step_progress where application_id = p_application_id) then
      update public.next_step_progress
        set current_stage_key = v_row.derived_stage_key,
            entered_at = v_row.stage_entered_at,
            sla_due_at = v_row.sla_due_at,
            owner_user_id = v_row.owner_user_id,
            owner_role = v_row.owner_role,
            status = v_status,
            prior_stage_key = case when current_stage_key <> v_row.derived_stage_key then current_stage_key else prior_stage_key end,
            is_stalled = coalesce(v_row.is_stalled, false),
            updated_at = now()
        where application_id = p_application_id;
    else
      insert into public.next_step_progress
        (person_type, application_id, current_stage_key, entered_at, sla_due_at,
         owner_user_id, owner_role, status, prior_stage_key, is_stalled, updated_at)
      values (v_row.person_type, p_application_id, v_row.derived_stage_key, v_row.stage_entered_at, v_row.sla_due_at,
              v_row.owner_user_id, v_row.owner_role, v_status, v_prior, coalesce(v_row.is_stalled, false), now());
    end if;
  end if;

  if p_agent_id is not null then
    if exists (select 1 from public.next_step_progress where agent_id = p_agent_id) then
      update public.next_step_progress
        set current_stage_key = v_row.derived_stage_key,
            entered_at = v_row.stage_entered_at,
            sla_due_at = v_row.sla_due_at,
            owner_user_id = v_row.owner_user_id,
            owner_role = v_row.owner_role,
            status = v_status,
            prior_stage_key = case when current_stage_key <> v_row.derived_stage_key then current_stage_key else prior_stage_key end,
            is_stalled = coalesce(v_row.is_stalled, false),
            updated_at = now()
        where agent_id = p_agent_id;
    else
      insert into public.next_step_progress
        (person_type, agent_id, current_stage_key, entered_at, sla_due_at,
         owner_user_id, owner_role, status, prior_stage_key, is_stalled, updated_at)
      values (v_row.person_type, p_agent_id, v_row.derived_stage_key, v_row.stage_entered_at, v_row.sla_due_at,
              v_row.owner_user_id, v_row.owner_role, v_status, v_prior, coalesce(v_row.is_stalled, false), now());
    end if;
  end if;

  -- Stamp next_step_stage_key + next_step_due_at on source row for fast read
  if p_application_id is not null then
    update public.applications
      set next_step_stage_key = v_row.derived_stage_key,
          next_step_due_at = v_row.sla_due_at
      where id = p_application_id;
  end if;

  if p_agent_id is not null then
    update public.agents
      set next_step_stage_key = v_row.derived_stage_key,
          next_step_due_at = v_row.sla_due_at
      where id = p_agent_id;
  end if;

  -- Emit event if stage changed
  if v_prior is null or v_prior <> v_row.derived_stage_key then
    insert into public.next_step_events
      (application_id, agent_id, from_stage, to_stage, event_type, source, payload)
    values
      (p_application_id, p_agent_id, v_prior, v_row.derived_stage_key,
       case when v_prior is null then 'seed' else 'advance' end,
       'recompute',
       jsonb_build_object('triggered_by','fn_next_step_recompute_one','sla_due_at',v_row.sla_due_at));
  end if;
end;
$$;

-- ---------------- recompute everyone (initial backfill + nightly sync) ----
create or replace function public.fn_next_step_recompute_all()
returns table(processed int, advanced int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_processed int := 0;
  v_advanced int := 0;
  r record;
  prior text;
begin
  for r in select application_id, agent_id, derived_stage_key from public.v_next_step_current
  loop
    select current_stage_key into prior
    from public.next_step_progress
    where (application_id = r.application_id and r.application_id is not null)
       or (agent_id = r.agent_id and r.agent_id is not null) limit 1;

    perform public.fn_next_step_recompute_one(r.application_id, r.agent_id);
    v_processed := v_processed + 1;
    if prior is null or prior <> r.derived_stage_key then v_advanced := v_advanced + 1; end if;
  end loop;
  return query select v_processed, v_advanced;
end;
$$;

-- ---------------- stall sweep (every 15 min via pg_cron) --------------
create or replace function public.fn_next_step_stall_sweep()
returns table(flagged int, notified int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flagged int := 0;
  v_notified int := 0;
  r record;
begin
  for r in
    select np.id, np.application_id, np.agent_id, np.current_stage_key, np.sla_due_at, np.owner_user_id,
           s.stall_action, s.manager_alert_template, s.manager_alert_hours
    from public.next_step_progress np
    join public.next_step_stages s on s.stage_key = np.current_stage_key
    where np.status = 'active'
      and np.is_stalled = false
      and np.sla_due_at is not null
      and now() > np.sla_due_at
  loop
    update public.next_step_progress
      set is_stalled = true, stalled_at = now()
      where id = r.id;
    insert into public.next_step_events
      (application_id, agent_id, to_stage, event_type, source, payload)
    values
      (r.application_id, r.agent_id, r.current_stage_key, 'stall', 'cron',
       jsonb_build_object('sla_due_at', r.sla_due_at, 'stall_action', r.stall_action));
    v_flagged := v_flagged + 1;
  end loop;
  return query select v_flagged, v_notified;
end;
$$;

-- ---------------- nudge sweep (hourly) --------------------------------
-- Picks anyone whose current stage cadence dictates a nudge is due and
-- queues a row into next_step_messages — the edge fn drains and dispatches.
create or replace function public.fn_next_step_nudge_sweep()
returns table(queued int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queued int := 0;
  r record;
  v_days int;
  v_should_nudge boolean;
  v_dedupe text;
begin
  for r in
    select np.application_id, np.agent_id, np.current_stage_key, np.entered_at, np.nudge_count, np.last_nudged_at,
           s.reminder_cadence
    from public.next_step_progress np
    join public.next_step_stages s on s.stage_key = np.current_stage_key
    where np.status = 'active' and s.reminder_cadence is not null
  loop
    v_days := floor(extract(epoch from (now() - r.entered_at))/86400.0)::int;
    -- naive cadence check: split on , and look for day:N where N = v_days
    v_should_nudge := r.reminder_cadence like '%day:%' || v_days || '%'
                      or r.reminder_cadence like '%,' || v_days || '%'
                      or r.reminder_cadence like '%:' || v_days || ',%';
    if v_should_nudge and (r.last_nudged_at is null or r.last_nudged_at < now() - interval '20 hours') then
      v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':day' || v_days;
      insert into public.next_step_messages
        (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
      values
        (r.application_id, r.agent_id, r.current_stage_key, 'telegram',
         r.current_stage_key || ':day' || v_days, v_dedupe,
         jsonb_build_object('day', v_days, 'cadence', r.reminder_cadence))
      on conflict (dedupe_key) do nothing;
      update public.next_step_progress
        set last_nudged_at = now(), nudge_count = nudge_count + 1
        where (application_id = r.application_id and r.application_id is not null)
           or (agent_id = r.agent_id and r.agent_id is not null);
      v_queued := v_queued + 1;
    end if;
  end loop;
  return query select v_queued;
end;
$$;

-- ---------------- triggers: applications updates fire recompute -------
create or replace function public.fn_next_step_applications_recompute_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_next_step_recompute_one(new.id, null);
  return new;
end;
$$;

drop trigger if exists trg_next_step_applications_insert on public.applications;
create trigger trg_next_step_applications_insert
  after insert on public.applications
  for each row execute function public.fn_next_step_applications_recompute_trigger();

drop trigger if exists trg_next_step_applications_update on public.applications;
create trigger trg_next_step_applications_update
  after update of vsl_watched_at, contacted_at, last_contacted_at, seminar_registered_at,
                  seminar_date, seminar_attended_at, course_started_at, course_purchased_at,
                  license_progress, exam_scheduled_at, exam_passed_at, fingerprints_submitted_at,
                  fingerprint_done, license_approved_at, licensed_at, contracted_at, status,
                  first_deal_at, terminated_at, closed_at, is_duplicate
  on public.applications
  for each row execute function public.fn_next_step_applications_recompute_trigger();

-- ---------------- triggers: agents updates fire recompute -------------
create or replace function public.fn_next_step_agents_recompute_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_next_step_recompute_one(null, new.id);
  return new;
end;
$$;

drop trigger if exists trg_next_step_agents_insert on public.agents;
create trigger trg_next_step_agents_insert
  after insert on public.agents
  for each row execute function public.fn_next_step_agents_recompute_trigger();

drop trigger if exists trg_next_step_agents_update on public.agents;
create trigger trg_next_step_agents_update
  after update of has_training_course, field_training_started_at, onboarding_completed_at,
                  first_appointment_at, first_deal_at, first_10k_at, weekly_10k_badges,
                  status, is_deactivated, onboarding_stage, contracted_at
  on public.agents
  for each row execute function public.fn_next_step_agents_recompute_trigger();

-- ---------------- trigger: first-deal detection from deals table -----
-- When a deal row is inserted, set agents.first_deal_at and check $10K week
create or replace function public.fn_next_step_deal_first_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_first_deal_at timestamptz;
  v_week_total numeric;
begin
  if new.agent_id is null then return new; end if;

  select first_deal_at into v_existing_first_deal_at from public.agents where id = new.agent_id;
  if v_existing_first_deal_at is null then
    update public.agents set first_deal_at = coalesce(new.posted_at, new.submitted_at, new.created_at, now())
      where id = new.agent_id and first_deal_at is null;
  end if;

  -- Compute the trailing-7-day annual premium for this agent
  select coalesce(sum(annual_premium), 0) into v_week_total
  from public.deals
  where agent_id = new.agent_id
    and coalesce(posted_at, submitted_at, created_at) > now() - interval '7 days';

  if v_week_total >= 10000 then
    update public.agents
      set first_10k_at = coalesce(first_10k_at, now()),
          weekly_10k_badges = coalesce(weekly_10k_badges, 0) + case when first_10k_at is null then 1 else 0 end
      where id = new.agent_id;
  end if;

  perform public.fn_next_step_recompute_one(null, new.agent_id);
  return new;
end;
$$;

drop trigger if exists trg_next_step_deal_first_check on public.deals;
create trigger trg_next_step_deal_first_check
  after insert on public.deals
  for each row execute function public.fn_next_step_deal_first_check();

-- ---------------- manual advance RPC (used by UI buttons) -------------
create or replace function public.fn_next_step_manual_advance(
  p_application_id uuid default null,
  p_agent_id uuid default null,
  p_to_stage text default null,
  p_actor uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if p_application_id is not null then
    update public.applications
      set updated_at = v_now,
          contacted_at = case when p_to_stage = 'contacted' and contacted_at is null then v_now else contacted_at end,
          seminar_registered_at = case when p_to_stage = 'booked_seminar' and seminar_registered_at is null then v_now else seminar_registered_at end,
          seminar_attended_at = case when p_to_stage = 'attended_seminar' and seminar_attended_at is null then v_now else seminar_attended_at end,
          course_started_at = case when p_to_stage = 'started_prelicense' and course_started_at is null then v_now else course_started_at end,
          exam_scheduled_at = case when p_to_stage = 'exam_scheduled' and exam_scheduled_at is null then v_now else exam_scheduled_at end,
          exam_passed_at = case when p_to_stage = 'passed_exam' and exam_passed_at is null then v_now else exam_passed_at end,
          fingerprints_submitted_at = case when p_to_stage = 'passed_exam' and fingerprints_submitted_at is null and fingerprint_done is true then v_now else fingerprints_submitted_at end,
          contracted_at = case when p_to_stage = 'contracting' and contracted_at is null then v_now else contracted_at end,
          status = case when p_to_stage = 'contracting' then 'contracting'::application_status else status end
      where id = p_application_id;
    insert into public.next_step_events(application_id, to_stage, event_type, actor_user_id, source, payload)
      values (p_application_id, p_to_stage, 'manual_override', p_actor, 'manual',
              jsonb_build_object('reason', p_reason));
  end if;
  if p_agent_id is not null then
    update public.agents
      set first_appointment_at = case when p_to_stage = 'first_appointment' and first_appointment_at is null then v_now else first_appointment_at end,
          field_training_started_at = case when p_to_stage = 'infield_training' and field_training_started_at is null then v_now else field_training_started_at end,
          onboarding_completed_at = case when p_to_stage = 'course_completed' and onboarding_completed_at is null then v_now else onboarding_completed_at end,
          updated_at = v_now
      where id = p_agent_id;
    insert into public.next_step_events(agent_id, to_stage, event_type, actor_user_id, source, payload)
      values (p_agent_id, p_to_stage, 'manual_override', p_actor, 'manual',
              jsonb_build_object('reason', p_reason));
  end if;
  return jsonb_build_object('ok', true, 'application_id', p_application_id, 'agent_id', p_agent_id, 'to_stage', p_to_stage);
end;
$$;

-- ---------------- pg_cron schedule -----------------------------------
-- Stall sweep every 15m, nudge sweep hourly, full recompute nightly 3am
do $$ begin
  perform cron.schedule('next_step_stall_sweep', '*/15 * * * *', $cron$ select public.fn_next_step_stall_sweep(); $cron$);
exception when others then null; end $$;

do $$ begin
  perform cron.schedule('next_step_nudge_sweep', '7 * * * *', $cron$ select public.fn_next_step_nudge_sweep(); $cron$);
exception when others then null; end $$;

do $$ begin
  perform cron.schedule('next_step_recompute_all', '0 3 * * *', $cron$ select public.fn_next_step_recompute_all(); $cron$);
exception when others then null; end $$;

-- ---------------- grant execute on RPCs to authenticated --------------
grant execute on function public.fn_next_step_recompute_one(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_next_step_recompute_all() to service_role;
grant execute on function public.fn_next_step_manual_advance(uuid, uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.fn_next_step_stall_sweep() to service_role;
grant execute on function public.fn_next_step_nudge_sweep() to service_role;
