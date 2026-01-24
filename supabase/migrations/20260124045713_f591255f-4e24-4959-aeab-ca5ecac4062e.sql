-- Create contact history table for tracking all lead interactions
CREATE TABLE public.contact_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id),
  contact_type TEXT NOT NULL CHECK (contact_type IN ('call', 'email', 'note', 'followup', 'cold_outreach')),
  email_template TEXT,
  subject TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_history ENABLE ROW LEVEL SECURITY;

-- Agents can view contact history for their assigned leads
CREATE POLICY "Agents can view their lead contact history"
ON public.contact_history FOR SELECT
USING (
  application_id IN (
    SELECT id FROM public.applications 
    WHERE assigned_agent_id = current_agent_id()
  )
);

-- Agents can add contact history for their leads
CREATE POLICY "Agents can add contact history"
ON public.contact_history FOR INSERT
WITH CHECK (
  agent_id = current_agent_id()
);

-- Managers can view their team's contact history
CREATE POLICY "Managers can view team contact history"
ON public.contact_history FOR SELECT
USING (
  has_role(auth.uid(), 'manager') AND (
    application_id IN (
      SELECT id FROM public.applications 
      WHERE assigned_agent_id = current_agent_id()
        OR assigned_agent_id IN (
          SELECT id FROM public.agents WHERE invited_by_manager_id = current_agent_id()
        )
    )
  )
);

-- Admins can manage all contact history
CREATE POLICY "Admins can manage all contact history"
ON public.contact_history FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- Add index for performance
CREATE INDEX idx_contact_history_application ON public.contact_history(application_id);
CREATE INDEX idx_contact_history_created ON public.contact_history(created_at DESC);