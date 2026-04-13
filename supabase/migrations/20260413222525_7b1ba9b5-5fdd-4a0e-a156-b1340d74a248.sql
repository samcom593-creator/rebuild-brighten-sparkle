
-- Hole 1: Duplicate detection
ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS duplicate_of UUID;

-- Hole 3: Speed-to-contact tracking
ALTER TABLE applications ADD COLUMN IF NOT EXISTS first_contact_attempt_at TIMESTAMPTZ;

-- Hole 4: Ghosted applicant detection
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_ghosted BOOLEAN DEFAULT false;

-- Hole 10: Pipeline speed tracking
ALTER TABLE applications ADD COLUMN IF NOT EXISTS course_started_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS licensed_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS first_deal_at TIMESTAMPTZ;

-- Hole 11: Win-back campaign
ALTER TABLE applications ADD COLUMN IF NOT EXISTS winback_sent_at TIMESTAMPTZ;

-- Hole 6: Fingerprint tracking
ALTER TABLE applications ADD COLUMN IF NOT EXISTS fingerprint_date TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS fingerprint_done BOOLEAN DEFAULT false;

-- Hole 9: Manager capacity
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_recruits INTEGER DEFAULT 15;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_apps_ghosted ON applications(is_ghosted) WHERE is_ghosted = true;
CREATE INDEX IF NOT EXISTS idx_apps_first_contact ON applications(first_contact_attempt_at);
CREATE INDEX IF NOT EXISTS idx_apps_licensed ON applications(licensed_at);
CREATE INDEX IF NOT EXISTS idx_apps_first_deal ON applications(first_deal_at);
CREATE INDEX IF NOT EXISTS idx_apps_duplicate ON applications(is_duplicate) WHERE is_duplicate = true;
CREATE INDEX IF NOT EXISTS idx_apps_winback ON applications(winback_sent_at);

-- Auto-populate first_deal_at trigger
CREATE OR REPLACE FUNCTION public.auto_set_first_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.aop > 0 THEN
    UPDATE applications
    SET first_deal_at = NOW()
    WHERE first_deal_at IS NULL
      AND assigned_agent_id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_first_deal ON daily_production;
CREATE TRIGGER trg_auto_first_deal
  AFTER INSERT ON daily_production
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_first_deal();
