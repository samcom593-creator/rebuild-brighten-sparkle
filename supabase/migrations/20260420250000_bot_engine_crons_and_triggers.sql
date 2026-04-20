-- Autonomous optimization engine — scheduling + real-time alert triggers.
-- Central Time: 7am = 12:00 UTC, 9pm = 02:00 UTC next day, Sunday 6pm = 23:00 UTC Sunday.
-- (CST -6 UTC offset, -5 during DST; when DST hits we'll drift 1 hour which is acceptable for daily reports.)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping bot engine cron setup';
    RETURN;
  END IF;

  PERFORM cron.unschedule('apex-morning-brief')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-morning-brief');
  PERFORM cron.schedule(
    'apex-morning-brief',
    '0 12 * * *',  -- 7am CST
    $sql$SELECT public.run_automation_job('apex-morning-brief','apex-morning-brief','{}'::jsonb)$sql$
  );

  PERFORM cron.unschedule('apex-evening-report')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-evening-report');
  PERFORM cron.schedule(
    'apex-evening-report',
    '0 2 * * *',   -- 9pm CST (02:00 UTC next day)
    $sql$SELECT public.run_automation_job('apex-evening-report','apex-evening-report','{}'::jsonb)$sql$
  );

  PERFORM cron.unschedule('apex-weekly-report')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-weekly-report');
  PERFORM cron.schedule(
    'apex-weekly-report',
    '0 23 * * 0',  -- Sunday 6pm CST
    $sql$SELECT public.run_automation_job('apex-weekly-report','apex-weekly-report','{}'::jsonb)$sql$
  );

  PERFORM cron.unschedule('apex-audit-engine-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-audit-engine-sweep');
  PERFORM cron.schedule(
    'apex-audit-engine-sweep',
    '*/30 * * * *',  -- every 30 minutes
    $sql$SELECT public.run_automation_job('apex-audit-engine-sweep','apex-audit-engine','{}'::jsonb)$sql$
  );

  PERFORM cron.unschedule('apex-alert-dispatch-flush')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-alert-dispatch-flush');
  PERFORM cron.schedule(
    'apex-alert-dispatch-flush',
    '*/5 * * * *',   -- every 5 minutes, drains bot_alerts queue
    $sql$SELECT public.run_automation_job('apex-alert-dispatch-flush','apex-alert-dispatch','{}'::jsonb)$sql$
  );

  RAISE NOTICE 'APEX bot engine cron jobs scheduled.';
END $$;

-- Real-time triggers: write into bot_alerts on key events, apex-alert-dispatch
-- flushes every 5 minutes.

CREATE OR REPLACE FUNCTION public.bot_alert_agent_deactivated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  display_name TEXT;
BEGIN
  IF NEW.status = 'terminated' AND (OLD.status IS DISTINCT FROM 'terminated') THEN
    SELECT COALESCE(p.full_name, 'Agent')
      INTO display_name
      FROM public.profiles p
     WHERE p.id = NEW.profile_id;

    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    VALUES (
      'trigger',
      'agent_deactivated',
      'info',
      format('Agent deactivated: %s', display_name),
      format('<p>%s marked terminated (reason: %s).</p>', display_name, COALESCE(NEW.deactivation_reason::text, 'unspecified')),
      format('APEX: %s terminated (%s)', display_name, COALESCE(NEW.deactivation_reason::text, 'n/a')),
      ARRAY['email']::text[]
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_alert_agent_deactivated ON public.agents;
CREATE TRIGGER trg_bot_alert_agent_deactivated
  AFTER UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_agent_deactivated();

CREATE OR REPLACE FUNCTION public.bot_alert_automation_failure()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'failed' AND (OLD.status IS DISTINCT FROM 'failed') THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    VALUES (
      'trigger',
      'automation_failed',
      'warn',
      format('Automation failed: %s', NEW.job_name),
      format('<p>%s failed at %s.</p><pre>%s</pre>', NEW.job_name, NEW.triggered_at, COALESCE(NEW.error, '(no message)')),
      format('APEX FAIL: %s', NEW.job_name),
      ARRAY['email']::text[]
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_alert_automation_failure ON public.automation_run_log;
CREATE TRIGGER trg_bot_alert_automation_failure
  AFTER INSERT OR UPDATE OF status ON public.automation_run_log
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_automation_failure();

-- Big deal celebration: any single deal with annual_premium >= 2000.
CREATE OR REPLACE FUNCTION public.bot_alert_big_deal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  agent_name TEXT;
BEGIN
  IF NEW.annual_premium IS NOT NULL AND NEW.annual_premium >= 2000 THEN
    SELECT COALESCE(p.full_name, 'Agent') INTO agent_name
      FROM public.agents a
      JOIN public.profiles p ON p.id = a.profile_id
     WHERE a.id = NEW.agent_id;
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    VALUES (
      'trigger',
      'big_deal',
      'celebrate',
      format('Big deal: %s closed $%s ALP', agent_name, NEW.annual_premium::int),
      format('<p>%s just closed $%s ALP (%s).</p>', agent_name, NEW.annual_premium::int, NEW.product_sold),
      format('🔥 %s closed $%s', agent_name, NEW.annual_premium::int),
      ARRAY['email','sms']::text[]
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_alert_big_deal ON public.deals;
CREATE TRIGGER trg_bot_alert_big_deal
  AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_big_deal();

-- InsuraCloud sync errors — warn.
CREATE OR REPLACE FUNCTION public.bot_alert_sync_error()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.insuracloud_sync_error IS NOT NULL AND (OLD.insuracloud_sync_error IS DISTINCT FROM NEW.insuracloud_sync_error) THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    VALUES (
      'trigger',
      'insuracloud_sync_error',
      'warn',
      'InsuraCloud sync error',
      format('<p>Deal %s failed to sync:</p><pre>%s</pre>', NEW.id, NEW.insuracloud_sync_error),
      format('APEX: IC sync fail %s', substring(NEW.insuracloud_sync_error, 1, 50)),
      ARRAY['email']::text[]
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_alert_sync_error ON public.deals;
CREATE TRIGGER trg_bot_alert_sync_error
  AFTER UPDATE OF insuracloud_sync_error ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_sync_error();
