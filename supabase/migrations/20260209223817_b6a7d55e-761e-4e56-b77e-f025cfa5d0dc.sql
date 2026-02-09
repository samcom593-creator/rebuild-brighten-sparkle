
-- Create a security definer function that returns only safe leaderboard columns
CREATE OR REPLACE FUNCTION public.get_leaderboard_profiles()
RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id IS NOT NULL;
$$;

-- Drop the overly broad leaderboard SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view profile names for leaderboards" ON public.profiles;
