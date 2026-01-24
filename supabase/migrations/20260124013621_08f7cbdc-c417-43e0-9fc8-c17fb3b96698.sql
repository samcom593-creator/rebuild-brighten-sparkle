-- Add restrictive policy to deny unauthenticated SELECT access to applications table
-- Note: INSERT must remain public for the job application form
CREATE POLICY "Require authentication for applications read"
ON public.applications
AS RESTRICTIVE
FOR SELECT
TO public
USING (auth.uid() IS NOT NULL);