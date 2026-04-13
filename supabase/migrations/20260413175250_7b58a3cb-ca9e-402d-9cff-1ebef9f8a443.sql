-- Add production access columns to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS has_production_access BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS production_unlocked_at TIMESTAMPTZ;

-- Create scheduled_tasks table for automated follow-ups
CREATE TABLE IF NOT EXISTS public.scheduled_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_type TEXT NOT NULL,
  agent_id UUID NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can manage all scheduled tasks"
ON public.scheduled_tasks FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers can view team tasks
CREATE POLICY "Managers can view team scheduled tasks"
ON public.scheduled_tasks FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) AND
  agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);

-- Agents can view own tasks
CREATE POLICY "Agents can view own scheduled tasks"
ON public.scheduled_tasks FOR SELECT
USING (agent_id = current_agent_id());

-- Index for scheduled task processing
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_pending 
ON public.scheduled_tasks (status, scheduled_for) 
WHERE status = 'pending';