-- Add new enums for agent tracking
CREATE TYPE public.attendance_status AS ENUM ('good', 'warning', 'critical');
CREATE TYPE public.performance_tier AS ENUM ('below_10k', 'standard', 'top_producer');

-- Add new columns to agents table
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS attendance_status public.attendance_status DEFAULT 'good',
ADD COLUMN IF NOT EXISTS performance_tier public.performance_tier DEFAULT 'below_10k',
ADD COLUMN IF NOT EXISTS field_training_started_at TIMESTAMP WITH TIME ZONE;

-- Create aged_leads table
CREATE TABLE public.aged_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  about_me TEXT,
  original_date DATE,
  assigned_manager_id UUID REFERENCES public.agents(id),
  status TEXT DEFAULT 'new',
  license_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.aged_leads ENABLE ROW LEVEL SECURITY;

-- RLS policies for aged_leads
CREATE POLICY "Admins can manage all aged leads"
ON public.aged_leads FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view their assigned aged leads"
ON public.aged_leads FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND assigned_manager_id = get_agent_id(auth.uid())
);

CREATE POLICY "Managers can update their assigned aged leads"
ON public.aged_leads FOR UPDATE
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND assigned_manager_id = get_agent_id(auth.uid())
);

-- Enable realtime for aged_leads
ALTER PUBLICATION supabase_realtime ADD TABLE public.aged_leads;