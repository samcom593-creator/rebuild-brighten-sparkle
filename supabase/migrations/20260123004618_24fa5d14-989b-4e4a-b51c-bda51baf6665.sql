-- Add explicit denial of public/anonymous access to applications table
-- This ensures only authenticated users can access the table at all
CREATE POLICY "Deny public access to applications"
ON public.applications FOR ALL
TO public
USING (auth.uid() IS NOT NULL);