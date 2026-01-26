-- Create agent_goals table for income goal tracking
CREATE TABLE public.agent_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,
  income_goal NUMERIC NOT NULL,
  comp_percentage NUMERIC DEFAULT 75,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, month_year)
);

-- Enable Row Level Security
ALTER TABLE public.agent_goals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Agents can manage own goals"
ON public.agent_goals FOR ALL
USING (agent_id = current_agent_id())
WITH CHECK (agent_id = current_agent_id());

CREATE POLICY "Admins can view all goals"
ON public.agent_goals FOR SELECT
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers can view team goals"
ON public.agent_goals FOR SELECT
USING (has_role(auth.uid(), 'manager') AND agent_id IN (
  SELECT id FROM public.agents WHERE invited_by_manager_id = current_agent_id()
));

-- Trigger for updated_at
CREATE TRIGGER update_agent_goals_updated_at
BEFORE UPDATE ON public.agent_goals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();