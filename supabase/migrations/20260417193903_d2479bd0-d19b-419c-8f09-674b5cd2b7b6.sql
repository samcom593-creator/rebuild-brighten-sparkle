-- User dashboard preferences for hide-card flags
CREATE TABLE IF NOT EXISTS public.user_dashboard_prefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_cards TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_dashboard_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own dashboard prefs"
  ON public.user_dashboard_prefs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dashboard prefs"
  ON public.user_dashboard_prefs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dashboard prefs"
  ON public.user_dashboard_prefs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dashboard prefs"
  ON public.user_dashboard_prefs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_dashboard_prefs_updated_at
  BEFORE UPDATE ON public.user_dashboard_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_user_dashboard_prefs_user_id
  ON public.user_dashboard_prefs(user_id);