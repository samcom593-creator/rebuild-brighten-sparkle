-- Fix Leaderboard Visibility: Allow managers to see each other's data

-- 1. Allow Managers to View Manager User Roles
CREATE POLICY "Managers can view manager roles"
ON public.user_roles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND role = 'manager'
);

-- 2. Allow Managers to View Other Manager Agent Records
CREATE POLICY "Managers can view other manager agents"
ON public.agents FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id IN (
    SELECT ur.user_id 
    FROM public.user_roles ur 
    WHERE ur.role = 'manager'
  )
);

-- 3. Broader profile visibility for managers (leaderboards need agent names)
-- Drop the existing narrow policy first, then add broader one
DROP POLICY IF EXISTS "Managers can view manager profiles for leaderboard" ON public.profiles;

CREATE POLICY "Managers can view all profiles for leaderboards"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
);