-- Create invitation_seen table for tracking dismissed invitations
CREATE TABLE public.invitation_seen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_user_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(viewer_user_id, agent_id)
);

-- Enable RLS
ALTER TABLE public.invitation_seen ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can manage their own seen records
CREATE POLICY "Users can insert own seen records"
ON public.invitation_seen
FOR INSERT
WITH CHECK (auth.uid() = viewer_user_id);

CREATE POLICY "Users can view own seen records"
ON public.invitation_seen
FOR SELECT
USING (auth.uid() = viewer_user_id);

CREATE POLICY "Users can delete own seen records"
ON public.invitation_seen
FOR DELETE
USING (auth.uid() = viewer_user_id);