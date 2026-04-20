-- Step 23: Agent Management rebuild — add presenting flag, stage change tracking, lifetime production view

-- 1. Add columns to agents table
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_presenting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz;

-- Backfill stage_changed_at from updated_at for existing rows
UPDATE public.agents SET stage_changed_at = updated_at WHERE stage_changed_at IS NULL;

-- 2. Trigger to auto-update stage_changed_at when onboarding_stage changes
CREATE OR REPLACE FUNCTION public.agents_track_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_track_stage_change ON public.agents;
CREATE TRIGGER trg_agents_track_stage_change
BEFORE UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.agents_track_stage_change();

-- 3. Lifetime production view (sum of all daily_production per agent + last date)
CREATE OR REPLACE VIEW public.agent_lifetime_production AS
SELECT
  agent_id,
  COALESCE(SUM(aop), 0)::numeric AS lifetime_alp,
  COALESCE(SUM(deals_closed), 0)::int AS lifetime_deals,
  MAX(production_date) AS last_production_date
FROM public.daily_production
GROUP BY agent_id;

GRANT SELECT ON public.agent_lifetime_production TO authenticated, anon;