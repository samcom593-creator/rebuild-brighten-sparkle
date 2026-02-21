
-- Create lead_activity table for tracking all interactions with leads
CREATE TABLE public.lead_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  actor_user_id uuid,
  actor_name text,
  actor_role text,
  activity_type text NOT NULL,
  title text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Composite index for fast timeline queries
CREATE INDEX idx_lead_activity_lead_created ON public.lead_activity (lead_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "Admins can manage all lead activity"
ON public.lead_activity
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers: SELECT on leads assigned to them or their team
CREATE POLICY "Managers can view team lead activity"
ON public.lead_activity
FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND lead_id IN (
    SELECT id FROM public.applications
    WHERE assigned_agent_id = get_agent_id(auth.uid())
       OR assigned_agent_id IN (
         SELECT id FROM public.agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
       )
  )
);

-- Managers: INSERT on leads assigned to them or their team
CREATE POLICY "Managers can insert team lead activity"
ON public.lead_activity
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND lead_id IN (
    SELECT id FROM public.applications
    WHERE assigned_agent_id = get_agent_id(auth.uid())
       OR assigned_agent_id IN (
         SELECT id FROM public.agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
       )
  )
);

-- Agents/recruiters: SELECT on their assigned leads
CREATE POLICY "Agents can view their lead activity"
ON public.lead_activity
FOR SELECT
USING (
  lead_id IN (
    SELECT id FROM public.applications
    WHERE assigned_agent_id = get_agent_id(auth.uid())
  )
);

-- Agents/recruiters: INSERT on their assigned leads
CREATE POLICY "Agents can insert their lead activity"
ON public.lead_activity
FOR INSERT
WITH CHECK (
  lead_id IN (
    SELECT id FROM public.applications
    WHERE assigned_agent_id = get_agent_id(auth.uid())
  )
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activity;
