-- 2026-05-16 — AgentLink data vault + normalized mirror tables
--
-- These tables back the agency-wide data rescue. Built and populated live
-- via bot-sql first, then captured here so CI / fresh environments can
-- recreate them. Every CREATE is IF NOT EXISTS, every grant idempotent.
--
-- Source of truth model:
--   public.deals + public.carriers   = normalized business records (existing tables)
--   public.agentlink_clients         = pipeline_client_id-keyed mirror, one row per client
--   public.agentlink_contracts       = writing-number + commission-level mirror
--   public.agentlink_agents          = downline mirror (passwords/SSN/google-token stripped)
--   public.agentlink_raw_exports     = audit-grade snapshot of every upstream JSON payload
--
-- Why a raw vault: cookie-pulled endpoints can go silent at any time
-- (cookie expires, AgentLink rotates schema, account scope changes). The
-- vault is the only thing that lets us reconstruct or diff history. Treat
-- it like a read-only ledger: append rows, never edit.

BEGIN;

-- ─── Raw vault ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_raw_exports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at   timestamptz NOT NULL DEFAULT now(),
  endpoint      text NOT NULL,
  method        text NOT NULL DEFAULT 'GET',
  upstream_status int,
  request_meta  jsonb DEFAULT '{}'::jsonb,
  row_count     int,
  payload       jsonb,
  payload_hash  text,
  error_message text,
  sync_run_id   uuid,
  source        text NOT NULL DEFAULT 'agentlink'
);
CREATE INDEX IF NOT EXISTS idx_alre_endpoint_captured ON public.agentlink_raw_exports (endpoint, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_alre_sync_run          ON public.agentlink_raw_exports (sync_run_id);

REVOKE ALL ON public.agentlink_raw_exports FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.agentlink_raw_exports TO service_role;

-- ─── Clients mirror ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_clients (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insuracloud_pipeline_client_id  int UNIQUE,
  agent_id                        uuid REFERENCES public.agents(id),
  insuracloud_user_id             int,
  first_name      text,
  last_name       text,
  phone           text,
  date_of_birth   date,
  email           text,
  state           text,
  city            text,
  zip_code        text,
  street_address  text,
  pipeline_stage  text,
  raw_payload     jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alc_agent         ON public.agentlink_clients (agent_id);
CREATE INDEX IF NOT EXISTS idx_alc_upstream_user ON public.agentlink_clients (insuracloud_user_id);

REVOKE ALL ON public.agentlink_clients FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON public.agentlink_clients TO service_role;

-- ─── Contracts / writing-numbers mirror ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_contracts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insuracloud_contract_id    int UNIQUE,
  agent_id                   uuid REFERENCES public.agents(id),
  insuracloud_user_id        int,
  carrier_id                 uuid REFERENCES public.carriers(id),
  insuracloud_carrier_id     int,
  writing_number             text,
  secondary_writing_number   text,
  contract_number            text,
  status                     text,
  commission_level           text,
  commission_level_id        int,
  commission_level_set_at    timestamptz,
  writing_number_since       date,
  activated_date             date,
  requested_at               timestamptz,
  processed_at               timestamptz,
  upline_acknowledged_at     timestamptz,
  notes                      text,
  admin_notes                text,
  raw_payload                jsonb,
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alct_agent   ON public.agentlink_contracts (agent_id);
CREATE INDEX IF NOT EXISTS idx_alct_carrier ON public.agentlink_contracts (carrier_id);
CREATE INDEX IF NOT EXISTS idx_alct_status  ON public.agentlink_contracts (status);

REVOKE ALL ON public.agentlink_contracts FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON public.agentlink_contracts TO service_role;

-- ─── Downline agents mirror (no secrets) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_agents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insuracloud_user_id  int UNIQUE NOT NULL,
  local_agent_id       uuid REFERENCES public.agents(id),
  email                text,
  contact_email        text,
  username             text,
  first_name           text,
  last_name            text,
  middle_initial       text,
  phone_number         text,
  street_address       text,
  city                 text,
  state                text,
  zip_code             text,
  npn_number           text,
  account_status       text,
  is_producer_active   boolean,
  is_admin             boolean,
  organization_id      int,
  upline_user_id       int,
  raw_payload          jsonb,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alag_email ON public.agentlink_agents (lower(email));
CREATE INDEX IF NOT EXISTS idx_alag_local ON public.agentlink_agents (local_agent_id);

REVOKE ALL ON public.agentlink_agents FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.agentlink_agents TO service_role;

COMMIT;
