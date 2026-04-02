
-- Create award_batches table
CREATE TABLE public.award_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  time_period text NOT NULL,
  metric_type text NOT NULL DEFAULT 'AP',
  period_start date,
  period_end date,
  winner_agent_id uuid REFERENCES public.agents(id),
  winner_name text,
  winner_amount numeric,
  top_agents jsonb,
  top_producer_file text,
  leaderboard_file text,
  status text NOT NULL DEFAULT 'ready_for_review',
  source_data jsonb
);

-- Enable RLS
ALTER TABLE public.award_batches ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins full access on award_batches"
  ON public.award_batches
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Create public storage bucket for award graphics
INSERT INTO storage.buckets (id, name, public)
VALUES ('award-graphics', 'award-graphics', true);

-- Public read access for award graphics
CREATE POLICY "Award graphics are publicly accessible"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'award-graphics');

-- Admins can upload award graphics
CREATE POLICY "Admins can upload award graphics"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'award-graphics' AND public.has_role(auth.uid(), 'admin'));

-- Admins can delete award graphics
CREATE POLICY "Admins can delete award graphics"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'award-graphics' AND public.has_role(auth.uid(), 'admin'));
