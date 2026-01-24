-- Allow public (anonymous) read access to lead_counter for landing page display
DROP POLICY IF EXISTS "Authenticated users can view lead counter" ON public.lead_counter;

CREATE POLICY "Anyone can view lead counter"
ON public.lead_counter
FOR SELECT
USING (true);