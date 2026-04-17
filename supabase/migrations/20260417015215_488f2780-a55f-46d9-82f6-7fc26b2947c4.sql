
-- Licensing delegates: who's helping applicant get licensed
CREATE TABLE IF NOT EXISTS public.licensing_delegates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  delegate_user_id UUID NOT NULL,
  delegate_name TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(application_id, delegate_user_id)
);

CREATE INDEX IF NOT EXISTS idx_licensing_delegates_application ON public.licensing_delegates(application_id);
CREATE INDEX IF NOT EXISTS idx_licensing_delegates_delegate ON public.licensing_delegates(delegate_user_id);

ALTER TABLE public.licensing_delegates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/managers manage delegates"
ON public.licensing_delegates FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'manager'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'manager'::app_role)
);

CREATE POLICY "Delegates see their own assignments"
ON public.licensing_delegates FOR SELECT
TO authenticated
USING (delegate_user_id = auth.uid());

CREATE TRIGGER update_licensing_delegates_updated_at
BEFORE UPDATE ON public.licensing_delegates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Call transcripts: AI-generated transcriptions
CREATE TABLE IF NOT EXISTS public.call_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  recorded_by UUID,
  audio_url TEXT,
  transcript TEXT,
  summary TEXT,
  sentiment TEXT,
  duration_seconds INTEGER,
  call_outcome TEXT,
  ai_model TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_application ON public.call_transcripts(application_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_agent ON public.call_transcripts(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_recorded_by ON public.call_transcripts(recorded_by);

ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/managers manage transcripts"
ON public.call_transcripts FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'manager'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'manager'::app_role)
);

CREATE POLICY "Recorders see their own transcripts"
ON public.call_transcripts FOR SELECT
TO authenticated
USING (recorded_by = auth.uid());

CREATE POLICY "Recorders insert their own transcripts"
ON public.call_transcripts FOR INSERT
TO authenticated
WITH CHECK (recorded_by = auth.uid());

CREATE TRIGGER update_call_transcripts_updated_at
BEFORE UPDATE ON public.call_transcripts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
