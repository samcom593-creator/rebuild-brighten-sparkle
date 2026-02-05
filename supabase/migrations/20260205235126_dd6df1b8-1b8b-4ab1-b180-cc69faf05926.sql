-- Add contacted_at column to aged_leads for tracking contact dates and 2-week countdown
ALTER TABLE aged_leads
ADD COLUMN IF NOT EXISTS contacted_at timestamp with time zone;