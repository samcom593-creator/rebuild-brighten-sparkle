-- 2026-05-16 — Full-fidelity agent PII + binary doc vault
--
-- Sam owns this data and has every legal right to retain a copy of it
-- inside the agency CRM. AgentLink's own UI shows the same fields to him
-- when he logs in as admin. Server-side RLS keeps it admin-only.
--
-- Columns added to agentlink_agents capture every non-binary field
-- AgentLink exposes per agent: SSN ciphertext + last4 + hash (the full
-- SSN is encrypted upstream — only the ciphertext is reachable),
-- password hash, Google Calendar tokens, residence + mailing addresses,
-- producer type, EIN, contract count, team size, joined date, etc.
--
-- agentlink_binary_docs stores compliance PDFs / JPEGs (banking,
-- driver's license, E&O cert, certificate of completion) as base64 in a
-- single text column. Keeps the data in Postgres (one source of truth,
-- one RLS policy) without standing up a separate storage bucket tonight.

BEGIN;

-- ─── Extra agent fields (idempotent) ───────────────────────────────────────
ALTER TABLE public.agentlink_agents
  ADD COLUMN IF NOT EXISTS ssn_ciphertext text,
  ADD COLUMN IF NOT EXISTS ssn_last4 text,
  ADD COLUMN IF NOT EXISTS ssn_hash text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS google_calendar_access_token text,
  ADD COLUMN IF NOT EXISTS google_calendar_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_calendar_calendar_id text,
  ADD COLUMN IF NOT EXISTS google_calendar_connected boolean,
  ADD COLUMN IF NOT EXISTS google_calendar_token_expiry timestamptz,
  ADD COLUMN IF NOT EXISTS google_calendar_scope_granted text,
  ADD COLUMN IF NOT EXISTS google_calendar_selected_ids jsonb,
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS producer_type text,
  ADD COLUMN IF NOT EXISTS entity_name text,
  ADD COLUMN IF NOT EXISTS entity_ein text,
  ADD COLUMN IF NOT EXISTS residence_address text,
  ADD COLUMN IF NOT EXISTS residence_city text,
  ADD COLUMN IF NOT EXISTS residence_state text,
  ADD COLUMN IF NOT EXISTS residence_zip text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS vendor_id text,
  ADD COLUMN IF NOT EXISTS messaging_wallet_balance numeric,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_reason text,
  ADD COLUMN IF NOT EXISTS lead_states jsonb,
  ADD COLUMN IF NOT EXISTS contract_count int,
  ADD COLUMN IF NOT EXISTS team_size int,
  ADD COLUMN IF NOT EXISTS joined_date date,
  ADD COLUMN IF NOT EXISTS oauth_provider text,
  ADD COLUMN IF NOT EXISTS oauth_id text,
  ADD COLUMN IF NOT EXISTS selected_calling_card_id text,
  ADD COLUMN IF NOT EXISTS pending_wallet_session text,
  ADD COLUMN IF NOT EXISTS contracts_inline jsonb;

-- ─── Binary documents vault ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agentlink_binary_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid REFERENCES public.agents(id),
  insuracloud_user_id int,
  endpoint      text NOT NULL,
  doc_kind      text NOT NULL,
  content_type  text,
  byte_size     int,
  payload_hash  text,
  payload_b64   text,        -- base64-encoded blob (PDF / JPEG / etc.)
  captured_at   timestamptz DEFAULT now(),
  raw_filename  text
);
CREATE INDEX IF NOT EXISTS idx_albd_agent ON public.agentlink_binary_docs (agent_id);
CREATE INDEX IF NOT EXISTS idx_albd_kind  ON public.agentlink_binary_docs (doc_kind);

ALTER TABLE public.agentlink_binary_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS al_bin_admin ON public.agentlink_binary_docs;
CREATE POLICY al_bin_admin ON public.agentlink_binary_docs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.agentlink_binary_docs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agentlink_binary_docs TO authenticated;

-- ─── Re-apply RLS on previously-created vault tables (idempotent) ──────────
ALTER TABLE public.agentlink_agents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentlink_clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentlink_contracts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentlink_raw_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS al_agents_admin    ON public.agentlink_agents;
DROP POLICY IF EXISTS al_clients_admin   ON public.agentlink_clients;
DROP POLICY IF EXISTS al_contracts_admin ON public.agentlink_contracts;
DROP POLICY IF EXISTS al_vault_admin     ON public.agentlink_raw_exports;

CREATE POLICY al_agents_admin ON public.agentlink_agents
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY al_clients_admin ON public.agentlink_clients
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY al_contracts_admin ON public.agentlink_contracts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY al_vault_admin ON public.agentlink_raw_exports
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.agentlink_agents    TO authenticated;
GRANT SELECT ON public.agentlink_clients   TO authenticated;
GRANT SELECT ON public.agentlink_contracts TO authenticated;
GRANT SELECT ON public.agentlink_raw_exports TO authenticated;

COMMIT;
