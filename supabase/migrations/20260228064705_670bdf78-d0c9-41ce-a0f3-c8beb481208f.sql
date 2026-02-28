
-- Table 1: Elite Circle Waitlist
CREATE TABLE public.elite_circle_waitlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  motivation TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.elite_circle_waitlist ENABLE ROW LEVEL SECURITY;

-- Public INSERT (anonymous users can sign up)
CREATE POLICY "Anyone can submit to waitlist"
  ON public.elite_circle_waitlist
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admin-only SELECT
CREATE POLICY "Admins can view waitlist"
  ON public.elite_circle_waitlist
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Table 2: Manager Growth Stats
CREATE TABLE public.manager_growth_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  applications_submitted INTEGER NOT NULL DEFAULT 0,
  instagram_views INTEGER NOT NULL DEFAULT 0,
  followers_gained INTEGER NOT NULL DEFAULT 0,
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(agent_id, stat_date)
);

ALTER TABLE public.manager_growth_stats ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all growth stats"
  ON public.manager_growth_stats
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers can insert their own rows
CREATE POLICY "Managers can insert own growth stats"
  ON public.manager_growth_stats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role) 
    AND agent_id = current_agent_id()
  );

-- Managers can update their own rows
CREATE POLICY "Managers can update own growth stats"
  ON public.manager_growth_stats
  FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'manager'::app_role) 
    AND agent_id = current_agent_id()
  );

-- Authenticated users can view all growth stats (for leaderboard)
CREATE POLICY "Authenticated users can view growth stats"
  ON public.manager_growth_stats
  FOR SELECT
  TO authenticated
  USING (true);
