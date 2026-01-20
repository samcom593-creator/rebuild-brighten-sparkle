-- Fix 1: Remove agent self-update policy to prevent privilege escalation
-- Agents should NOT be able to update their own status, manager_id, verified_at, etc.
DROP POLICY IF EXISTS "Agents can update own record" ON public.agents;

-- Fix 2: The profiles table policies are already properly configured with:
-- - Users can view/update only their own profile
-- - Admins can view all profiles  
-- - Managers can view team profiles
-- No changes needed - the scanner warning was about potential misconfiguration risk, not actual exposure

-- Fix 3: Enhance applications security by ensuring the public INSERT only allows safe initial values
-- Drop existing insert policy and create a more restrictive one
DROP POLICY IF EXISTS "Anyone can submit application with valid data" ON public.applications;

-- Create improved policy that enforces additional constraints
CREATE POLICY "Anyone can submit application with valid data" 
ON public.applications 
FOR INSERT 
WITH CHECK (
  -- Required fields must be present
  first_name IS NOT NULL AND 
  last_name IS NOT NULL AND 
  email IS NOT NULL AND 
  phone IS NOT NULL AND 
  -- Status must be 'new' - prevent submitting pre-approved applications
  status = 'new'::application_status AND
  -- Prevent setting administrative fields on insert
  assigned_agent_id IS NULL AND
  reviewed_at IS NULL AND
  reviewed_by IS NULL AND
  contacted_at IS NULL AND
  qualified_at IS NULL AND
  closed_at IS NULL
);