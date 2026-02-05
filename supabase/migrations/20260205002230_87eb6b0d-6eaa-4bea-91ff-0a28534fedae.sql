-- Add new columns to aged_leads for Instagram and motivation/notes
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS instagram_handle text;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS motivation text;

-- Add indexes for faster filtering by license status and manager assignment
CREATE INDEX IF NOT EXISTS idx_aged_leads_license_status ON aged_leads(license_status);
CREATE INDEX IF NOT EXISTS idx_aged_leads_manager_status ON aged_leads(assigned_manager_id, status);
CREATE INDEX IF NOT EXISTS idx_aged_leads_status ON aged_leads(status);