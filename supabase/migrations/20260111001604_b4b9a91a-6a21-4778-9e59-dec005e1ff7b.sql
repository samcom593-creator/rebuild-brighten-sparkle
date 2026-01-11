-- Add verified_at and verified_by columns to agents table for admin approval workflow
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id);

-- Create index for faster pending agent lookups
CREATE INDEX IF NOT EXISTS idx_agents_status ON public.agents(status);

-- Create index for verified_by lookups
CREATE INDEX IF NOT EXISTS idx_agents_verified_by ON public.agents(verified_by);