-- Add inactive flag to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_inactive BOOLEAN DEFAULT FALSE;

-- Create removal requests table for email confirmation workflow
CREATE TABLE IF NOT EXISTS agent_removal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
  requested_by UUID NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

-- Enable RLS on removal requests
ALTER TABLE agent_removal_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies for removal requests
CREATE POLICY "Admins can manage all removal requests"
  ON agent_removal_requests FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers can view their team removal requests"
  ON agent_removal_requests FOR SELECT
  USING (has_role(auth.uid(), 'manager') AND requested_by = auth.uid());

CREATE POLICY "Managers can create removal requests for their team"
  ON agent_removal_requests FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'manager'));