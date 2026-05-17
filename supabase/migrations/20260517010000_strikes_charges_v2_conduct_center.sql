-- ═══════════════════════════════════════════════════════════════════════════
-- Apex Strikes + Charges v2 Migration — 2026-05-17 (later same day)
--
-- Adds:
--   1. strike_templates table + seed (8 common reasons w/ default copy)
--   2. charge_review_actions table (acknowledge, dispute, refund_requested)
--   3. acknowledge_strike() RPC — agent acks their own strike
--   4. record_charge_action() RPC — admin marks anomaly resolved/refund-requested
--   5. v_conduct_command_center view — single roll-up for Conduct dashboard
--   6. v_webhook_health view — last sync timestamp + age in minutes
--   7. Realtime publication membership for agent_strikes + lead_purchases
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── strike_templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strike_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  reason_code   strike_reason_code NOT NULL,
  severity      strike_severity NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL,
  default_expires_days integer,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO strike_templates (slug, reason_code, severity, title, description, default_expires_days, sort_order) VALUES
  ('no_show_meeting',        'no_show',            'warning',  'No-show — team meeting',  'Missed the scheduled team meeting without prior notice. Required attendance per the Apex agent agreement.', 30, 10),
  ('no_show_training',       'no_show',            'minor',    'No-show — training',       'Missed mandatory training session. Re-schedule + confirm attendance for the next available session before this strike resolves.', 60, 20),
  ('ghosted_lead_24h',       'ghosted_lead',       'minor',    'Ghosted lead — 24h SLA',  'Assigned lead was not contacted within the 24-hour service-level agreement. Contact required documentation in CRM.', 30, 30),
  ('ghosted_lead_72h',       'ghosted_lead',       'major',    'Ghosted lead — 72h+',     'Assigned lead remained uncontacted for 72+ hours. This is a major violation of agent obligations and impacts company reputation.', 60, 40),
  ('customer_complaint_formal','customer_complaint','major',   'Formal customer complaint','Customer filed a written complaint. Review the complaint detail and supply a written response within 5 business days.', 90, 50),
  ('false_charge_dispute',   'false_charge',       'warning',  'Disputed charge (billing)','Agent reported being charged an unexpected amount. Logged as a warning while finance team reviews the Stripe record.', 14, 60),
  ('dnq_application',        'dnq_application',    'minor',    'DNQ application submitted','Application submitted does not qualify per the IMO underwriting rules. Review qualification criteria with manager.', 45, 70),
  ('no_followup_hot_lead',   'no_followup',        'minor',    'No follow-up — hot lead', 'Hot lead (lead_score >= 80) did not receive a follow-up within the 48-hour window. Review pipeline cadence with manager.', 30, 80),
  ('compliance_breach_minor','compliance',         'major',    'Compliance breach',        'Violation of compliance policy detected. Specifics must be filled in by the issuing admin before saving.', 180, 90),
  ('misrepresentation',      'misrepresentation',  'terminal', 'Misrepresentation',        'Agent misrepresented product, role, or status in client-facing communication. This is a terminal-severity strike.', NULL, 100)
ON CONFLICT (slug) DO NOTHING;

GRANT SELECT ON strike_templates TO authenticated;

-- ─── charge_review_actions ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE charge_action_type AS ENUM (
    'acknowledged',     -- admin marked anomaly OK / explained
    'refund_requested', -- admin flagged for Stripe refund
    'refund_confirmed', -- refund completed (manual or via Stripe API)
    'agent_linked',     -- admin manually linked charge to agent
    'duplicate_voided'  -- admin marked one of a duplicate pair as voided
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS charge_review_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_purchase_id  uuid NOT NULL REFERENCES lead_purchases(id) ON DELETE CASCADE,
  action            charge_action_type NOT NULL,
  notes             text,
  refund_amount_cents integer,
  performed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at      timestamptz NOT NULL DEFAULT now(),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cra_lp_id ON charge_review_actions(lead_purchase_id);
CREATE INDEX IF NOT EXISTS idx_cra_performed_at ON charge_review_actions(performed_at DESC);

ALTER TABLE charge_review_actions ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='charge_review_actions' LOOP
    EXECUTE format('DROP POLICY %I ON charge_review_actions', r.policyname);
  END LOOP;
END $$;

CREATE POLICY cra_admin_all ON charge_review_actions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin'));

-- ─── record_charge_action RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_charge_action(
  p_lead_purchase_id uuid,
  p_action           charge_action_type,
  p_notes            text DEFAULT NULL,
  p_refund_amount_cents integer DEFAULT NULL
) RETURNS charge_review_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_row charge_review_actions;
BEGIN
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role='admin') INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can record charge actions';
  END IF;
  INSERT INTO charge_review_actions (lead_purchase_id, action, notes, refund_amount_cents, performed_by)
  VALUES (p_lead_purchase_id, p_action, p_notes, p_refund_amount_cents, auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION record_charge_action(uuid, charge_action_type, text, integer) TO authenticated;

-- ─── acknowledge_strike RPC ─────────────────────────────────────────────────
-- Agent records that they've read the strike. Stores ack timestamp in metadata.
CREATE OR REPLACE FUNCTION acknowledge_strike(p_strike_id uuid)
RETURNS agent_strikes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_strike agent_strikes;
  v_agent_id uuid;
BEGIN
  SELECT id INTO v_agent_id FROM agents WHERE user_id = auth.uid();
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not an agent';
  END IF;
  UPDATE agent_strikes
  SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
        'acknowledged_at', to_jsonb(now()),
        'acknowledged_by', to_jsonb(auth.uid())
      )
  WHERE id = p_strike_id
    AND agent_id = v_agent_id
  RETURNING * INTO v_strike;
  IF v_strike.id IS NULL THEN
    RAISE EXCEPTION 'Strike not found or not yours';
  END IF;
  RETURN v_strike;
END $$;

GRANT EXECUTE ON FUNCTION acknowledge_strike(uuid) TO authenticated;

-- ─── v_conduct_command_center view ──────────────────────────────────────────
DROP VIEW IF EXISTS v_conduct_command_center CASCADE;
CREATE VIEW v_conduct_command_center AS
WITH
  strike_stats AS (
    SELECT
      count(*) FILTER (WHERE status='active') AS active_strikes,
      count(*) FILTER (WHERE status='active' AND severity IN ('major','terminal')) AS active_major,
      count(*) FILTER (WHERE status='active' AND issued_at > now() - interval '7 days') AS strikes_7d,
      count(*) FILTER (WHERE status='resolved' AND resolved_at > now() - interval '7 days') AS resolved_7d
    FROM agent_strikes
  ),
  charge_stats AS (
    SELECT
      count(*) AS total_charges,
      count(*) FILTER (WHERE flag_name_mismatch OR flag_unlinked OR flag_unusual_amount OR flag_duplicate_window) AS flagged_charges,
      count(*) FILTER (WHERE flag_duplicate_window) AS duplicate_window_charges,
      count(*) FILTER (WHERE charged_at > now() - interval '7 days') AS charges_7d,
      coalesce(sum(amount_cents), 0) AS total_cents,
      coalesce(sum(amount_cents) FILTER (WHERE flag_duplicate_window), 0) AS dup_cents
    FROM v_charge_anomalies
  ),
  charge_action_stats AS (
    SELECT
      count(*) FILTER (WHERE action='acknowledged') AS acknowledged_count,
      count(*) FILTER (WHERE action='refund_requested') AS refund_requested_count
    FROM charge_review_actions
  ),
  agents_flagged AS (
    SELECT count(*) AS flagged_agents FROM v_strike_summary WHERE standing <> 'clear'
  ),
  webhook_health AS (
    SELECT
      max(charged_at) AS last_charge_at,
      EXTRACT(EPOCH FROM (now() - max(charged_at)))/60 AS minutes_since_last
    FROM lead_purchases
  )
SELECT
  ss.active_strikes,
  ss.active_major,
  ss.strikes_7d,
  ss.resolved_7d,
  cs.total_charges,
  cs.flagged_charges,
  cs.duplicate_window_charges,
  cs.charges_7d,
  (cs.total_cents::numeric/100) AS total_billed_usd,
  (cs.dup_cents::numeric/100) AS duplicate_overcharge_usd,
  cas.acknowledged_count,
  cas.refund_requested_count,
  af.flagged_agents,
  wh.last_charge_at,
  wh.minutes_since_last AS webhook_silent_minutes,
  CASE
    WHEN wh.minutes_since_last IS NULL THEN 'no_data'
    WHEN wh.minutes_since_last < 60 * 24 THEN 'healthy'      -- < 24h
    WHEN wh.minutes_since_last < 60 * 24 * 3 THEN 'stale'     -- < 3 days
    ELSE 'silent'                                              -- 3+ days
  END AS webhook_status
FROM strike_stats ss, charge_stats cs, charge_action_stats cas, agents_flagged af, webhook_health wh;

GRANT SELECT ON v_conduct_command_center TO authenticated;

-- ─── v_strike_trend view — strikes per day for last 30 days ─────────────────
DROP VIEW IF EXISTS v_strike_trend CASCADE;
CREATE VIEW v_strike_trend AS
WITH days AS (
  SELECT generate_series(
    (current_date - interval '29 days')::date,
    current_date,
    interval '1 day'
  )::date AS d
)
SELECT
  d.d AS day,
  count(s.*) FILTER (WHERE s.severity='warning')  AS warnings,
  count(s.*) FILTER (WHERE s.severity='minor')    AS minor,
  count(s.*) FILTER (WHERE s.severity='major')    AS major,
  count(s.*) FILTER (WHERE s.severity='terminal') AS terminal,
  count(s.*) AS total
FROM days d
LEFT JOIN agent_strikes s ON date_trunc('day', s.issued_at)::date = d.d
GROUP BY d.d
ORDER BY d.d;

GRANT SELECT ON v_strike_trend TO authenticated;

-- ─── v_charge_trend view — charges + flagged per day for last 30 days ───────
DROP VIEW IF EXISTS v_charge_trend CASCADE;
CREATE VIEW v_charge_trend AS
WITH days AS (
  SELECT generate_series(
    (current_date - interval '29 days')::date,
    current_date,
    interval '1 day'
  )::date AS d
)
SELECT
  d.d AS day,
  count(c.*) AS total,
  count(c.*) FILTER (WHERE c.flag_name_mismatch OR c.flag_unlinked OR c.flag_unusual_amount OR c.flag_duplicate_window) AS flagged,
  coalesce(sum(c.amount_cents)/100.0, 0) AS billed_usd
FROM days d
LEFT JOIN v_charge_anomalies c ON date_trunc('day', c.charged_at)::date = d.d
GROUP BY d.d
ORDER BY d.d;

GRANT SELECT ON v_charge_trend TO authenticated;

-- ─── v_agent_charge_rollup view — per-agent charge history ──────────────────
DROP VIEW IF EXISTS v_agent_charge_rollup CASCADE;
CREATE VIEW v_agent_charge_rollup AS
SELECT
  resolved_agent_id AS agent_id,
  resolved_agent_name AS agent_name,
  count(*) AS total_charges,
  count(*) FILTER (WHERE flag_name_mismatch OR flag_unlinked OR flag_unusual_amount OR flag_duplicate_window) AS flagged_charges,
  count(*) FILTER (WHERE flag_duplicate_window) AS duplicate_charges,
  (sum(amount_cents)::numeric/100) AS total_billed_usd,
  (sum(amount_cents) FILTER (WHERE flag_duplicate_window)::numeric/100) AS duplicate_amount_usd,
  max(charged_at) AS last_charged_at
FROM v_charge_anomalies
WHERE resolved_agent_id IS NOT NULL
GROUP BY resolved_agent_id, resolved_agent_name;

GRANT SELECT ON v_agent_charge_rollup TO authenticated;

-- ─── v_recent_conduct_events — unified strike + charge feed ─────────────────
-- Used by Conduct Command Center for "what just happened" timeline.
DROP VIEW IF EXISTS v_recent_conduct_events CASCADE;
CREATE VIEW v_recent_conduct_events AS
(
  SELECT
    'strike'::text AS event_type,
    s.id::text     AS event_id,
    s.issued_at    AS occurred_at,
    s.agent_id     AS agent_id,
    COALESCE(ag.display_name, p.full_name, u.email) AS agent_name,
    s.severity::text AS severity_or_flag,
    format('Strike issued: %s', s.reason_code::text) AS title,
    s.description  AS description,
    jsonb_build_object(
      'reason_code', s.reason_code,
      'severity',    s.severity,
      'status',      s.status,
      'expires_at',  s.expires_at
    ) AS detail
  FROM agent_strikes s
  LEFT JOIN agents   ag ON ag.id = s.agent_id
  LEFT JOIN profiles p  ON p.id = ag.profile_id
  LEFT JOIN auth.users u ON u.id = ag.user_id
)
UNION ALL
(
  SELECT
    'charge_anomaly'::text AS event_type,
    c.id::text             AS event_id,
    c.charged_at           AS occurred_at,
    c.resolved_agent_id    AS agent_id,
    c.resolved_agent_name  AS agent_name,
    CASE
      WHEN c.flag_duplicate_window THEN 'duplicate_window'
      WHEN c.flag_name_mismatch    THEN 'name_mismatch'
      WHEN c.flag_unlinked         THEN 'unlinked'
      WHEN c.flag_unusual_amount   THEN 'unusual_amount'
    END AS severity_or_flag,
    format('Charge flag: $%s — %s', c.amount_usd::text, COALESCE(c.customer_name,'(no name)')) AS title,
    coalesce(c.description, '') AS description,
    jsonb_build_object(
      'amount_usd',         c.amount_usd,
      'customer_email',     c.customer_email,
      'stripe_charge_id',   c.stripe_charge_id,
      'flag_name_mismatch', c.flag_name_mismatch,
      'flag_unlinked',      c.flag_unlinked,
      'flag_unusual_amount', c.flag_unusual_amount,
      'flag_duplicate_window', c.flag_duplicate_window
    ) AS detail
  FROM v_charge_anomalies c
  WHERE c.flag_name_mismatch OR c.flag_unlinked OR c.flag_unusual_amount OR c.flag_duplicate_window
);

GRANT SELECT ON v_recent_conduct_events TO authenticated;

-- ─── Add to supabase_realtime publication for live UI updates ───────────────
-- Wrapped in try/catch since the publication may not exist in some environments.
DO $$
BEGIN
  -- agent_strikes is the strike feed
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='agent_strikes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_strikes';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication not available; skipping';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='charge_review_actions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.charge_review_actions';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication not available; skipping';
END $$;

COMMIT;
