-- Drop the overly permissive "Deny public access" policy that allows any authenticated user to access all profiles
DROP POLICY IF EXISTS "Deny public access to profiles" ON public.profiles;

-- The remaining policies are properly restrictive:
-- "Users can view own profile" - USING (auth.uid() = user_id)
-- "Admins can view all profiles" - USING (has_role(auth.uid(), 'admin'::app_role))
-- "Managers can view their team profiles" - team-scoped access
-- "Users can update own profile" - USING (auth.uid() = user_id)
-- "Users can insert own profile" - WITH CHECK (auth.uid() = user_id)