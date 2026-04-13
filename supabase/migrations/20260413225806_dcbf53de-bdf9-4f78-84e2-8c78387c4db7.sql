
-- Health check logs
CREATE TABLE IF NOT EXISTS public.system_health_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  checked_at TIMESTAMPTZ DEFAULT now(),
  overall_status TEXT DEFAULT 'healthy',
  critical_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  auto_fixed TEXT[] DEFAULT '{}',
  results JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_health_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage health logs"
ON public.system_health_logs FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_health_logs_date ON public.system_health_logs(checked_at DESC);

-- Automation run tracking
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_name TEXT NOT NULL,
  ran_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'success',
  agents_affected INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage automation runs"
ON public.automation_runs FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_automation_runs_name ON public.automation_runs(automation_name, ran_at DESC);

-- Enable realtime for health monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_health_logs;
