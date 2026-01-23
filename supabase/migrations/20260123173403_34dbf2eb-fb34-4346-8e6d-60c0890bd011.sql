-- Allow authenticated users to view their own application by matching email
CREATE POLICY "Applicants can view own application by email"
ON public.applications
FOR SELECT
USING (email = (auth.jwt() ->> 'email'));