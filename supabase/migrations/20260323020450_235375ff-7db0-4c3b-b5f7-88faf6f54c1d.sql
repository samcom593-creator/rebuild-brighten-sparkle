CREATE POLICY "Authenticated users can view agents for leaderboard"
ON public.agents FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view profiles for leaderboard"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);