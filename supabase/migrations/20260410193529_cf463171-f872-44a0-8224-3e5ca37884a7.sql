
-- Create onboarding_stage enum if it doesn't exist (Lovable-platform creates this in old projects;
-- on a fresh project we need it before ALTERing)
DO $$ BEGIN
  CREATE TYPE public.onboarding_stage AS ENUM (
    'applied', 'meeting_attendance', 'pre_licensed', 'transfer',
    'below_10k', 'live', 'need_followup', 'inactive', 'pending_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add missing enum values (no-op on fresh project, idempotent on old)
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'applied';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'meeting_attendance';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'pre_licensed';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'below_10k';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'live';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'need_followup';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'inactive';
ALTER TYPE public.onboarding_stage ADD VALUE IF NOT EXISTS 'pending_review';

-- Create instagram_subscriptions table
CREATE TABLE IF NOT EXISTS public.instagram_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  instagram_handle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(agent_id)
);

ALTER TABLE public.instagram_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all instagram subscriptions"
  ON public.instagram_subscriptions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can view own instagram subscription"
  ON public.instagram_subscriptions FOR SELECT
  USING (agent_id = current_agent_id());

CREATE POLICY "Agents can manage own instagram subscription"
  ON public.instagram_subscriptions FOR ALL
  USING (agent_id = current_agent_id())
  WITH CHECK (agent_id = current_agent_id());
