
-- Field check-ins table
CREATE TABLE public.field_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  latitude numeric,
  longitude numeric,
  client_name text NOT NULL,
  outcome text NOT NULL DEFAULT 'pending',
  voice_note_url text,
  notes text,
  synced boolean NOT NULL DEFAULT true,
  checkin_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can insert own checkins" ON public.field_checkins
  FOR INSERT WITH CHECK (agent_id = current_agent_id());

CREATE POLICY "Agents can view own checkins" ON public.field_checkins
  FOR SELECT USING (agent_id = current_agent_id());

CREATE POLICY "Admins can manage all checkins" ON public.field_checkins
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view team checkins" ON public.field_checkins
  FOR SELECT USING (
    has_role(auth.uid(), 'manager'::app_role) AND
    agent_id IN (SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id())
  );

CREATE TRIGGER update_field_checkins_updated_at
  BEFORE UPDATE ON public.field_checkins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Churn risk alerts table
CREATE TABLE public.churn_risk_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  risk_score integer NOT NULL DEFAULT 0,
  risk_tier text NOT NULL DEFAULT 'low',
  risk_factors jsonb DEFAULT '[]'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  action_taken text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.churn_risk_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all churn alerts" ON public.churn_risk_alerts
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view team churn alerts" ON public.churn_risk_alerts
  FOR SELECT USING (
    has_role(auth.uid(), 'manager'::app_role) AND
    agent_id IN (SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id())
  );

CREATE POLICY "Managers can update team churn alerts" ON public.churn_risk_alerts
  FOR UPDATE USING (
    has_role(auth.uid(), 'manager'::app_role) AND
    agent_id IN (SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id())
  );

CREATE TRIGGER update_churn_risk_alerts_updated_at
  BEFORE UPDATE ON public.churn_risk_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
