-- Allow managers to view other managers' profiles for leaderboard
CREATE POLICY "Managers can view manager profiles for leaderboard"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = profiles.user_id
    AND user_roles.role = 'manager'
  )
);