-- Create table for interview recordings
CREATE TABLE public.interview_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  transcription TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.interview_recordings ENABLE ROW LEVEL SECURITY;

-- Agents can view recordings for their assigned applications
CREATE POLICY "Agents can view recordings for their applications"
ON public.interview_recordings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = application_id
    AND a.assigned_agent_id = (SELECT id FROM public.agents WHERE user_id = auth.uid())
  )
);

-- Agents can create recordings for their assigned applications
CREATE POLICY "Agents can create recordings for their applications"
ON public.interview_recordings
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = application_id
    AND a.assigned_agent_id = (SELECT id FROM public.agents WHERE user_id = auth.uid())
  )
);

-- Agents can delete their own recordings
CREATE POLICY "Agents can delete their recordings"
ON public.interview_recordings
FOR DELETE
USING (
  agent_id = (SELECT id FROM public.agents WHERE user_id = auth.uid())
);