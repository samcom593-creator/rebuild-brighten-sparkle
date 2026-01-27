-- Create magic login tokens table for one-tap email login
CREATE TABLE public.magic_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  destination TEXT DEFAULT 'portal',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours'),
  used_at TIMESTAMPTZ
);

-- Index for fast token lookups
CREATE INDEX idx_magic_login_token ON public.magic_login_tokens(token);

-- Index for cleanup of expired tokens
CREATE INDEX idx_magic_login_expires ON public.magic_login_tokens(expires_at);

-- Enable RLS
ALTER TABLE public.magic_login_tokens ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage tokens (tokens are validated via edge functions with service role)
CREATE POLICY "Admins can manage magic tokens"
ON public.magic_login_tokens
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Comment explaining the table
COMMENT ON TABLE public.magic_login_tokens IS 'One-time magic login tokens for agent portal access via email links';