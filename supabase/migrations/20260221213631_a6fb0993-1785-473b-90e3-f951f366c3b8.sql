
-- Add lead scoring and follow-up columns to applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS lead_score integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_type text;
