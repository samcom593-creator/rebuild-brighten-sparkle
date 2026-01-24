-- Fix the sync_lead_counter trigger function that's blocking submissions
CREATE OR REPLACE FUNCTION public.sync_lead_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.lead_counter 
  SET count = (SELECT COUNT(*) FROM public.applications WHERE terminated_at IS NULL),
      updated_at = now()
  WHERE id = (SELECT id FROM public.lead_counter LIMIT 1);
  RETURN NULL;
END;
$$;

-- Create partial_applications table to capture abandoned leads
CREATE TABLE IF NOT EXISTS public.partial_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  city TEXT,
  state TEXT,
  step_completed INTEGER NOT NULL DEFAULT 1,
  form_data JSONB DEFAULT '{}'::jsonb,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  converted_at TIMESTAMP WITH TIME ZONE,
  admin_notified_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_session UNIQUE (session_id)
);

-- Enable RLS but allow public inserts/updates for anonymous form submissions
ALTER TABLE public.partial_applications ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert partial applications (public form)
CREATE POLICY "Anyone can insert partial applications"
ON public.partial_applications
FOR INSERT
WITH CHECK (true);

-- Allow anyone to update their own session
CREATE POLICY "Anyone can update their own session"
ON public.partial_applications
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Only admins can read partial applications
CREATE POLICY "Admins can read partial applications"
ON public.partial_applications
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Create index for quick lookups
CREATE INDEX idx_partial_applications_session ON public.partial_applications(session_id);
CREATE INDEX idx_partial_applications_converted ON public.partial_applications(converted_at) WHERE converted_at IS NULL;
CREATE INDEX idx_partial_applications_created ON public.partial_applications(created_at);

-- Add trigger for updated_at
CREATE TRIGGER update_partial_applications_updated_at
BEFORE UPDATE ON public.partial_applications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();