-- 20260615033223_manual_interview_entries.sql
--
-- Manual interview entries — Sam directive (voice transcript 2026-06-15):
-- "Make sure again I wanna re-click and add these [interviews], and then I
-- send them [the candidate] a link to show I'm actually going there as well."
--
-- The InterviewCommandCenter page currently only renders interviews from a
-- hardcoded INTERVIEW_EVENTS array (pasted Calendly data). Sam wants to add
-- new interviews directly in the UI without re-pasting + send a
-- confirmation email to the candidate with the Calendly link.
--
-- This migration adds:
--   1. manual_interview_entries — durable per-interview row written from the
--      "+ Add Interview" modal in InterviewCommandCenter.tsx.
--   2. confirmation_sent_at column — populated by send-candidate-confirmation
--      edge fn once Resend returns a valid data.id (no fake success).
--   3. RLS: admin + manager can SELECT/INSERT, only the creator (or admin)
--      can UPDATE/DELETE.

CREATE TABLE IF NOT EXISTS public.manual_interview_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_name text NOT NULL,
  phone text NULL,
  email text NULL,
  instagram_handle text NULL,
  scheduled_at timestamptz NOT NULL,
  interview_type text NOT NULL DEFAULT 'general',
  notes text NULL,
  confirmation_sent_at timestamptz NULL,
  resend_message_id text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_interview_entries_type_chk CHECK (
    interview_type IN (
      'licensed_prospect',
      'licensed_call',
      'leader_call',
      'unlicensed_lead',
      'final_expense_review',
      'callback',
      'general'
    )
  )
);

COMMENT ON TABLE public.manual_interview_entries IS
  'Interviews added directly in the InterviewCommandCenter UI (not from pasted Calendly data). One row per scheduled candidate call. confirmation_sent_at is populated by send-candidate-confirmation edge fn after Resend returns data.id.';

CREATE INDEX IF NOT EXISTS manual_interview_entries_scheduled_at_idx
  ON public.manual_interview_entries (scheduled_at DESC);

CREATE INDEX IF NOT EXISTS manual_interview_entries_created_by_idx
  ON public.manual_interview_entries (created_by);

-- updated_at auto-refresh
CREATE OR REPLACE FUNCTION public.fn_touch_manual_interview_entries_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_interview_entries_touch_updated_at
  ON public.manual_interview_entries;

CREATE TRIGGER trg_manual_interview_entries_touch_updated_at
  BEFORE UPDATE ON public.manual_interview_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_manual_interview_entries_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.manual_interview_entries ENABLE ROW LEVEL SECURITY;

-- Admin + manager can SELECT all
DROP POLICY IF EXISTS manual_interview_entries_select
  ON public.manual_interview_entries;
CREATE POLICY manual_interview_entries_select
  ON public.manual_interview_entries
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Admin + manager can INSERT, created_by defaults to auth.uid() at app layer
DROP POLICY IF EXISTS manual_interview_entries_insert
  ON public.manual_interview_entries;
CREATE POLICY manual_interview_entries_insert
  ON public.manual_interview_entries
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Admin can UPDATE any; manager can UPDATE only their own rows
DROP POLICY IF EXISTS manual_interview_entries_update
  ON public.manual_interview_entries;
CREATE POLICY manual_interview_entries_update
  ON public.manual_interview_entries
  FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'manager'::public.app_role)
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'manager'::public.app_role)
      AND created_by = auth.uid()
    )
  );

-- Admin only DELETE
DROP POLICY IF EXISTS manual_interview_entries_delete
  ON public.manual_interview_entries;
CREATE POLICY manual_interview_entries_delete
  ON public.manual_interview_entries
  FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Service role bypass for the edge fn writing confirmation_sent_at
-- (service_role is implicit BYPASS RLS — no policy needed; documented here).

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.manual_interview_entries
  TO authenticated;
