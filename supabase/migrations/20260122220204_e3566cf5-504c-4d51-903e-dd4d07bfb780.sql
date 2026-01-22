-- Create table for manager signup tokens (admin-only invite system)
CREATE TABLE public.manager_signup_tokens (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    manager_name TEXT,
    manager_email TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
    used_by UUID,
    used_at TIMESTAMP WITH TIME ZONE,
    is_used BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.manager_signup_tokens ENABLE ROW LEVEL SECURITY;

-- Only admins can create tokens
CREATE POLICY "Admins can manage signup tokens"
ON public.manager_signup_tokens
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Anyone can view valid tokens (needed for signup page to validate)
CREATE POLICY "Anyone can view active tokens for validation"
ON public.manager_signup_tokens
FOR SELECT
TO anon, authenticated
USING (is_used = false AND expires_at > now());

-- Create index for token lookups
CREATE INDEX idx_manager_signup_tokens_token ON public.manager_signup_tokens(token);