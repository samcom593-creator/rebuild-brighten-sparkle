
CREATE TABLE public.recurring_calendar_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  start_hour INTEGER NOT NULL,
  end_hour INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'admin',
  notes TEXT,
  recurrence_type TEXT NOT NULL DEFAULT 'daily',
  day_of_week INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recurring_calendar_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own recurring blocks"
  ON public.recurring_calendar_blocks
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage all recurring blocks"
  ON public.recurring_calendar_blocks
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
