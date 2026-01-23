-- Add terminated_at and termination_reason columns to applications table
ALTER TABLE public.applications 
ADD COLUMN terminated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN termination_reason TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.applications.terminated_at IS 'Timestamp when lead was marked as terminated/bad lead';
COMMENT ON COLUMN public.applications.termination_reason IS 'Reason for terminating the lead';