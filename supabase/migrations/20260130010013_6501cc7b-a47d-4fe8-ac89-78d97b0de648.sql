-- Create contracting_links table for saving custom onboarding links
CREATE TABLE IF NOT EXISTS public.contracting_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.contracting_links ENABLE ROW LEVEL SECURITY;

-- Admins can manage all links
CREATE POLICY "Admins can manage all contracting links"
ON public.contracting_links
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers can manage their own links
CREATE POLICY "Managers can manage own contracting links"
ON public.contracting_links
FOR ALL
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND manager_id = current_agent_id()
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role) 
  AND manager_id = current_agent_id()
);