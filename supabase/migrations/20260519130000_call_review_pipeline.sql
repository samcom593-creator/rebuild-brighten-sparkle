-- Call-review pipeline scaffolding (2026-05-19)
-- Sam: "we'll get to the next portion of things where we start to have you
-- look through the calls, highlight winners."
--
-- When ReadyMode webhook (apex-supabase-ingest, installed 13:00 UTC) starts
-- pumping CDRs into readymode_dialer_calls, the call-coaching pipeline picks
-- up the rows from there: download recording → transcribe (Whisper) → score
-- (Claude/Codex) → surface winners on /dashboard/call-coaching.
--
-- This migration ships the storage layer + RLS. The transcribe + score edge
-- functions land in a separate commit when the first CDR arrives.

BEGIN;

CREATE TABLE IF NOT EXISTS public.call_recordings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cdr_id             text UNIQUE,
  agent_id           uuid REFERENCES public.agents(id),
  lead_phone         text,
  call_started_at    timestamptz NOT NULL,
  call_ended_at      timestamptz,
  duration_sec       integer,
  recording_url      text,
  recording_status   text DEFAULT 'pending'
                     CHECK (recording_status IN ('pending','downloaded','failed')),
  transcript_status  text DEFAULT 'pending'
                     CHECK (transcript_status IN ('pending','done','failed')),
  transcript_text    text,
  transcript_lang    text,
  raw_cdr            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_recordings_agent_idx
  ON public.call_recordings(agent_id, call_started_at DESC);
CREATE INDEX IF NOT EXISTS call_recordings_xstatus_idx
  ON public.call_recordings(transcript_status) WHERE transcript_status = 'pending';

CREATE TABLE IF NOT EXISTS public.call_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_recording_id   uuid NOT NULL REFERENCES public.call_recordings(id) ON DELETE CASCADE,
  scored_at           timestamptz NOT NULL DEFAULT now(),
  scorer              text NOT NULL,
  outcome             text NOT NULL
                      CHECK (outcome IN ('winner','promising','average','concerning','lost')),
  win_score           int CHECK (win_score BETWEEN 0 AND 100),
  rapport_score       int CHECK (rapport_score BETWEEN 0 AND 10),
  discovery_score     int CHECK (discovery_score BETWEEN 0 AND 10),
  closing_score       int CHECK (closing_score BETWEEN 0 AND 10),
  objection_handling  int CHECK (objection_handling BETWEEN 0 AND 10),
  follow_through      int CHECK (follow_through BETWEEN 0 AND 10),
  winning_lines       text[],
  coachable_lines     text[],
  next_action         text,
  reasoning           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_scores_recording_idx ON public.call_scores(call_recording_id, scored_at DESC);
CREATE INDEX IF NOT EXISTS call_scores_outcome_idx   ON public.call_scores(outcome, win_score DESC);

GRANT SELECT ON public.call_recordings, public.call_scores TO anon, authenticated;

ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_scores      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_recordings_admin_mgr_read" ON public.call_recordings;
CREATE POLICY "call_recordings_admin_mgr_read" ON public.call_recordings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "call_scores_admin_mgr_read" ON public.call_scores;
CREATE POLICY "call_scores_admin_mgr_read" ON public.call_scores
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR call_recording_id IN (
           SELECT id FROM public.call_recordings WHERE agent_id IN
             (SELECT id FROM public.agents WHERE user_id = auth.uid())
         ));

CREATE OR REPLACE VIEW public.v_call_winners AS
SELECT
  cs.id AS score_id,
  cs.call_recording_id,
  cr.agent_id,
  ag.display_name AS agent_name,
  cr.call_started_at,
  cr.duration_sec,
  cs.outcome,
  cs.win_score,
  cs.rapport_score, cs.discovery_score, cs.closing_score,
  cs.objection_handling, cs.follow_through,
  cs.winning_lines,
  cs.coachable_lines,
  cs.next_action,
  cs.scorer,
  cs.scored_at
FROM public.call_scores cs
JOIN public.call_recordings cr ON cr.id = cs.call_recording_id
LEFT JOIN public.agents ag ON ag.id = cr.agent_id
WHERE cs.outcome IN ('winner','promising');

GRANT SELECT ON public.v_call_winners TO anon, authenticated, service_role;

COMMIT;
