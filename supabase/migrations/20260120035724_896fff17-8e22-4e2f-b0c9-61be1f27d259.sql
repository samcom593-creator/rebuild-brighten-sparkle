-- Fix: Remove policy that tries to access auth.users table
-- Anonymous users submitting applications cannot query auth.users
DROP POLICY IF EXISTS "Applicants can view own application" ON public.applications;

-- Create a simpler policy - applicants don't need to view their own application
-- They get redirected to success page after submission
-- If needed in future, we can add this back with proper session handling