-- =====================================================================
-- NEXT STEP ENGINE — every applicant/agent always knows what's next
-- Migration: 20260519060000_next_step_engine.sql
-- Author: Claude (Opus 4.7) for Sam James
-- Shipped: 2026-05-19
-- =====================================================================
-- 18-stage funnel: Applied → VSL → Application → Manager-contact →
-- Seminar booked → Seminar attended → Pre-license start → Pre-license
-- finish → Exam scheduled → Exam passed → Contracting → Hired →
-- Course started → Course completed → Infield → First appointment →
-- First deal → First $10K
-- =====================================================================

BEGIN;

-- ─── 1. Catalog table (18 stages, immutable codes, mutable text) ──────
CREATE TABLE IF NOT EXISTS public.next_step_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,                 -- stable: applied, vsl_watched, ...
  ordinal         int  UNIQUE NOT NULL,                 -- 1..18
  name            text NOT NULL,                        -- human label
  description     text NOT NULL,                        -- "what they should do next" copy
  default_owner   text NOT NULL DEFAULT 'system'        -- 'system'|'recruit'|'manager'|'admin'
                  CHECK (default_owner IN ('system','recruit','manager','admin')),
  expected_duration_days  int  NOT NULL DEFAULT 1,
  stall_threshold_days    int  NOT NULL DEFAULT 3,
  auto_advance_sql        text,                         -- optional SQL predicate for auto-advance
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_next_step_stages_ordinal ON public.next_step_stages(ordinal);

-- Seed the 18 stages (idempotent)
INSERT INTO public.next_step_stages (code, ordinal, name, description, default_owner, expected_duration_days, stall_threshold_days) VALUES
  ('applied',           1,  'Applied',            'Watch the VSL to unlock your seminar invite.',                              'recruit', 1, 2),
  ('vsl_watched',       2,  'VSL Watched',        'Finish the application — takes under 5 minutes.',                          'recruit', 1, 2),
  ('application_done',  3,  'Application Done',   'Manager will reach out within 24h. Keep your phone on.',                   'manager', 1, 2),
  ('manager_contact',   4,  'Manager Contact',    'Book your seminar seat — pick the next slot that fits.',                   'recruit', 1, 3),
  ('seminar_booked',    5,  'Seminar Booked',     'Show up to the seminar on time. We start sharp.',                          'recruit', 2, 3),
  ('seminar_attended',  6,  'Seminar Attended',   'Start pre-licensing course this week — link in your email.',               'recruit', 1, 3),
  ('prelicense_start',  7,  'Pre-License Started','Complete all course modules. Pace = 1 chapter/day to finish in 14 days.', 'recruit', 14, 5),
  ('prelicense_done',   8,  'Pre-License Done',   'Schedule your state exam now — slots fill 1-2 weeks out.',                 'recruit', 3, 4),
  ('exam_scheduled',    9,  'Exam Scheduled',     'Show up, pass the exam. Bring 2 forms of ID + confirmation email.',        'recruit', 7, 7),
  ('exam_passed',      10,  'Exam Passed',        'Send your NIPR number to your manager so we contract you.',                'recruit', 2, 3),
  ('contracting',      11,  'Contracting',        'Sign contracts in your inbox. Carriers approve in 24-72h.',                'recruit', 3, 5),
  ('hired',            12,  'Hired',              'Start the new-agent course in your portal today.',                         'recruit', 1, 2),
  ('course_started',   13,  'Course Started',     'Complete every module. New agents who finish in 7 days hit $10K fastest.','recruit', 7, 5),
  ('course_done',      14,  'Course Done',        'Get in the field — first appointment within 48h.',                         'recruit', 2, 3),
  ('infield',          15,  'In Field',           'Run your first appointment. Manager will ride along if requested.',        'recruit', 3, 5),
  ('first_appt',       16,  'First Appointment', 'Submit your first deal — quote, app, e-sign, payment.',                    'recruit', 5, 7),
  ('first_deal',       17,  'First Deal',         'Stack volume — push toward your first $10K month.',                        'recruit', 21, 10),
  ('first_10k',        18,  'First $10K Month',   'You are a producer. Recruit your first downline. Hold the Standard.',     'recruit', 30, 30)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  default_owner = EXCLUDED.default_owner,
  expected_duration_days = EXCLUDED.expected_duration_days,
  stall_threshold_days = EXCLUDED.stall_threshold_days,
  updated_at = now();


-- ─── 2. Progress table — one row per (subject, stage) ─────────────────
DO $$ BEGIN
  CREATE TYPE public.next_step_status AS ENUM ('not_started','in_progress','done','skipped','stalled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.next_step_subject_kind AS ENUM ('application','agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.next_step_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind    public.next_step_subject_kind NOT NULL,
  subject_id      uuid NOT NULL,                        -- applications.id OR agents.id
  stage_code      text NOT NULL REFERENCES public.next_step_stages(code) ON UPDATE CASCADE,
  status          public.next_step_status NOT NULL DEFAULT 'not_started',
  started_at      timestamptz,
  completed_at    timestamptz,
  due_at          timestamptz,
  owner           text,                                  -- override of stage.default_owner
  notes           text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_kind, subject_id, stage_code)
);

CREATE INDEX IF NOT EXISTS idx_nsp_subject ON public.next_step_progress(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_nsp_status ON public.next_step_progress(status);
CREATE INDEX IF NOT EXISTS idx_nsp_due_at ON public.next_step_progress(due_at) WHERE status IN ('in_progress','not_started');
CREATE INDEX IF NOT EXISTS idx_nsp_stage  ON public.next_step_progress(stage_code);


-- ─── 3. Event audit trail (INSERT-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.next_step_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind  public.next_step_subject_kind NOT NULL,
  subject_id    uuid NOT NULL,
  stage_code    text NOT NULL,
  event_type    text NOT NULL,    -- advanced|stalled|skipped|message_sent|reset|auto_advance
  from_status   public.next_step_status,
  to_status     public.next_step_status,
  actor         text,             -- user id, 'trigger', 'cron', 'manual'
  channel       text,             -- when event_type=message_sent
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nse_subject ON public.next_step_events(subject_kind, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nse_type    ON public.next_step_events(event_type, created_at DESC);


-- ─── 4. Message templates per (stage, channel) ───────────────────────
DO $$ BEGIN
  CREATE TYPE public.next_step_channel AS ENUM ('telegram','sms','email','in_app','discord');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.next_step_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_code   text NOT NULL REFERENCES public.next_step_stages(code) ON UPDATE CASCADE,
  channel      public.next_step_channel NOT NULL,
  subject_line text,                                       -- for email
  body         text NOT NULL,                              -- supports {{first_name}}, {{stage_name}}, {{portal_url}}
  variables    text[] NOT NULL DEFAULT '{}'::text[],
  voice_checked boolean NOT NULL DEFAULT true,             -- King-of-Sales / Apex Standard tone confirmed
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_code, channel)
);

-- Seed 18 × 3 = 54 messages (telegram, sms, email per stage)
-- Voice: direct, no fluff, action-first, Apex Standard cadence.
INSERT INTO public.next_step_messages (stage_code, channel, subject_line, body, variables) VALUES
  -- 1. applied
  ('applied','telegram',NULL,'{{first_name}} — application in. Next move: watch the VSL. 12 min. Unlocks your seminar invite.',ARRAY['first_name']),
  ('applied','sms',NULL,'Apex: {{first_name}}, application received. Watch the VSL now to unlock your seminar invite: {{vsl_url}}',ARRAY['first_name','vsl_url']),
  ('applied','email','Your Apex application — next step','Hey {{first_name}},'||chr(10)||chr(10)||'Application in. One thing stands between you and your seminar seat: the VSL.'||chr(10)||chr(10)||'Watch it now → {{vsl_url}}'||chr(10)||chr(10)||'12 minutes. Then you''re in.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name','vsl_url']),
  -- 2. vsl_watched
  ('vsl_watched','telegram',NULL,'{{first_name}} — VSL done. Finish the application now. Under 5 min: {{application_url}}',ARRAY['first_name','application_url']),
  ('vsl_watched','sms',NULL,'Apex: {{first_name}}, VSL done. Finish your application (under 5 min): {{application_url}}',ARRAY['first_name','application_url']),
  ('vsl_watched','email','Finish your application','{{first_name}} —'||chr(10)||chr(10)||'VSL behind you. The application is the gate. Under 5 minutes to complete:'||chr(10)||chr(10)||'{{application_url}}'||chr(10)||chr(10)||'Hold the Standard.',ARRAY['first_name','application_url']),
  -- 3. application_done
  ('application_done','telegram',NULL,'{{first_name}} — application locked in. A manager calls you in the next 24h. Keep your phone on.',ARRAY['first_name']),
  ('application_done','sms',NULL,'Apex: {{first_name}}, app received. Manager calls within 24h. Phone on, please.',ARRAY['first_name']),
  ('application_done','email','We''re calling you within 24h','{{first_name}} —'||chr(10)||chr(10)||'Application in. A manager calls within 24 hours.'||chr(10)||chr(10)||'Keep your phone on and answer unknown numbers — that''s us.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 4. manager_contact
  ('manager_contact','telegram',NULL,'{{first_name}} — manager call done. Book your seminar seat: {{seminar_url}}',ARRAY['first_name','seminar_url']),
  ('manager_contact','sms',NULL,'Apex: {{first_name}}, lock in your seminar seat: {{seminar_url}}',ARRAY['first_name','seminar_url']),
  ('manager_contact','email','Book your seminar seat','{{first_name}} —'||chr(10)||chr(10)||'Manager contact: done. Now lock in your seminar seat — seats are limited:'||chr(10)||chr(10)||'{{seminar_url}}'||chr(10)||chr(10)||'Pick the next slot that fits.',ARRAY['first_name','seminar_url']),
  -- 5. seminar_booked
  ('seminar_booked','telegram',NULL,'{{first_name}} — seat booked for {{seminar_date}}. Show up sharp. We start on time.',ARRAY['first_name','seminar_date']),
  ('seminar_booked','sms',NULL,'Apex: {{first_name}}, seat locked for {{seminar_date}}. Show up sharp.',ARRAY['first_name','seminar_date']),
  ('seminar_booked','email','Seminar locked — {{seminar_date}}','{{first_name}} —'||chr(10)||chr(10)||'Seat booked for {{seminar_date}}. We start on time and we don''t wait.'||chr(10)||chr(10)||'Be early. Have water. Bring a pen. Show up like you mean it.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name','seminar_date']),
  -- 6. seminar_attended
  ('seminar_attended','telegram',NULL,'{{first_name}} — strong work showing up. Start pre-licensing this week. Link in your email.',ARRAY['first_name']),
  ('seminar_attended','sms',NULL,'Apex: {{first_name}}, start pre-licensing this week: {{prelicense_url}}',ARRAY['first_name','prelicense_url']),
  ('seminar_attended','email','Start pre-licensing this week','{{first_name}} —'||chr(10)||chr(10)||'Seminar done. Now the work begins.'||chr(10)||chr(10)||'Start your pre-licensing course this week — every day you delay is a day someone else gets your spot:'||chr(10)||chr(10)||'{{prelicense_url}}'||chr(10)||chr(10)||'Hold the Standard.',ARRAY['first_name','prelicense_url']),
  -- 7. prelicense_start
  ('prelicense_start','telegram',NULL,'{{first_name}} — pace = 1 chapter/day. 14 days to finish. Don''t coast.',ARRAY['first_name']),
  ('prelicense_start','sms',NULL,'Apex: {{first_name}}, 1 chapter/day = exam-ready in 14. Don''t coast.',ARRAY['first_name']),
  ('prelicense_start','email','Pace the course like a pro','{{first_name}} —'||chr(10)||chr(10)||'Course started. The discipline that wins: 1 chapter/day.'||chr(10)||chr(10)||'14 days from today, you''re sitting for the exam. Anything slower and you''re bleeding momentum.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 8. prelicense_done
  ('prelicense_done','telegram',NULL,'{{first_name}} — course done. Schedule the state exam TODAY. Slots fill 1-2 weeks out.',ARRAY['first_name']),
  ('prelicense_done','sms',NULL,'Apex: {{first_name}}, schedule your state exam today — slots fill fast.',ARRAY['first_name']),
  ('prelicense_done','email','Schedule the exam today','{{first_name}} —'||chr(10)||chr(10)||'Course: done. Now the only thing between you and licensed is your exam date.'||chr(10)||chr(10)||'Schedule it TODAY. PSI/Prometric/Pearson slots fill 1-2 weeks out — waiters become forgotten applicants.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 9. exam_scheduled
  ('exam_scheduled','telegram',NULL,'{{first_name}} — exam locked for {{exam_date}}. Bring 2 IDs + confirmation. Pass it.',ARRAY['first_name','exam_date']),
  ('exam_scheduled','sms',NULL,'Apex: {{first_name}}, exam on {{exam_date}}. Bring 2 IDs + confirmation email.',ARRAY['first_name','exam_date']),
  ('exam_scheduled','email','Exam day prep','{{first_name}} —'||chr(10)||chr(10)||'Exam: {{exam_date}}. Game day.'||chr(10)||chr(10)||'Bring: 2 forms of ID, confirmation email, water, an empty pocket.'||chr(10)||chr(10)||'You''re ready. Walk in like it.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name','exam_date']),
  -- 10. exam_passed
  ('exam_passed','telegram',NULL,'{{first_name}} — LICENSED. Send your NIPR number to your manager so we get you contracted.',ARRAY['first_name']),
  ('exam_passed','sms',NULL,'Apex: {{first_name}}, you passed! Send your NIPR to your manager so we contract you.',ARRAY['first_name']),
  ('exam_passed','email','Licensed. Send us your NIPR.','{{first_name}} —'||chr(10)||chr(10)||'You. Are. Licensed.'||chr(10)||chr(10)||'Reply to this email with your NIPR number. We start contracting you with carriers TODAY.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 11. contracting
  ('contracting','telegram',NULL,'{{first_name}} — contracts in your inbox. Sign every one. 24-72h to carrier approval.',ARRAY['first_name']),
  ('contracting','sms',NULL,'Apex: {{first_name}}, sign the carrier contracts in your inbox. 24-72h to approval.',ARRAY['first_name']),
  ('contracting','email','Sign your carrier contracts','{{first_name}} —'||chr(10)||chr(10)||'Contracts are landing in your inbox. Sign every single one same-day.'||chr(10)||chr(10)||'24-72h to carrier approval after you sign. Every hour you wait is an hour you''re not selling.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 12. hired
  ('hired','telegram',NULL,'{{first_name}} — contracted. Welcome to Apex. Start the new-agent course in your portal NOW.',ARRAY['first_name']),
  ('hired','sms',NULL,'Apex: {{first_name}}, welcome. Start your new-agent course today: {{portal_url}}',ARRAY['first_name','portal_url']),
  ('hired','email','Welcome to Apex','{{first_name}} —'||chr(10)||chr(10)||'You''re in. Officially Apex.'||chr(10)||chr(10)||'One job today: start the new-agent course in your portal. The agents who finish in 7 days hit their first $10K month fastest.'||chr(10)||chr(10)||'{{portal_url}}'||chr(10)||chr(10)||'Hold the Standard.',ARRAY['first_name','portal_url']),
  -- 13. course_started
  ('course_started','telegram',NULL,'{{first_name}} — course in motion. Finish in 7 days. Top producers do it in 3.',ARRAY['first_name']),
  ('course_started','sms',NULL,'Apex: {{first_name}}, finish the new-agent course in 7 days. Top producers do it in 3.',ARRAY['first_name']),
  ('course_started','email','Speed = money','{{first_name}} —'||chr(10)||chr(10)||'Course started. Now move fast.'||chr(10)||chr(10)||'7 days to finish = first $10K within 60.'||chr(10)||chr(10)||'3 days to finish = you''re in our top tier.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 14. course_done
  ('course_done','telegram',NULL,'{{first_name}} — course done. First appointment within 48h. Get in the field.',ARRAY['first_name']),
  ('course_done','sms',NULL,'Apex: {{first_name}}, course done. First appointment within 48h.',ARRAY['first_name']),
  ('course_done','email','Get in the field','{{first_name}} —'||chr(10)||chr(10)||'Course complete. You know enough. The rest is reps.'||chr(10)||chr(10)||'First appointment within 48h. No exceptions. Manager will ride along if you ask.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 15. infield
  ('infield','telegram',NULL,'{{first_name}} — first appointment locked. Run it like a pro. Quote, app, e-sign, payment.',ARRAY['first_name']),
  ('infield','sms',NULL,'Apex: {{first_name}}, first appointment locked. Quote → app → e-sign → payment. Close it.',ARRAY['first_name']),
  ('infield','email','First appointment — the playbook','{{first_name}} —'||chr(10)||chr(10)||'First appointment. The flow doesn''t change:'||chr(10)||chr(10)||'Quote → application → e-sign → payment. In that order. Same visit.'||chr(10)||chr(10)||'Don''t leave without a decision.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 16. first_appt
  ('first_appt','telegram',NULL,'{{first_name}} — first appointment done. Submit your first deal. Quote, app, payment, done.',ARRAY['first_name']),
  ('first_appt','sms',NULL,'Apex: {{first_name}}, submit your first deal today.',ARRAY['first_name']),
  ('first_appt','email','Submit the first deal','{{first_name}} —'||chr(10)||chr(10)||'First appointment behind you. Now log the deal: AgentLink → New Application → submit.'||chr(10)||chr(10)||'A deal you didn''t submit is a deal you didn''t close.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 17. first_deal
  ('first_deal','telegram',NULL,'{{first_name}} — FIRST DEAL DONE. Now stack volume. $10K month is the next checkpoint.',ARRAY['first_name']),
  ('first_deal','sms',NULL,'Apex: {{first_name}}, first deal in the books! $10K month is next. Stack volume.',ARRAY['first_name']),
  ('first_deal','email','First deal — now stack','{{first_name}} —'||chr(10)||chr(10)||'You''re a producer. Officially.'||chr(10)||chr(10)||'Next checkpoint: first $10K month. Top new agents hit it within 60 days of their first deal.'||chr(10)||chr(10)||'Volume wins. Stack.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name']),
  -- 18. first_10k
  ('first_10k','telegram',NULL,'{{first_name}} — $10K MONTH. You are a producer. Now build your downline. Hold the Standard.',ARRAY['first_name']),
  ('first_10k','sms',NULL,'Apex: {{first_name}}, $10K month locked. Recruit your first downline. Hold the Standard.',ARRAY['first_name']),
  ('first_10k','email','$10K month — now you build','{{first_name}} —'||chr(10)||chr(10)||'$10K. Locked.'||chr(10)||chr(10)||'You''re no longer a recruit. You''re a producer with a real story. Now use it: recruit your first downline.'||chr(10)||chr(10)||'Average is the disease. Hold the Standard.'||chr(10)||chr(10)||'— Apex',ARRAY['first_name'])
ON CONFLICT (stage_code, channel) DO UPDATE SET
  subject_line = EXCLUDED.subject_line,
  body = EXCLUDED.body,
  variables = EXCLUDED.variables,
  updated_at = now();

-- in_app + discord variants (admin/manager-facing nudge cards)
INSERT INTO public.next_step_messages (stage_code, channel, subject_line, body, variables) VALUES
  ('applied',          'discord', NULL, 'NEW APPLICATION → {{first_name}} {{last_name}}. Stage: Applied. Owner: recruit (auto VSL nudge fired).', ARRAY['first_name','last_name']),
  ('manager_contact',  'discord', NULL, '{{first_name}} {{last_name}} is waiting on a manager call. SLA: 24h. Pick this up.', ARRAY['first_name','last_name']),
  ('exam_passed',      'discord', NULL, 'LICENSED → {{first_name}} {{last_name}}. NIPR needed → start contracting today.', ARRAY['first_name','last_name']),
  ('hired',            'discord', NULL, 'HIRE → {{first_name}} {{last_name}} is contracted. Welcome blast fired.', ARRAY['first_name','last_name']),
  ('first_deal',       'discord', NULL, 'FIRST DEAL → {{first_name}} {{last_name}}. Producer status unlocked.', ARRAY['first_name','last_name']),
  ('first_10k',        'discord', NULL, '$10K MONTH → {{first_name}} {{last_name}}. Producer + future recruiter.', ARRAY['first_name','last_name'])
ON CONFLICT (stage_code, channel) DO NOTHING;


-- ─── 5. RLS — admin only on writes; read-yourself on progress ────────
ALTER TABLE public.next_step_stages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.next_step_progress  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.next_step_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.next_step_messages  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.next_step_stages, public.next_step_progress, public.next_step_events, public.next_step_messages FROM anon;
GRANT SELECT ON public.next_step_stages, public.next_step_messages TO authenticated;
GRANT SELECT ON public.next_step_progress, public.next_step_events TO authenticated;

DROP POLICY IF EXISTS next_step_stages_admin_all ON public.next_step_stages;
CREATE POLICY next_step_stages_admin_all ON public.next_step_stages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS next_step_stages_authed_read ON public.next_step_stages;
CREATE POLICY next_step_stages_authed_read ON public.next_step_stages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS next_step_progress_admin_all ON public.next_step_progress;
CREATE POLICY next_step_progress_admin_all ON public.next_step_progress
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role));

DROP POLICY IF EXISTS next_step_events_admin_read ON public.next_step_events;
CREATE POLICY next_step_events_admin_read ON public.next_step_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role));

DROP POLICY IF EXISTS next_step_events_admin_insert ON public.next_step_events;
CREATE POLICY next_step_events_admin_insert ON public.next_step_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role));

DROP POLICY IF EXISTS next_step_messages_admin_all ON public.next_step_messages;
CREATE POLICY next_step_messages_admin_all ON public.next_step_messages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS next_step_messages_authed_read ON public.next_step_messages;
CREATE POLICY next_step_messages_authed_read ON public.next_step_messages
  FOR SELECT TO authenticated USING (true);


-- ─── 6. updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_next_step_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nsp_touch ON public.next_step_progress;
CREATE TRIGGER trg_nsp_touch BEFORE UPDATE ON public.next_step_progress
  FOR EACH ROW EXECUTE FUNCTION public.tg_next_step_touch_updated_at();

DROP TRIGGER IF EXISTS trg_nss_touch ON public.next_step_stages;
CREATE TRIGGER trg_nss_touch BEFORE UPDATE ON public.next_step_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_next_step_touch_updated_at();

DROP TRIGGER IF EXISTS trg_nsm_touch ON public.next_step_messages;
CREATE TRIGGER trg_nsm_touch BEFORE UPDATE ON public.next_step_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_next_step_touch_updated_at();


-- ─── 7. RPC: next_step_advance(subject_kind, subject_id, to_stage) ───
CREATE OR REPLACE FUNCTION public.next_step_advance(
  p_subject_kind public.next_step_subject_kind,
  p_subject_id   uuid,
  p_to_stage     text,
  p_actor        text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage   public.next_step_stages%ROWTYPE;
  v_now     timestamptz := now();
  v_prev    public.next_step_progress%ROWTYPE;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_stage FROM public.next_step_stages WHERE code = p_to_stage;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown stage: %', p_to_stage;
  END IF;

  -- Mark every prior stage done (idempotent)
  INSERT INTO public.next_step_progress (subject_kind, subject_id, stage_code, status, started_at, completed_at, due_at)
  SELECT p_subject_kind, p_subject_id, s.code, 'done', v_now, v_now, v_now
  FROM public.next_step_stages s
  WHERE s.ordinal < v_stage.ordinal
  ON CONFLICT (subject_kind, subject_id, stage_code) DO UPDATE SET
    status = CASE WHEN public.next_step_progress.status IN ('done','skipped') THEN public.next_step_progress.status ELSE 'done' END,
    completed_at = COALESCE(public.next_step_progress.completed_at, v_now);

  -- Upsert current stage into in_progress
  SELECT * INTO v_prev FROM public.next_step_progress
   WHERE subject_kind = p_subject_kind AND subject_id = p_subject_id AND stage_code = p_to_stage;

  INSERT INTO public.next_step_progress (subject_kind, subject_id, stage_code, status, started_at, due_at, owner)
  VALUES (p_subject_kind, p_subject_id, p_to_stage, 'in_progress', v_now,
          v_now + make_interval(days => v_stage.expected_duration_days), v_stage.default_owner)
  ON CONFLICT (subject_kind, subject_id, stage_code) DO UPDATE SET
    status = CASE WHEN public.next_step_progress.status = 'done' THEN 'done' ELSE 'in_progress' END,
    started_at = COALESCE(public.next_step_progress.started_at, v_now),
    due_at = COALESCE(public.next_step_progress.due_at, v_now + make_interval(days => v_stage.expected_duration_days));

  -- Audit event
  INSERT INTO public.next_step_events (subject_kind, subject_id, stage_code, event_type, from_status, to_status, actor)
  VALUES (p_subject_kind, p_subject_id, p_to_stage, 'advanced', v_prev.status, 'in_progress', p_actor);

  SELECT jsonb_build_object(
    'subject_kind', p_subject_kind,
    'subject_id', p_subject_id,
    'stage', v_stage.code,
    'ordinal', v_stage.ordinal,
    'due_at', v_now + make_interval(days => v_stage.expected_duration_days),
    'owner', v_stage.default_owner
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.next_step_advance(public.next_step_subject_kind, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_step_advance(public.next_step_subject_kind, uuid, text, text) TO authenticated, service_role;


-- ─── 8. RPC: next_step_stall_check() — flips overdue rows to stalled ─
CREATE OR REPLACE FUNCTION public.next_step_stall_check()
RETURNS TABLE (subject_kind public.next_step_subject_kind, subject_id uuid, stage_code text, due_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH updated AS (
    UPDATE public.next_step_progress p
       SET status = 'stalled'
      FROM public.next_step_stages s
     WHERE s.code = p.stage_code
       AND p.status = 'in_progress'
       AND p.started_at IS NOT NULL
       AND p.started_at < v_now - make_interval(days => s.stall_threshold_days)
    RETURNING p.subject_kind, p.subject_id, p.stage_code, p.due_at
  ),
  audit AS (
    INSERT INTO public.next_step_events (subject_kind, subject_id, stage_code, event_type, from_status, to_status, actor)
    SELECT u.subject_kind, u.subject_id, u.stage_code, 'stalled', 'in_progress'::public.next_step_status, 'stalled'::public.next_step_status, 'cron'
    FROM updated u
    RETURNING 1
  )
  SELECT u.subject_kind, u.subject_id, u.stage_code, u.due_at FROM updated u;
END;
$$;

REVOKE ALL ON FUNCTION public.next_step_stall_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_step_stall_check() TO authenticated, service_role;


-- ─── 9. RPC: next_step_message_pack(subject_kind, subject_id) ────────
-- Returns the current stage + all channel-templates with variables resolved.
CREATE OR REPLACE FUNCTION public.next_step_message_pack(
  p_subject_kind public.next_step_subject_kind,
  p_subject_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_code text;
  v_first_name text;
  v_last_name  text;
  v_messages   jsonb;
BEGIN
  -- Current stage = highest-ordinal in_progress|not_started row, else last done
  SELECT p.stage_code
    INTO v_stage_code
    FROM public.next_step_progress p
    JOIN public.next_step_stages s ON s.code = p.stage_code
   WHERE p.subject_kind = p_subject_kind AND p.subject_id = p_subject_id
     AND p.status IN ('in_progress','not_started','stalled')
   ORDER BY s.ordinal DESC
   LIMIT 1;

  IF v_stage_code IS NULL THEN
    SELECT p.stage_code INTO v_stage_code
      FROM public.next_step_progress p
      JOIN public.next_step_stages s ON s.code = p.stage_code
     WHERE p.subject_kind = p_subject_kind AND p.subject_id = p_subject_id
     ORDER BY s.ordinal DESC LIMIT 1;
  END IF;

  IF v_stage_code IS NULL THEN
    v_stage_code := 'applied';
  END IF;

  IF p_subject_kind = 'application' THEN
    SELECT a.first_name, a.last_name INTO v_first_name, v_last_name
      FROM public.applications a WHERE a.id = p_subject_id;
  ELSE
    SELECT pr.first_name, pr.last_name INTO v_first_name, v_last_name
      FROM public.agents ag
      LEFT JOIN public.profiles pr ON pr.id = ag.profile_id
     WHERE ag.id = p_subject_id;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'channel', m.channel,
           'subject_line', m.subject_line,
           'body', replace(replace(replace(m.body, '{{first_name}}', COALESCE(v_first_name,'there')),
                                   '{{last_name}}', COALESCE(v_last_name,'')),
                                   '{{stage_name}}', (SELECT name FROM public.next_step_stages WHERE code = v_stage_code))
         ))
    INTO v_messages
    FROM public.next_step_messages m
   WHERE m.stage_code = v_stage_code AND m.is_active = true;

  RETURN jsonb_build_object(
    'subject_kind', p_subject_kind,
    'subject_id', p_subject_id,
    'stage_code', v_stage_code,
    'first_name', v_first_name,
    'last_name', v_last_name,
    'messages', COALESCE(v_messages, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.next_step_message_pack(public.next_step_subject_kind, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_step_message_pack(public.next_step_subject_kind, uuid) TO authenticated, service_role;


-- ─── 10. Trigger: applications.status / created → seed + advance ────
CREATE OR REPLACE FUNCTION public.tg_applications_to_next_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_stage text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target_stage := 'applied';
    PERFORM public.next_step_advance('application'::public.next_step_subject_kind, NEW.id, v_target_stage, 'trigger:applications_insert');
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status::text,'') <> COALESCE(NEW.status::text,'') THEN
    v_target_stage := CASE NEW.status::text
                        WHEN 'new'         THEN 'application_done'
                        WHEN 'reviewing'   THEN 'application_done'
                        WHEN 'no_pickup'   THEN 'application_done'
                        WHEN 'interview'   THEN 'manager_contact'
                        WHEN 'contracting' THEN 'contracting'
                        WHEN 'approved'    THEN 'hired'
                        WHEN 'rejected'    THEN NULL
                        ELSE NULL END;
    IF v_target_stage IS NOT NULL THEN
      PERFORM public.next_step_advance('application'::public.next_step_subject_kind, NEW.id, v_target_stage, 'trigger:applications_status');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_next_step ON public.applications;
CREATE TRIGGER trg_applications_next_step
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_applications_to_next_step();


-- ─── 11. Trigger: agents — on insert / contracting flip → advance ───
CREATE OR REPLACE FUNCTION public.tg_agents_to_next_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.next_step_advance('agent'::public.next_step_subject_kind, NEW.id, 'hired', 'trigger:agents_insert');
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.status::text,'') <> COALESCE(NEW.status::text,'')
       AND NEW.status::text = 'active' THEN
      PERFORM public.next_step_advance('agent'::public.next_step_subject_kind, NEW.id, 'hired', 'trigger:agents_active');
    END IF;
    IF COALESCE(OLD.license_status::text,'') <> COALESCE(NEW.license_status::text,'')
       AND NEW.license_status::text = 'licensed' THEN
      PERFORM public.next_step_advance('agent'::public.next_step_subject_kind, NEW.id, 'exam_passed', 'trigger:agents_licensed');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_next_step ON public.agents;
CREATE TRIGGER trg_agents_next_step
  AFTER INSERT OR UPDATE OF status, license_status ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.tg_agents_to_next_step();


-- ─── 12. Trigger: seminar_registrations → advance ────────────────────
CREATE OR REPLACE FUNCTION public.tg_seminar_to_next_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id uuid;
BEGIN
  SELECT id INTO v_app_id FROM public.applications
   WHERE lower(email) = lower(COALESCE(NEW.email,''))
   ORDER BY created_at DESC LIMIT 1;

  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.next_step_advance('application'::public.next_step_subject_kind, v_app_id, 'seminar_booked', 'trigger:seminar_registered');
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.attended,false) = false AND COALESCE(NEW.attended,false) = true THEN
    PERFORM public.next_step_advance('application'::public.next_step_subject_kind, v_app_id, 'seminar_attended', 'trigger:seminar_attended');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seminar_next_step ON public.seminar_registrations;
CREATE TRIGGER trg_seminar_next_step
  AFTER INSERT OR UPDATE OF attended ON public.seminar_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_seminar_to_next_step();


-- ─── 13. Views ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_next_step_current_stage_per_agent AS
WITH ranked AS (
  SELECT
    p.subject_kind,
    p.subject_id,
    p.stage_code,
    p.status,
    p.started_at,
    p.due_at,
    p.completed_at,
    s.ordinal,
    s.name AS stage_name,
    s.description AS stage_description,
    s.default_owner,
    row_number() OVER (
      PARTITION BY p.subject_kind, p.subject_id
      ORDER BY
        CASE WHEN p.status IN ('in_progress','stalled','not_started') THEN 0 ELSE 1 END,
        s.ordinal DESC
    ) AS rn
  FROM public.next_step_progress p
  JOIN public.next_step_stages s ON s.code = p.stage_code
)
SELECT subject_kind, subject_id, stage_code, stage_name, stage_description,
       ordinal, status, default_owner AS owner, started_at, due_at, completed_at
FROM ranked WHERE rn = 1;

CREATE OR REPLACE VIEW public.v_next_step_stalled AS
SELECT p.subject_kind, p.subject_id, p.stage_code, s.name AS stage_name,
       s.ordinal, p.started_at, p.due_at,
       extract(epoch FROM (now() - p.started_at))/86400.0 AS days_in_stage,
       s.stall_threshold_days
FROM public.next_step_progress p
JOIN public.next_step_stages s ON s.code = p.stage_code
WHERE p.status = 'stalled'
ORDER BY p.started_at ASC;

CREATE OR REPLACE VIEW public.v_next_step_funnel AS
SELECT s.code AS stage_code, s.name AS stage_name, s.ordinal,
       count(*) FILTER (WHERE p.status = 'in_progress') AS in_progress,
       count(*) FILTER (WHERE p.status = 'stalled')     AS stalled,
       count(*) FILTER (WHERE p.status = 'done')        AS done,
       count(*) FILTER (WHERE p.status = 'skipped')     AS skipped,
       count(*) AS total
FROM public.next_step_stages s
LEFT JOIN public.next_step_progress p ON p.stage_code = s.code
GROUP BY s.code, s.name, s.ordinal
ORDER BY s.ordinal;

GRANT SELECT ON public.v_next_step_current_stage_per_agent TO authenticated;
GRANT SELECT ON public.v_next_step_stalled TO authenticated;
GRANT SELECT ON public.v_next_step_funnel TO authenticated;


-- ─── 14. pg_cron — fire stall check every 30 min ─────────────────────
DO $$ BEGIN
  PERFORM cron.unschedule('apex-next-step-stall-check');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'apex-next-step-stall-check',
    '*/30 * * * *',
    $cmd$
      WITH s AS (SELECT * FROM public.next_step_stall_check())
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/next-step-dispatch',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('source','cron','stalled',(SELECT coalesce(jsonb_agg(to_jsonb(s.*)),'[]'::jsonb) FROM s)),
        timeout_milliseconds := 25000
      );
    $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron schedule skipped: %', SQLERRM;
END $$;


-- ─── 15. Backfill: seed any existing live application/agent ──────────
INSERT INTO public.next_step_progress (subject_kind, subject_id, stage_code, status, started_at, due_at, owner)
SELECT 'application'::public.next_step_subject_kind, a.id,
       CASE
         WHEN a.status::text = 'approved'    THEN 'hired'
         WHEN a.status::text = 'contracting' THEN 'contracting'
         WHEN a.status::text = 'interview'   THEN 'manager_contact'
         WHEN a.status::text = 'reviewing'   THEN 'application_done'
         WHEN a.status::text = 'no_pickup'   THEN 'application_done'
         WHEN a.status::text = 'new'         THEN 'application_done'
         ELSE 'applied'
       END,
       'in_progress'::public.next_step_status,
       COALESCE(a.created_at, now()),
       COALESCE(a.created_at, now()) + interval '2 days',
       'recruit'
FROM public.applications a
WHERE a.status::text NOT IN ('rejected')
  AND NOT EXISTS (
    SELECT 1 FROM public.next_step_progress p
    WHERE p.subject_kind = 'application' AND p.subject_id = a.id
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.next_step_progress (subject_kind, subject_id, stage_code, status, started_at, due_at, owner)
SELECT 'agent'::public.next_step_subject_kind, ag.id,
       'hired'::text, 'in_progress'::public.next_step_status,
       COALESCE(ag.created_at, now()),
       COALESCE(ag.created_at, now()) + interval '2 days',
       'recruit'
FROM public.agents ag
WHERE NOT EXISTS (
  SELECT 1 FROM public.next_step_progress p
  WHERE p.subject_kind = 'agent' AND p.subject_id = ag.id
)
ON CONFLICT DO NOTHING;

COMMIT;
