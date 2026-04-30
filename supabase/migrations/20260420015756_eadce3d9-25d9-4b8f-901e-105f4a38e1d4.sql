-- 1. ICS feed tokens
CREATE TABLE IF NOT EXISTS public.ics_feed_tokens (
  token text PRIMARY KEY DEFAULT substring(md5(random()::text || clock_timestamp()::text) from 1 for 32),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

ALTER TABLE public.ics_feed_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_ics_token" ON public.ics_feed_tokens;
CREATE POLICY "users_manage_own_ics_token" ON public.ics_feed_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_or_create_ics_token()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  SELECT token INTO v_token FROM public.ics_feed_tokens WHERE user_id = auth.uid();
  IF v_token IS NULL THEN
    INSERT INTO public.ics_feed_tokens (user_id) VALUES (auth.uid()) RETURNING token INTO v_token;
  END IF;
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_ics_token() TO authenticated;

-- 2. Getting Started auto-advance from agent changes
CREATE OR REPLACE FUNCTION public.auto_advance_getting_started()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agent_id uuid;
  v_progress_id uuid;
  v_new_stage text;
  v_has_license boolean;
  v_has_production boolean;
  v_onboarding_stage text;
BEGIN
  v_agent_id := NEW.id;

  SELECT id INTO v_progress_id FROM public.getting_started_progress WHERE agent_id = v_agent_id;
  IF v_progress_id IS NULL THEN
    INSERT INTO public.getting_started_progress (agent_id, current_stage)
    VALUES (v_agent_id, 'signed_up')
    RETURNING id INTO v_progress_id;
  END IF;

  v_has_license := NEW.license_status = 'licensed';
  v_onboarding_stage := COALESCE(NEW.onboarding_stage::text, '');

  SELECT EXISTS(
    SELECT 1 FROM public.daily_production WHERE agent_id = v_agent_id AND aop > 0
  ) INTO v_has_production;

  IF NEW.is_deactivated = true OR v_onboarding_stage = 'inactive' THEN
    v_new_stage := 'inactive';
  ELSIF v_has_production THEN
    v_new_stage := 'producing';
  ELSIF v_onboarding_stage = 'in_field_training' THEN
    v_new_stage := 'field_training';
  ELSIF v_has_license THEN
    v_new_stage := 'contracting';
  ELSIF v_onboarding_stage IN ('pre_licensed', 'training_online') THEN
    v_new_stage := 'licensing';
  ELSIF v_onboarding_stage IN ('applied', 'meeting_attendance', 'onboarding') THEN
    v_new_stage := 'onboarding';
  ELSE
    v_new_stage := 'signed_up';
  END IF;

  UPDATE public.getting_started_progress
  SET current_stage = v_new_stage,
      stage_entered_at = CASE WHEN current_stage IS DISTINCT FROM v_new_stage THEN now() ELSE stage_entered_at END,
      last_activity_at = now()
  WHERE id = v_progress_id;

  RETURN NEW;
END;
$$;

-- Ensure agents.onboarding_stage exists (Lovable-platform creates it on hosted projects;
-- on self-hosted/fresh projects we add it explicitly so this trigger can attach)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'onboarding_stage'
  ) THEN
    ALTER TABLE public.agents ADD COLUMN onboarding_stage public.onboarding_stage;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_auto_advance_gs_on_agent_change ON public.agents;
CREATE TRIGGER trg_auto_advance_gs_on_agent_change
  AFTER INSERT OR UPDATE OF onboarding_stage, license_status, is_deactivated ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.auto_advance_getting_started();

-- 3. Auto-advance when production logged
CREATE OR REPLACE FUNCTION public.auto_advance_on_production()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.aop > 0 THEN
    UPDATE public.getting_started_progress
    SET current_stage = 'producing',
        stage_entered_at = CASE WHEN current_stage <> 'producing' THEN now() ELSE stage_entered_at END,
        last_activity_at = now(),
        closed_first_deal = COALESCE(closed_first_deal, now())
    WHERE agent_id = NEW.agent_id
      AND current_stage NOT IN ('producing', 'inactive');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_advance_gs_on_production ON public.daily_production;
CREATE TRIGGER trg_auto_advance_gs_on_production
  AFTER INSERT OR UPDATE ON public.daily_production
  FOR EACH ROW EXECUTE FUNCTION public.auto_advance_on_production();

-- 4. Backfill existing agents
UPDATE public.agents SET updated_at = now();
