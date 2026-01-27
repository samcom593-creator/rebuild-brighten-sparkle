-- Add password preference to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS password_required boolean DEFAULT false;

-- Index for faster manager lookups (improves leaderboard and team queries)
CREATE INDEX IF NOT EXISTS idx_agents_invited_by_manager_active 
ON agents(invited_by_manager_id) WHERE is_deactivated = false;