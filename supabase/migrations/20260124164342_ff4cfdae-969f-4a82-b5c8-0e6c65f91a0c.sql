-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Admins can read partial applications" ON partial_applications;

-- Create new policy for admins AND managers to read partial applications
CREATE POLICY "Admins and managers can read partial applications"
ON partial_applications
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'manager'::app_role)
);