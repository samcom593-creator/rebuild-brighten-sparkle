
-- Agent Tasks table
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  assigned_by UUID,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending',
  task_type TEXT DEFAULT 'general',
  completed_at TIMESTAMPTZ,
  agent_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON public.agent_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON public.agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_due ON public.agent_tasks(due_date);

-- Plaque Awards table (for award detection)
CREATE TABLE IF NOT EXISTS public.plaque_awards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  milestone_type TEXT NOT NULL,
  milestone_date DATE,
  amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plaque_awards_agent ON public.plaque_awards(agent_id);
CREATE INDEX IF NOT EXISTS idx_plaque_awards_type ON public.plaque_awards(milestone_type);

-- Enable realtime for plaque_awards
ALTER PUBLICATION supabase_realtime ADD TABLE public.plaque_awards;

-- RLS for agent_tasks
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all tasks" ON public.agent_tasks FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage team tasks" ON public.agent_tasks FOR ALL TO public
  USING (has_role(auth.uid(), 'manager'::app_role) AND (agent_id IN (SELECT agents.id FROM agents WHERE agents.invited_by_manager_id = current_agent_id())))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role) AND (agent_id IN (SELECT agents.id FROM agents WHERE agents.invited_by_manager_id = current_agent_id())));

CREATE POLICY "Agents can view own tasks" ON public.agent_tasks FOR SELECT TO public USING (agent_id = current_agent_id());

CREATE POLICY "Agents can update own tasks" ON public.agent_tasks FOR UPDATE TO public USING (agent_id = current_agent_id()) WITH CHECK (agent_id = current_agent_id());

-- RLS for plaque_awards
ALTER TABLE public.plaque_awards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all awards" ON public.plaque_awards FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view awards" ON public.plaque_awards FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers can insert awards" ON public.plaque_awards FOR INSERT TO public WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
