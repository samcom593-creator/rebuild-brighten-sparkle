
-- Fix INSERT policy: change from RESTRICTIVE to PERMISSIVE
DROP POLICY "Anyone can insert partial applications" ON public.partial_applications;
CREATE POLICY "Anyone can insert partial applications" 
  ON public.partial_applications FOR INSERT 
  TO public
  WITH CHECK (true);

-- Fix UPDATE policy: change from RESTRICTIVE to PERMISSIVE  
DROP POLICY "Anyone can update their own session" ON public.partial_applications;
CREATE POLICY "Anyone can update their own session" 
  ON public.partial_applications FOR UPDATE 
  TO public
  USING (true) WITH CHECK (true);
