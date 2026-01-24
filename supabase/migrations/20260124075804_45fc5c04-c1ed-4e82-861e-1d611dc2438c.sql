-- Phase 1: CRM Enhancement Schema Updates

-- 1.1 Create agent_ratings table for multi-manager star ratings
CREATE TABLE public.agent_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  rated_by UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(agent_id, rated_by)
);

-- Enable RLS on agent_ratings
ALTER TABLE public.agent_ratings ENABLE ROW LEVEL SECURITY;

-- RLS policies for agent_ratings
CREATE POLICY "Admins can manage all ratings"
ON public.agent_ratings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view ratings for their team"
ON public.agent_ratings FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) AND
  agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);

CREATE POLICY "Managers can rate their team agents"
ON public.agent_ratings FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role) AND
  agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);

CREATE POLICY "Managers can update their own ratings"
ON public.agent_ratings FOR UPDATE
USING (
  has_role(auth.uid(), 'manager'::app_role) AND
  rated_by = auth.uid()
);

-- 1.2 Add weekly_10k_badges column to agents table (simpler than separate table)
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS weekly_10k_badges INTEGER DEFAULT 0;

-- 1.3 Add deactivation tracking columns
CREATE TYPE deactivation_reason AS ENUM ('bad_business', 'inactive', 'switched_teams');

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS deactivation_reason deactivation_reason;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS switched_to_manager_id UUID REFERENCES public.agents(id);

-- 1.4 Add dialer_activity to attendance_type enum
ALTER TYPE attendance_type ADD VALUE IF NOT EXISTS 'dialer_activity';

-- Trigger to update updated_at on agent_ratings
CREATE TRIGGER update_agent_ratings_updated_at
BEFORE UPDATE ON public.agent_ratings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();