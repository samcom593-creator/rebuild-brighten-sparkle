
-- Create system_settings table
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins can manage system settings"
  ON public.system_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Authenticated users can read settings (needed for earnings calc)
CREATE POLICY "Authenticated users can read system settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (true);

-- Insert default values
INSERT INTO public.system_settings (key, value) VALUES
  ('sam_override_rate', '0.03'),
  ('discord_webhook_url', '')
ON CONFLICT (key) DO NOTHING;
