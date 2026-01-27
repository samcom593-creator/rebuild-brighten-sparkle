-- Create plaque_awards table for duplicate prevention
CREATE TABLE public.plaque_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL,
  milestone_date DATE NOT NULL,
  amount NUMERIC,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, milestone_type, milestone_date)
);

-- Enable RLS
ALTER TABLE public.plaque_awards ENABLE ROW LEVEL SECURITY;

-- Admins can manage all plaque awards
CREATE POLICY "Admins can manage all plaque awards"
ON public.plaque_awards
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Agents can view their own awards
CREATE POLICY "Agents can view their own awards"
ON public.plaque_awards
FOR SELECT
USING (agent_id = current_agent_id());

-- Managers can view their team awards
CREATE POLICY "Managers can view team awards"
ON public.plaque_awards
FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);

-- Add index for faster lookups
CREATE INDEX idx_plaque_awards_agent_date ON public.plaque_awards(agent_id, milestone_date);
CREATE INDEX idx_plaque_awards_type_date ON public.plaque_awards(milestone_type, milestone_date);