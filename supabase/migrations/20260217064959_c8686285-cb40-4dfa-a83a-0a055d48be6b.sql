
-- Create health_check_log table
CREATE TABLE public.health_check_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  check_name text NOT NULL,
  status text NOT NULL,
  error_message text,
  response_time_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.health_check_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read
CREATE POLICY "Admins can read health check logs"
  ON public.health_check_log FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for cleanup queries
CREATE INDEX idx_health_check_log_created_at ON public.health_check_log (created_at);
CREATE INDEX idx_health_check_log_status ON public.health_check_log (status);
