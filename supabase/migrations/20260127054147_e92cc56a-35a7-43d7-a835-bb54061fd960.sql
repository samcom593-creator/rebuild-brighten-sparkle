-- Allow all authenticated users to view daily_production for leaderboard visibility
CREATE POLICY "Authenticated agents can view all production for leaderboard"
ON public.daily_production
FOR SELECT
USING (auth.uid() IS NOT NULL);