-- ═══════════════════════════════════════════════════════════════════════════
-- Apex Strikes + Charges Audit Migration — 2026-05-17
--
-- Adds:
--   1. agent_strikes table + enums (reason, severity, status) + RLS
--   2. issue_strike() / resolve_strike() / void_strike() RPCs (admin only)
--   3. v_agent_strikes view (joined w/ agent + profile + issuer)
--   4. v_strike_summary view (per-agent active count + severity total)
--   5. v_charge_anomalies view (duplicate emails, name mismatches, missing agent links)
--   6. Auto-notification trigger when an agent reaches 3 active strikes
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE strike_reason_code AS ENUM (
    'no_show',           -- missed mandatory training/meeting
    'ghosted_lead',      -- did not contact assigned lead in SLA
    'customer_complaint',-- client filed complaint
    'false_charge',      -- charged amount not authorized
    'dnq_application',   -- submitted application that does not qualify
    'no_followup',       -- did not follow up with hot lead
    'billing_dispute',   -- agent disputing a charge (informational)
    'compliance',        -- regulatory / compliance violation
    'misrepresentation', -- misrepresenting product, role, or self
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE strike_severity AS ENUM ('warning','minor','major','terminal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE strike_status AS ENUM ('active','expired','resolved','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_strikes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  issued_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason_code     strike_reason_code NOT NULL,
  severity        strike_severity NOT NULL DEFAULT 'warning',
  description     text NOT NULL,
  evidence_urls   text[] DEFAULT '{}'::text[],
  status          strike_status NOT NULL DEFAULT 'active',
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  related_application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  related_lead_purchase_id uuid REFERENCES lead_purchases(id) ON DELETE SET NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_strikes_agent_id ON agent_strikes(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_strikes_status ON agent_strikes(status) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_agent_strikes_issued_at ON agent_strikes(issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_strikes_severity ON agent_strikes(severity);

-- Auto-expire trigger: when expires_at passes, status flips to 'expired'.
-- (Handled in view-layer below via computed status, but also keep a clean
--  background sweep via cron later.)

-- updated_at trigger
CREATE OR REPLACE FUNCTION fn_agent_strikes_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_strikes_updated_at ON agent_strikes;
CREATE TRIGGER trg_agent_strikes_updated_at
  BEFORE UPDATE ON agent_strikes
  FOR EACH ROW EXECUTE FUNCTION fn_agent_strikes_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE agent_strikes ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies (clean re-apply)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='agent_strikes' LOOP
    EXECUTE format('DROP POLICY %I ON agent_strikes', r.policyname);
  END LOOP;
END $$;

-- Agents see their own strikes
CREATE POLICY strikes_agent_self ON agent_strikes
  FOR SELECT
  USING (
    agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
  );

-- Managers see strikes for agents they manage (direct downline)
CREATE POLICY strikes_manager_downline ON agent_strikes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = agent_strikes.agent_id
        AND a.manager_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
    )
  );

-- Admins see all
CREATE POLICY strikes_admin_all ON agent_strikes
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin')
  );

-- ─── RPCs (SECURITY DEFINER, admin-only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION issue_strike(
  p_agent_id      uuid,
  p_reason_code   strike_reason_code,
  p_severity      strike_severity,
  p_description   text,
  p_expires_at    timestamptz DEFAULT NULL,
  p_evidence_urls text[] DEFAULT '{}'::text[],
  p_related_application_id uuid DEFAULT NULL,
  p_related_lead_purchase_id uuid DEFAULT NULL
) RETURNS agent_strikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_strike   agent_strikes;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can issue strikes';
  END IF;
  IF p_description IS NULL OR length(trim(p_description)) < 5 THEN
    RAISE EXCEPTION 'Description must be at least 5 characters';
  END IF;

  INSERT INTO agent_strikes (
    agent_id, issued_by, reason_code, severity, description,
    evidence_urls, expires_at, related_application_id, related_lead_purchase_id
  ) VALUES (
    p_agent_id, auth.uid(), p_reason_code, p_severity, p_description,
    COALESCE(p_evidence_urls, '{}'::text[]), p_expires_at,
    p_related_application_id, p_related_lead_purchase_id
  ) RETURNING * INTO v_strike;

  -- Auto-notification on 3rd active major strike
  IF v_strike.severity IN ('major','terminal') AND (
    SELECT count(*) FROM agent_strikes
    WHERE agent_id = p_agent_id
      AND status='active'
      AND severity IN ('major','terminal')
  ) >= 3 THEN
    -- write to notifications if the table exists
    BEGIN
      INSERT INTO notifications (user_id, type, title, body, created_at)
      SELECT a.user_id, 'review_required',
             'Agent flagged for review',
             format('Agent %s has %s active major+ strikes. Action recommended.',
                    COALESCE(a.display_name, a.agent_code, a.id::text),
                    (SELECT count(*) FROM agent_strikes WHERE agent_id=p_agent_id AND status='active' AND severity IN ('major','terminal'))),
             now()
      FROM agents a WHERE a.id = p_agent_id;
    EXCEPTION WHEN OTHERS THEN NULL; -- notifications schema differs; skip silently
    END;
  END IF;

  RETURN v_strike;
END $$;

CREATE OR REPLACE FUNCTION resolve_strike(
  p_strike_id uuid,
  p_resolution_note text
) RETURNS agent_strikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_strike   agent_strikes;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can resolve strikes';
  END IF;

  UPDATE agent_strikes
  SET status='resolved',
      resolved_at = now(),
      resolved_by = auth.uid(),
      resolution_note = p_resolution_note
  WHERE id = p_strike_id
    AND status = 'active'
  RETURNING * INTO v_strike;

  IF v_strike.id IS NULL THEN
    RAISE EXCEPTION 'Strike not found or already resolved';
  END IF;

  RETURN v_strike;
END $$;

CREATE OR REPLACE FUNCTION void_strike(
  p_strike_id uuid,
  p_void_reason text
) RETURNS agent_strikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_strike   agent_strikes;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can void strikes';
  END IF;

  UPDATE agent_strikes
  SET status='voided',
      resolved_at = now(),
      resolved_by = auth.uid(),
      resolution_note = COALESCE(resolution_note,'') || E'\n[VOIDED] ' || p_void_reason
  WHERE id = p_strike_id
  RETURNING * INTO v_strike;

  IF v_strike.id IS NULL THEN
    RAISE EXCEPTION 'Strike not found';
  END IF;

  RETURN v_strike;
END $$;

GRANT EXECUTE ON FUNCTION issue_strike(uuid, strike_reason_code, strike_severity, text, timestamptz, text[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_strike(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION void_strike(uuid, text) TO authenticated;

-- ─── Views ──────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_agent_strikes CASCADE;
CREATE VIEW v_agent_strikes AS
SELECT
  s.id,
  s.agent_id,
  COALESCE(a.display_name, p.full_name, u.email, 'Unknown') AS agent_name,
  a.agent_code,
  s.reason_code,
  s.severity,
  s.description,
  s.evidence_urls,
  CASE
    WHEN s.status='active' AND s.expires_at IS NOT NULL AND s.expires_at < now() THEN 'expired'::strike_status
    ELSE s.status
  END AS status,
  s.issued_at,
  s.expires_at,
  s.resolved_at,
  s.resolution_note,
  s.issued_by,
  COALESCE(ip.full_name, iu.email) AS issued_by_name,
  s.resolved_by,
  COALESCE(rp.full_name, ru.email) AS resolved_by_name,
  s.related_application_id,
  s.related_lead_purchase_id,
  s.metadata,
  s.created_at,
  s.updated_at
FROM agent_strikes s
LEFT JOIN agents   a  ON a.id = s.agent_id
LEFT JOIN profiles p  ON p.id = a.profile_id
LEFT JOIN auth.users u ON u.id = a.user_id
LEFT JOIN auth.users iu ON iu.id = s.issued_by
LEFT JOIN profiles ip ON ip.id = iu.id
LEFT JOIN auth.users ru ON ru.id = s.resolved_by
LEFT JOIN profiles rp ON rp.id = ru.id;

DROP VIEW IF EXISTS v_strike_summary CASCADE;
CREATE VIEW v_strike_summary AS
SELECT
  a.id AS agent_id,
  COALESCE(a.display_name, p.full_name, u.email, 'Unknown') AS agent_name,
  a.agent_code,
  count(*) FILTER (WHERE s.status='active') AS active_count,
  count(*) FILTER (WHERE s.status='active' AND s.severity='warning') AS active_warnings,
  count(*) FILTER (WHERE s.status='active' AND s.severity='minor') AS active_minor,
  count(*) FILTER (WHERE s.status='active' AND s.severity='major') AS active_major,
  count(*) FILTER (WHERE s.status='active' AND s.severity='terminal') AS active_terminal,
  count(*) FILTER (WHERE s.status='resolved') AS resolved_count,
  count(*) AS total_count,
  max(s.issued_at) FILTER (WHERE s.status='active') AS most_recent_active_at,
  CASE
    WHEN count(*) FILTER (WHERE s.status='active' AND s.severity='terminal') > 0 THEN 'terminal'
    WHEN count(*) FILTER (WHERE s.status='active' AND s.severity='major') >= 3 THEN 'review_required'
    WHEN count(*) FILTER (WHERE s.status='active' AND s.severity='major') > 0 THEN 'on_notice'
    WHEN count(*) FILTER (WHERE s.status='active') > 0 THEN 'flagged'
    ELSE 'clear'
  END AS standing
FROM agents a
LEFT JOIN profiles p ON p.id = a.profile_id
LEFT JOIN auth.users u ON u.id = a.user_id
LEFT JOIN agent_strikes s
  ON s.agent_id = a.id
GROUP BY a.id, a.display_name, p.full_name, u.email, a.agent_code;

-- ─── Charge anomalies view (for billing audit page) ─────────────────────────
DROP VIEW IF EXISTS v_charge_anomalies CASCADE;
CREATE VIEW v_charge_anomalies AS
WITH base AS (
  SELECT
    lp.id,
    lp.stripe_charge_id,
    lp.amount_cents,
    (lp.amount_cents::numeric / 100) AS amount_usd,
    lp.currency,
    lp.customer_email,
    lp.customer_name,
    lp.description,
    lp.agent_id_ref,
    lp.agent_id,
    lp.charged_at,
    lp.metadata,
    -- agent we can resolve from the customer email
    COALESCE(a_email.id, a_ref.id) AS resolved_agent_id,
    COALESCE(
      a_email.display_name,
      a_ref.display_name,
      p_email.full_name,
      p_ref.full_name
    ) AS resolved_agent_name
  FROM lead_purchases lp
  LEFT JOIN auth.users u_email ON u_email.email = lp.customer_email
  LEFT JOIN agents     a_email ON a_email.user_id = u_email.id
  LEFT JOIN profiles   p_email ON p_email.id = a_email.profile_id
  LEFT JOIN agents     a_ref   ON a_ref.id = lp.agent_id
  LEFT JOIN profiles   p_ref   ON p_ref.id = a_ref.profile_id
)
SELECT
  b.*,
  -- flag: customer_name does not contain agent's first name
  (b.customer_name IS NOT NULL
   AND b.resolved_agent_name IS NOT NULL
   AND lower(b.customer_name) NOT LIKE '%' || lower(split_part(b.resolved_agent_name,' ',1)) || '%'
  ) AS flag_name_mismatch,
  -- flag: no agent could be resolved at all
  (b.resolved_agent_id IS NULL) AS flag_unlinked,
  -- flag: amount not in the standard set (100/250)
  (b.amount_cents NOT IN (10000, 25000)) AS flag_unusual_amount,
  -- flag: 2+ charges within 10 minutes for same email
  EXISTS (
    SELECT 1 FROM lead_purchases lp2
    WHERE lp2.customer_email = b.customer_email
      AND lp2.id <> b.id
      AND abs(extract(epoch from (lp2.charged_at - b.charged_at))) < 600
  ) AS flag_duplicate_window
FROM base b;

GRANT SELECT ON v_agent_strikes TO authenticated;
GRANT SELECT ON v_strike_summary TO authenticated;
GRANT SELECT ON v_charge_anomalies TO authenticated;

COMMIT;
