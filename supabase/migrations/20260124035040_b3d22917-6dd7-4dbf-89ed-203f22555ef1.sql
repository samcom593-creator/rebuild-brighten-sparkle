-- Add column to track manual follow-up emails sent by agents
ALTER TABLE public.applications 
ADD COLUMN IF NOT EXISTS manual_followup_sent_at timestamp with time zone DEFAULT NULL;