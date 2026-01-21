-- Create table for manager invite links
CREATE TABLE public.manager_invite_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Add column to agents to track who invited them
ALTER TABLE public.agents ADD COLUMN invited_by_manager_id UUID REFERENCES public.agents(id);

-- Enable RLS
ALTER TABLE public.manager_invite_links ENABLE ROW LEVEL SECURITY;

-- Policies for manager_invite_links
CREATE POLICY "Anyone can view active invite links"
ON public.manager_invite_links
FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage all invite links"
ON public.manager_invite_links
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view their own invite links"
ON public.manager_invite_links
FOR SELECT
USING (manager_agent_id = get_agent_id(auth.uid()));

-- Enable realtime for manager_invite_links
ALTER PUBLICATION supabase_realtime ADD TABLE public.manager_invite_links;