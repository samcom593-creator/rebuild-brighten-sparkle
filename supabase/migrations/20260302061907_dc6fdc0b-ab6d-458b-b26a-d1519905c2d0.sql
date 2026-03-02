
-- Admin Calendar Blocks table
CREATE TABLE public.admin_calendar_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  start_hour INTEGER NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  end_hour INTEGER NOT NULL CHECK (end_hour >= 1 AND end_hour <= 24),
  block_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL DEFAULT 'admin',
  completed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_calendar_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own calendar blocks"
  ON public.admin_calendar_blocks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all calendar blocks"
  ON public.admin_calendar_blocks
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seminar Registrations table
CREATE TABLE public.seminar_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  license_status TEXT DEFAULT 'unknown',
  source TEXT DEFAULT 'landing_page',
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  attended BOOLEAN DEFAULT false,
  follow_up_sent_at TIMESTAMP WITH TIME ZONE,
  seminar_date DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.seminar_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can register for seminars"
  ON public.seminar_registrations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can manage all registrations"
  ON public.seminar_registrations
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view registrations"
  ON public.seminar_registrations
  FOR SELECT
  USING (has_role(auth.uid(), 'manager'::app_role));
