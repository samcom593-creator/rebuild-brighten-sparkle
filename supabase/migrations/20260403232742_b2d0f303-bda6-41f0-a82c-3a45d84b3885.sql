
-- Add missing columns to notification_log
ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS notification_type TEXT;
ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id);

CREATE INDEX IF NOT EXISTS idx_notif_log_agent ON public.notification_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_type ON public.notification_log(notification_type);
CREATE INDEX IF NOT EXISTS idx_notif_log_created ON public.notification_log(created_at DESC);

-- Lead purchase requests
CREATE TABLE IF NOT EXISTS public.lead_purchase_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES public.agents(id) NOT NULL,
  package_type TEXT NOT NULL,
  amount_paid NUMERIC,
  payment_method TEXT,
  transaction_id TEXT,
  status TEXT DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,
  notes TEXT
);

ALTER TABLE public.lead_purchase_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage all purchase requests' AND tablename = 'lead_purchase_requests') THEN
    CREATE POLICY "Admins can manage all purchase requests" ON public.lead_purchase_requests FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Agents can view own purchase requests' AND tablename = 'lead_purchase_requests') THEN
    CREATE POLICY "Agents can view own purchase requests" ON public.lead_purchase_requests FOR SELECT USING (agent_id = current_agent_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Agents can create own purchase requests' AND tablename = 'lead_purchase_requests') THEN
    CREATE POLICY "Agents can create own purchase requests" ON public.lead_purchase_requests FOR INSERT WITH CHECK (agent_id = current_agent_id());
  END IF;
END $$;

-- Automation settings
CREATE TABLE IF NOT EXISTS public.automation_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  schedule TEXT,
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_affected_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage automation settings' AND tablename = 'automation_settings') THEN
    CREATE POLICY "Admins can manage automation settings" ON public.automation_settings FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

INSERT INTO public.automation_settings (name, description, schedule, enabled) VALUES
  ('Daily Churn Check', 'Email risk list to admin every morning', '7:00 AM CST Daily', true),
  ('Weekly Coaching', 'Email each agent personalized targets', '6:00 AM CST Monday', true),
  ('Licensing Sequence', 'Drip emails for unlicensed recruits', '8:00 AM CST Daily', true),
  ('Streak Milestones', 'Send plaque recognition for streaks', '11:00 PM CST Daily', true),
  ('Weekly Milestones', 'Diamond week awards', '11:00 PM CST Saturday', true),
  ('Monthly Milestones', 'Elite producer awards', '6:00 AM CST 1st of month', true),
  ('Daily Spotlight', 'Email top producer to entire team', '7:30 AM CST Daily', true),
  ('No Deal Today', 'Nudge agents with no deals today', '8:00 PM CST Daily', true),
  ('Low Close Rate', 'Alert struggling agents weekly', 'Weekly', true),
  ('Abandoned Check-in', 'Ping stalled applicants', 'Daily', true),
  ('Seminar Reminders', '24hr + 1hr before reminders', 'Hourly check', true),
  ('Manager Digest', 'Summary to each manager', '6:00 AM CST Daily', true)
ON CONFLICT (name) DO NOTHING;
