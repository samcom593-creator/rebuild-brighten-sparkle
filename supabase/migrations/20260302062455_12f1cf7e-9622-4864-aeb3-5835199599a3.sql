
-- Phase 6: Daily check-in table for applicants to self-report licensing progress
CREATE TABLE public.applicant_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
  license_progress TEXT,
  notes TEXT,
  study_hours NUMERIC DEFAULT 0,
  test_scheduled BOOLEAN DEFAULT false,
  test_date DATE,
  blocker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(application_id, checkin_date)
);

-- RLS
ALTER TABLE public.applicant_checkins ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (public check-in page uses token, not auth)
CREATE POLICY "Anyone can insert checkins" ON public.applicant_checkins
  FOR INSERT WITH CHECK (true);

-- Admins full access
CREATE POLICY "Admins can manage all checkins" ON public.applicant_checkins
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers can view their team's checkins
CREATE POLICY "Managers can view team checkins" ON public.applicant_checkins
  FOR SELECT USING (
    has_role(auth.uid(), 'manager'::app_role) AND
    application_id IN (
      SELECT id FROM applications
      WHERE assigned_agent_id = get_agent_id(auth.uid())
        OR assigned_agent_id IN (
          SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
        )
    )
  );

-- Agents can view their own assigned application checkins
CREATE POLICY "Agents can view their checkins" ON public.applicant_checkins
  FOR SELECT USING (
    application_id IN (
      SELECT id FROM applications WHERE assigned_agent_id = get_agent_id(auth.uid())
    )
  );
