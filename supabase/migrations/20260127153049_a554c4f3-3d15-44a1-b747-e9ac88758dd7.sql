-- Add display_name column to agents for imported agents without profiles
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add RLS policy for authenticated users to view profile names for leaderboards
CREATE POLICY "Authenticated users can view profile names for leaderboards"
ON public.profiles FOR SELECT
USING (auth.uid() IS NOT NULL);