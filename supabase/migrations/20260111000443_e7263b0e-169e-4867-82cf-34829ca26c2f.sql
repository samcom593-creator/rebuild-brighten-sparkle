-- Add new columns to applications table for recruiting tracking
ALTER TABLE public.applications 
ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS instagram_handle text,
ADD COLUMN IF NOT EXISTS contacted_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS qualified_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS started_training boolean DEFAULT false;

-- Create index for faster lookups by assigned agent
CREATE INDEX IF NOT EXISTS idx_applications_assigned_agent ON public.applications(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON public.applications(created_at);

-- Create agent_lead_stats table for historical tracking
CREATE TABLE IF NOT EXISTS public.agent_lead_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  period_date date NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  total_leads integer DEFAULT 0,
  contacted integer DEFAULT 0,
  qualified integer DEFAULT 0,
  closed integer DEFAULT 0,
  licensed_count integer DEFAULT 0,
  unlicensed_count integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(agent_id, period_date, period_type)
);

-- Enable RLS on agent_lead_stats
ALTER TABLE public.agent_lead_stats ENABLE ROW LEVEL SECURITY;

-- Agents can view their own stats
CREATE POLICY "Agents can view their own stats"
ON public.agent_lead_stats
FOR SELECT
USING (
  agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
);

-- Admins and managers can view all stats
CREATE POLICY "Admins can view all stats"
ON public.agent_lead_stats
FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')
);

-- System can insert/update stats (for automated tracking)
CREATE POLICY "System can manage stats"
ON public.agent_lead_stats
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Add RLS policy for applications - agents can view applications assigned to them
CREATE POLICY "Agents can view their assigned applications"
ON public.applications
FOR SELECT
USING (
  assigned_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
);

-- Agents can update their assigned applications (mark as contacted, qualified, closed)
CREATE POLICY "Agents can update their assigned applications"
ON public.applications
FOR UPDATE
USING (
  assigned_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
)
WITH CHECK (
  assigned_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
);