
-- Create scheduled_interviews table
CREATE TABLE IF NOT EXISTS public.scheduled_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  scheduled_by uuid NOT NULL,
  interview_date timestamptz NOT NULL,
  interview_type text NOT NULL DEFAULT 'video',
  meeting_link text,
  notes text,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_interviews ENABLE ROW LEVEL SECURITY;

-- Admins manage all interviews
CREATE POLICY "Admins manage all interviews"
  ON public.scheduled_interviews
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers see interviews for their team's applications
CREATE POLICY "Managers see team interviews"
  ON public.scheduled_interviews
  FOR SELECT
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND application_id IN (
      SELECT a.id FROM public.applications a
      WHERE a.assigned_agent_id IN (
        SELECT ag.id FROM public.agents ag
        WHERE ag.invited_by_manager_id = get_agent_id(auth.uid())
      )
    )
  );

-- Managers can insert interviews for their team
CREATE POLICY "Managers insert team interviews"
  ON public.scheduled_interviews
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role)
    AND application_id IN (
      SELECT a.id FROM public.applications a
      WHERE a.assigned_agent_id IN (
        SELECT ag.id FROM public.agents ag
        WHERE ag.invited_by_manager_id = get_agent_id(auth.uid())
      )
      UNION
      SELECT a2.id FROM public.applications a2
      WHERE a2.assigned_agent_id = get_agent_id(auth.uid())
    )
  );

-- Agents see interviews for their applications
CREATE POLICY "Agents see their interviews"
  ON public.scheduled_interviews
  FOR SELECT
  USING (
    application_id IN (
      SELECT a.id FROM public.applications a
      WHERE a.assigned_agent_id = get_agent_id(auth.uid())
    )
  );

-- Agents can insert interviews for their applications
CREATE POLICY "Agents insert their interviews"
  ON public.scheduled_interviews
  FOR INSERT
  WITH CHECK (
    application_id IN (
      SELECT a.id FROM public.applications a
      WHERE a.assigned_agent_id = get_agent_id(auth.uid())
    )
  );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_scheduled_interviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_scheduled_interviews_updated_at
  BEFORE UPDATE ON public.scheduled_interviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_scheduled_interviews_updated_at();
