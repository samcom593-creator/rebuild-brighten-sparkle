-- ============================================================
-- Add remaining automations to pg_cron schedule
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping';
    RETURN;
  END IF;

  -- Numbers reminder — 7pm CST (01:00 UTC next day)
  PERFORM cron.unschedule('send-numbers-reminder')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-numbers-reminder');
  PERFORM cron.schedule(
    'send-numbers-reminder',
    '0 1 * * *',
    $sql$SELECT public.run_automation_job('numbers-reminder','send-numbers-reminder','{}'::jsonb)$sql$
  );

  -- Daily producer spotlight — 7:30am CST (13:30 UTC)
  PERFORM cron.unschedule('send-daily-producer-spotlight')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-daily-producer-spotlight');
  PERFORM cron.schedule(
    'send-daily-producer-spotlight',
    '30 13 * * *',
    $sql$SELECT public.run_automation_job('producer-spotlight','send-daily-producer-spotlight','{}'::jsonb)$sql$
  );

  RAISE NOTICE 'All remaining cron jobs scheduled.';
END;
$$;

-- ─── Trigger new hire flow when agent moves to in_field_training ─────────────
CREATE OR REPLACE FUNCTION public.trg_fn_agent_new_hire_flow()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  -- Only fire on transition INTO "in_field_training" (or contracted_at first set)
  IF (OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage
      AND NEW.onboarding_stage = 'in_field_training')
     OR (OLD.contracted_at IS NULL AND NEW.contracted_at IS NOT NULL) THEN
    PERFORM public.run_automation_job(
      'trigger-new-hire-flow',
      'trigger-new-hire-flow',
      jsonb_build_object('agent_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_new_hire_flow ON public.agents;
CREATE TRIGGER trg_agent_new_hire_flow
  AFTER UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_agent_new_hire_flow();
