-- Add contracted_at column to applications table
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS contracted_at TIMESTAMP WITH TIME ZONE;

-- Add crm_setup_link column to agents table for manager's saved CRM setup link preference
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS crm_setup_link TEXT;