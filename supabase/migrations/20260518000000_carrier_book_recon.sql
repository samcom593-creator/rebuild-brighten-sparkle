-- ═══════════════════════════════════════════════════════════════════════════
-- Carrier Book Reconciliation — 2026-05-18
--
-- Sam: "I'm seeing agents without policy numbers. I'm seeing agents who have
-- deals through carriers we don't use anymore... money I'm just not making."
--
-- Architecture:
--   1. `carrier_policies` — what each carrier portal says happened (source of
--      truth from the carrier's perspective). One row per policy.
--   2. `supported_carriers` — the list of carriers Sam actively writes
--      business with + the rate he's paid. Anything outside this list is a
--      MONEY LEAK flag.
--   3. `v_carrier_book_recon` — joins carrier_policies to internal deals,
--      flags every gap: missing policy #, unsupported carrier, no matching
--      deal logged, premium mismatch, etc.
--   4. `v_carrier_money_leak` — per-agent rollup of how much commission Sam
--      isn't earning because of unsupported-carrier writes.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── supported_carriers config ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supported_carriers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_name text NOT NULL UNIQUE,           -- e.g. "American Home Life"
  short_code   text,                            -- e.g. "AHL"
  is_supported boolean NOT NULL DEFAULT true,
  commission_pct numeric,                       -- 0..1, Sam's contracted rate
  notes        text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supported_carriers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY supported_carriers_admin_all ON supported_carriers
    FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY supported_carriers_authenticated_read ON supported_carriers
    FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed the carriers Sam currently uses (from his paste — adjust later)
INSERT INTO supported_carriers (carrier_name, short_code, is_supported, notes) VALUES
  ('American Home Life',  'AHL', true, 'AMH policy prefix'),
  ('American Amicable',   'AA',  true, 'Numeric/alphanumeric policy nums'),
  ('Mutual of Omaha',     'MOO', true, 'BU policy prefix'),
  ('Royal Neighbors',     'RN',  false, 'FLAGGED — Sam not earning commission here per 2026-05-18 audit'),
  ('Aflac',               'AFL', false, 'FLAGGED — review supported status'),
  ('Transamerica',        'TA',  false, 'FLAGGED — review supported status')
ON CONFLICT (carrier_name) DO NOTHING;

-- ─── carrier_policies — source of truth from each carrier ──────────────────
CREATE TABLE IF NOT EXISTS carrier_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity from carrier
  client_first_name   text,
  client_last_name    text,
  carrier_name        text NOT NULL,
  policy_number       text,                   -- may be NULL (one of the gaps Sam flagged)
  policy_status       text,                   -- raw carrier status
  effective_date      date,
  face_amount         numeric,
  annual_premium      numeric,
  -- Who carrier says wrote it (free text from portal: name OR email)
  agent_raw           text,
  -- Resolved to internal agent
  agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  agent_match_method  text,                   -- 'email' / 'name' / 'manual' / null
  -- Reconciliation
  matched_deal_id     uuid REFERENCES deals(id) ON DELETE SET NULL,
  matched_at          timestamptz,
  flag_no_policy_num  boolean GENERATED ALWAYS AS (policy_number IS NULL OR length(trim(policy_number)) = 0) STORED,
  -- Source tracking
  source              text NOT NULL DEFAULT 'manual_paste',
  source_batch_id     uuid,                   -- groups one paste together
  raw                 jsonb,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_carrier        ON carrier_policies(carrier_name);
CREATE INDEX IF NOT EXISTS idx_cp_policy_num     ON carrier_policies(policy_number) WHERE policy_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_agent_id       ON carrier_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_cp_no_policy      ON carrier_policies(flag_no_policy_num) WHERE flag_no_policy_num;
CREATE INDEX IF NOT EXISTS idx_cp_agent_raw_lc   ON carrier_policies(lower(agent_raw));
CREATE INDEX IF NOT EXISTS idx_cp_batch          ON carrier_policies(source_batch_id);

-- Unique per carrier+policy_number when present (carrier+number is canonical)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_carrier_policy
  ON carrier_policies (carrier_name, policy_number)
  WHERE policy_number IS NOT NULL AND length(trim(policy_number)) > 0;

ALTER TABLE carrier_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY carrier_policies_admin_all ON carrier_policies
    FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY carrier_policies_manager_read ON carrier_policies
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='manager')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY carrier_policies_agent_self ON carrier_policies
    FOR SELECT USING (
      agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION fn_carrier_policies_touch() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cp_touch ON carrier_policies;
CREATE TRIGGER trg_cp_touch BEFORE UPDATE ON carrier_policies
  FOR EACH ROW EXECUTE FUNCTION fn_carrier_policies_touch();

-- ─── Matcher: agent_raw → agent_id ─────────────────────────────────────────
-- Matches by email first, then "LAST/ FIRST" pattern, then "First Last".
CREATE OR REPLACE FUNCTION fn_match_carrier_policy_agents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched integer := 0;
BEGIN
  -- 1. Email match
  UPDATE carrier_policies cp
  SET agent_id = a.id, agent_match_method = 'email', matched_at = now()
  FROM agents a
  JOIN auth.users u ON u.id = a.user_id
  WHERE cp.agent_id IS NULL
    AND cp.agent_raw ILIKE '%@%'
    AND lower(u.email) = lower(trim(cp.agent_raw));
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- 2. "LAST/ FIRST" pattern (American Amicable rendering)
  UPDATE carrier_policies cp
  SET agent_id = a.id, agent_match_method = 'lastfirst', matched_at = now()
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  WHERE cp.agent_id IS NULL
    AND cp.agent_raw LIKE '%/%'
    AND lower(trim(split_part(cp.agent_raw, '/', 2))) = lower(split_part(COALESCE(a.display_name, p.full_name), ' ', 1))
    AND lower(trim(split_part(cp.agent_raw, '/', 1))) = lower(split_part(COALESCE(a.display_name, p.full_name), ' ', -1));

  -- 3. "First Last" exact (case-insensitive) on display_name or profile.full_name
  UPDATE carrier_policies cp
  SET agent_id = a.id, agent_match_method = 'name', matched_at = now()
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  WHERE cp.agent_id IS NULL
    AND cp.agent_raw NOT LIKE '%@%'
    AND cp.agent_raw NOT LIKE '%/%'
    AND lower(trim(cp.agent_raw)) = lower(COALESCE(a.display_name, p.full_name));

  RETURN v_matched;
END $$;

GRANT EXECUTE ON FUNCTION fn_match_carrier_policy_agents() TO authenticated;

-- ─── Reconciliation view ───────────────────────────────────────────────────
DROP VIEW IF EXISTS v_carrier_book_recon CASCADE;
CREATE VIEW v_carrier_book_recon AS
SELECT
  cp.id,
  cp.client_first_name,
  cp.client_last_name,
  cp.carrier_name,
  cp.policy_number,
  cp.policy_status,
  cp.effective_date,
  cp.face_amount,
  cp.annual_premium,
  cp.agent_raw,
  cp.agent_id,
  COALESCE(ag.display_name, p.full_name) AS agent_name,
  cp.matched_deal_id,
  cp.imported_at,
  -- Carrier support
  sc.is_supported AS carrier_is_supported,
  sc.short_code   AS carrier_short_code,
  sc.commission_pct,
  -- Flags
  cp.flag_no_policy_num,
  (sc.is_supported IS NOT TRUE) AS flag_unsupported_carrier,
  (cp.agent_id IS NULL)         AS flag_unmatched_agent,
  (cp.matched_deal_id IS NULL AND cp.policy_number IS NOT NULL) AS flag_no_internal_deal,
  (lower(cp.policy_status) IN ('lapsed','lapse pending','cancelled','withdrawn','declined','not taken')) AS flag_dead_policy,
  -- Approximate lost commission when carrier unsupported
  CASE
    WHEN sc.is_supported IS NOT TRUE AND cp.annual_premium IS NOT NULL
      THEN ROUND(cp.annual_premium * 0.80, 2)   -- assume ~80% would have been earnable
    ELSE 0
  END AS approx_lost_commission_usd
FROM carrier_policies cp
LEFT JOIN supported_carriers sc ON sc.carrier_name = cp.carrier_name
LEFT JOIN agents   ag ON ag.id = cp.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id;

GRANT SELECT ON v_carrier_book_recon TO authenticated;

-- ─── Per-agent money leak rollup ───────────────────────────────────────────
DROP VIEW IF EXISTS v_carrier_money_leak CASCADE;
CREATE VIEW v_carrier_money_leak AS
SELECT
  COALESCE(ag.id::text, 'unmatched:' || cp.agent_raw)             AS agent_key,
  cp.agent_id,
  COALESCE(ag.display_name, p.full_name, cp.agent_raw, 'UNKNOWN') AS agent_name,
  cp.carrier_name,
  count(*)::int AS policy_count,
  count(*) FILTER (WHERE cp.policy_number IS NULL)::int AS no_policy_num_count,
  count(*) FILTER (WHERE lower(cp.policy_status) IN ('lapsed','lapse pending','cancelled','withdrawn','declined','not taken'))::int AS dead_count,
  COALESCE(sum(cp.annual_premium), 0)::numeric AS total_premium,
  COALESCE(sum(cp.annual_premium) FILTER (WHERE lower(cp.policy_status) NOT IN ('lapsed','lapse pending','cancelled','withdrawn','declined','not taken')), 0)::numeric AS live_premium,
  -- Approximate lost commission on unsupported carriers
  COALESCE(SUM(
    CASE WHEN sc.is_supported IS NOT TRUE AND cp.annual_premium IS NOT NULL
         THEN cp.annual_premium * 0.80 ELSE 0 END
  ), 0)::numeric AS approx_lost_commission_usd,
  COALESCE(sc.is_supported, false) AS carrier_is_supported
FROM carrier_policies cp
LEFT JOIN supported_carriers sc ON sc.carrier_name = cp.carrier_name
LEFT JOIN agents   ag ON ag.id = cp.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id
GROUP BY cp.agent_id, ag.id, ag.display_name, p.full_name, cp.agent_raw, cp.carrier_name, sc.is_supported;

GRANT SELECT ON v_carrier_money_leak TO authenticated;

-- ─── Top-level summary view (for KPI tiles) ────────────────────────────────
DROP VIEW IF EXISTS v_carrier_book_summary CASCADE;
CREATE VIEW v_carrier_book_summary AS
SELECT
  count(*)::int AS total_policies,
  count(DISTINCT carrier_name)::int AS distinct_carriers,
  count(*) FILTER (WHERE flag_no_policy_num)::int AS missing_policy_num,
  count(*) FILTER (WHERE flag_unsupported_carrier)::int AS on_unsupported_carrier,
  count(*) FILTER (WHERE flag_unmatched_agent)::int AS unmatched_agents,
  count(*) FILTER (WHERE flag_no_internal_deal)::int AS no_internal_deal,
  count(*) FILTER (WHERE flag_dead_policy)::int AS dead_policies,
  COALESCE(SUM(annual_premium), 0)::numeric AS total_premium,
  COALESCE(SUM(annual_premium) FILTER (WHERE NOT flag_dead_policy), 0)::numeric AS live_premium,
  COALESCE(SUM(approx_lost_commission_usd), 0)::numeric AS total_lost_commission_usd
FROM v_carrier_book_recon;

GRANT SELECT ON v_carrier_book_summary TO authenticated;

COMMIT;
