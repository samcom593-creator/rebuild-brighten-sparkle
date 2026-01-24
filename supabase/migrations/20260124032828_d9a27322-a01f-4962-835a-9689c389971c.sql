-- Drop the overly broad authentication-only policies that could allow exposure
-- These policies only check if user is authenticated, not if they have actual access rights

-- Drop the broad profiles access policy
DROP POLICY IF EXISTS "Require authentication for profiles access" ON public.profiles;

-- Drop the broad applications read policy  
DROP POLICY IF EXISTS "Require authentication for applications read" ON public.applications;

-- The remaining RESTRICTIVE policies properly enforce:
-- profiles: admins view all, managers view team, users view own, agents view manager
-- applications: admins manage all, agents view/update assigned, managers view/update team, applicants view by email