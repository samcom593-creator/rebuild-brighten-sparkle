-- Create email tracking table
CREATE TABLE public.email_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  recipient_email text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  opened_at timestamp with time zone,
  open_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_tracking ENABLE ROW LEVEL SECURITY;

-- Admins can manage all tracking
CREATE POLICY "Admins can manage all email tracking"
ON public.email_tracking
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers can view their team's email tracking
CREATE POLICY "Managers can view team email tracking"
ON public.email_tracking
FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);

-- Create index for fast lookups
CREATE INDEX idx_email_tracking_agent_id ON public.email_tracking(agent_id);
CREATE INDEX idx_email_tracking_email_type ON public.email_tracking(email_type);