-- Add column to track second unlicensed follow-up (7 days after application)
ALTER TABLE public.applications 
ADD COLUMN IF NOT EXISTS followup_unlicensed_2_sent_at TIMESTAMP WITH TIME ZONE;