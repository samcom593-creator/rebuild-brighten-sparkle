
-- Create error_logs table for self-healing error tracking
CREATE TABLE public.error_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NULL,
  error_message text NOT NULL,
  component_stack text NULL,
  url text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert their own errors
CREATE POLICY "Authenticated users can insert error logs"
  ON public.error_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only admins can read error logs
CREATE POLICY "Admins can read error logs"
  ON public.error_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for admin queries
CREATE INDEX idx_error_logs_created_at ON public.error_logs(created_at DESC);
