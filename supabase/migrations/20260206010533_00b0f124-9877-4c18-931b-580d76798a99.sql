-- Create table for deleted/vaulted leads
CREATE TABLE public.deleted_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id UUID NOT NULL,
  source TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  state TEXT,
  license_status TEXT,
  assigned_agent_id UUID,
  original_data JSONB,
  deleted_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT
);

-- Enable RLS
ALTER TABLE public.deleted_leads ENABLE ROW LEVEL SECURITY;

-- Only admins can access deleted leads
CREATE POLICY "Admins can manage deleted leads"
  ON public.deleted_leads FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));