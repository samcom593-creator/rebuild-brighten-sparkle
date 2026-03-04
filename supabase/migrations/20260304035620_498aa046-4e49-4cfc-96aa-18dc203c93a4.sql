-- Add new license progress values
ALTER TYPE public.license_progress ADD VALUE IF NOT EXISTS 'waiting_fingerprints';
ALTER TYPE public.license_progress ADD VALUE IF NOT EXISTS 'fingerprints_done';

-- Add help request tracking to applicant_checkins
ALTER TABLE public.applicant_checkins 
  ADD COLUMN IF NOT EXISTS needs_help boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS help_notified_at timestamptz;