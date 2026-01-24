-- Fix lead_counter_public_exposure: Restrict lead counter to authenticated users only
-- Drop the public policy
DROP POLICY IF EXISTS "Anyone can view lead counter" ON public.lead_counter;

-- Create a new policy that requires authentication
CREATE POLICY "Authenticated users can view lead counter"
ON public.lead_counter
FOR SELECT
TO public
USING (auth.uid() IS NOT NULL);

-- Note: The applications and profiles tables already have proper RESTRICTIVE policies
-- that require authentication. The existing policies properly enforce role-based access.