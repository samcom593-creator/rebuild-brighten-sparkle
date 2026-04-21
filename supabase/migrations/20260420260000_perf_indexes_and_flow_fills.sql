-- ─────────────────────────────────────────────────────────────────────
-- APEX perf + automation fills
-- - missing indexes on high-traffic columns and hot-path query patterns
-- - foreign-key ON DELETE fixes
-- - new real-time triggers that were missing from the bot_alerts framework
-- ─────────────────────────────────────────────────────────────────────

-- ─── INDEXES ─────────────────────────────────────────────────────────

-- Partial index: only "live" rows matter for activation queries.
CREATE INDEX IF NOT EXISTS idx_agents_live
  ON public.agents(status)
  WHERE is_deactivated = false AND is_inactive = false;

CREATE INDEX IF NOT EXISTS idx_agents_deactivated
  ON public.agents(is_deactivated)
  WHERE is_deactivated = true;

-- Applications: last_contacted_at is used heavily by nudge sweep + ScheduleBar.
CREATE INDEX IF NOT EXISTS idx_applications_last_contacted
  ON public.applications(last_contacted_at);

CREATE INDEX IF NOT EXISTS idx_applications_status_created
  ON public.applications(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_license_status
  ON public.applications(license_status, status)
  WHERE contacted_at IS NULL;

-- bot_audits: engine reads by (created_at >= X) and filters by severity.
CREATE INDEX IF NOT EXISTS idx_bot_audits_severity_created
  ON public.bot_audits(severity, created_at DESC);

-- bot_alerts: the dispatcher's hot path is `sent_at IS NULL ORDER BY created_at`.
CREATE INDEX IF NOT EXISTS idx_bot_alerts_queue
  ON public.bot_alerts(created_at)
  WHERE sent_at IS NULL;

-- inbox_messages: the inbox filter is `direction='inbound' AND replied_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_inbox_messages_unreplied_inbound
  ON public.inbox_messages(received_at DESC)
  WHERE direction = 'inbound' AND replied_at IS NULL;

-- deals: status-filtered timeline queries.
CREATE INDEX IF NOT EXISTS idx_deals_status_effective
  ON public.deals(status, effective_date DESC);

-- ─── FK ON DELETE FIXES ──────────────────────────────────────────────

-- notification_log.agent_id → SET NULL on agent delete so logs survive.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
              WHERE table_name='notification_log' AND constraint_name='notification_log_agent_id_fkey') THEN
    ALTER TABLE public.notification_log DROP CONSTRAINT notification_log_agent_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='notification_log' AND column_name='agent_id') THEN
    ALTER TABLE public.notification_log
      ADD CONSTRAINT notification_log_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── NEW REAL-TIME ALERTS (fill the bot_alerts gaps) ────────────────

-- Hot lead arrived: a licensed applicant just submitted.
CREATE OR REPLACE FUNCTION public.bot_alert_licensed_app()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.license_status = 'licensed' THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels, action_link)
    VALUES (
      'trigger',
      'licensed_app_arrived',
      'critical',
      format('🔥 Licensed applicant: %s %s', NEW.first_name, NEW.last_name),
      format('<p><strong>%s %s</strong> just submitted a licensed application.</p><p>Phone: %s · Email: %s</p>',
             NEW.first_name, NEW.last_name, COALESCE(NEW.phone, '—'), COALESCE(NEW.email, '—')),
      format('🔥 LICENSED: %s %s %s', NEW.first_name, NEW.last_name, COALESCE(NEW.phone, '')),
      ARRAY['email','sms']::text[],
      'https://apex-financial.org/dashboard/applicants?license=licensed&status=new&contacted=untouched'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_alert_licensed_app ON public.applications;
CREATE TRIGGER trg_bot_alert_licensed_app
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_licensed_app();

-- Agent contracted: an application just crossed the line.
CREATE OR REPLACE FUNCTION public.bot_alert_agent_contracted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.contracted_at IS NOT NULL AND (OLD.contracted_at IS NULL) THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels, action_link)
    VALUES (
      'trigger',
      'applicant_contracted',
      'celebrate',
      format('✍️ Contracted: %s %s', NEW.first_name, NEW.last_name),
      format('<p><strong>%s %s</strong> just signed a contract. License: %s.</p>',
             NEW.first_name, NEW.last_name, COALESCE(NEW.license_status, '—')),
      format('✍️ Contracted: %s %s', NEW.first_name, NEW.last_name),
      ARRAY['email','sms']::text[],
      'https://apex-financial.org/dashboard/hiring-pipeline'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_alert_agent_contracted ON public.applications;
CREATE TRIGGER trg_bot_alert_agent_contracted
  AFTER UPDATE OF contracted_at ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_agent_contracted();
