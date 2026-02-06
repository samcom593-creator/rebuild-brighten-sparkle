-- Add last_contacted_at column to both aged_leads and applications tables
-- This allows tracking of the most recent contact separately from first contact

ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;