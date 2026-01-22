-- Fix 1: Add restrictive base policy for profiles table to deny public/anonymous access
-- This ensures only authenticated users can ever access the profiles table
CREATE POLICY "Deny public access to profiles"
ON public.profiles
AS RESTRICTIVE
FOR ALL
TO public
USING (auth.uid() IS NOT NULL);

-- Fix 2: Add restrictive base policy for agents table to deny public/anonymous access
-- This ensures only authenticated users can ever access the agents table
CREATE POLICY "Deny public access to agents"
ON public.agents
AS RESTRICTIVE
FOR ALL
TO public
USING (auth.uid() IS NOT NULL);