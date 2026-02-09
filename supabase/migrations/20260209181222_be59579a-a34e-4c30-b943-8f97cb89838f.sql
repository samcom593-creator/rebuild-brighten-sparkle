
-- Lead payment tracking table for admin to track weekly payments
CREATE TABLE public.lead_payment_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  week_start DATE NOT NULL DEFAULT (date_trunc('week', now()))::date,
  tier TEXT NOT NULL,
  paid BOOLEAN DEFAULT false,
  marked_by UUID,
  marked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, week_start, tier)
);

ALTER TABLE public.lead_payment_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payment tracking"
  ON public.lead_payment_tracking FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can view own payment status"
  ON public.lead_payment_tracking FOR SELECT
  USING (agent_id = current_agent_id());
