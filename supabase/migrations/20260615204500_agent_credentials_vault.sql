-- 2026-06-15 — Agent credential vault for ReadyMode / InsuraCloud / etc.
--
-- Goal: Sam (admin) needs to see, copy, edit, and reset every agent's
-- ReadyMode (and other third-party) login credentials from /dashboard/crm.
-- Passwords sit at rest encrypted with pgcrypto symmetric cipher whose key
-- lives in supabase_vault — they leave the database only when an admin
-- calls a SECURITY DEFINER RPC. RLS hard-blocks every other reader.
--
-- Surface: src/pages/DashboardCRM.tsx "Access & Credentials" panel.

-- ─── Vault key for password symmetric cipher ─────────────────────────────
DO $$
DECLARE
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'agent_credentials_key' LIMIT 1;
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'agent_credentials_key',
      'Symmetric key for agent_credentials.password_encrypted (pgcrypto pgp_sym_*)');
  END IF;
END $$;

-- ─── Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  service         text NOT NULL CHECK (service IN ('readymode','insuracloud','agentlink','xcel','other')),
  username        text,
  password_encrypted bytea,
  notes           text,
  updated_by      uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, service)
);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent ON public.agent_credentials(agent_id);

-- ─── RLS — admin-only by default; service_role implicit bypass. ──────────
ALTER TABLE public.agent_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_credentials_admin_all"  ON public.agent_credentials;
CREATE POLICY "agent_credentials_admin_all"
  ON public.agent_credentials
  FOR ALL
  TO authenticated
  USING      (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Explicitly deny everyone else. (Default-deny under RLS, but spell it out
-- so a future migration that flips a policy doesn't quietly expose passwords.)

REVOKE ALL ON public.agent_credentials FROM PUBLIC;
REVOKE ALL ON public.agent_credentials FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.agent_credentials TO authenticated;

-- ─── updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_touch_agent_credentials_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_agent_credentials_updated_at ON public.agent_credentials;
CREATE TRIGGER trg_touch_agent_credentials_updated_at
  BEFORE UPDATE ON public.agent_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_agent_credentials_updated_at();

-- ─── Helper — fetch the symmetric key from vault. ────────────────────────
-- SECURITY DEFINER + admin gate; never exposed to clients.
CREATE OR REPLACE FUNCTION public._agent_credentials_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'agent_credentials_key'
   LIMIT 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'agent_credentials key not initialised in vault.secrets';
  END IF;
  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public._agent_credentials_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._agent_credentials_key() FROM anon, authenticated;

-- ─── RPCs ────────────────────────────────────────────────────────────────
-- All four are SECURITY DEFINER and gate on has_role(auth.uid(),'admin').
-- Sam IS the admin; managers + agents cannot read passwords.

-- 1) Upsert a credential.
CREATE OR REPLACE FUNCTION public.agent_credentials_upsert(
  p_agent_id uuid,
  p_service  text,
  p_username text,
  p_password text,           -- NULL = leave password unchanged
  p_notes    text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_key text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'agent_credentials_upsert: admin only';
  END IF;
  IF p_service NOT IN ('readymode','insuracloud','agentlink','xcel','other') THEN
    RAISE EXCEPTION 'agent_credentials_upsert: invalid service %', p_service;
  END IF;

  IF p_password IS NOT NULL AND length(p_password) > 0 THEN
    v_key := public._agent_credentials_key();
  END IF;

  INSERT INTO public.agent_credentials (agent_id, service, username, password_encrypted, notes, updated_by)
  VALUES (
    p_agent_id,
    p_service,
    NULLIF(p_username, ''),
    CASE WHEN p_password IS NOT NULL AND length(p_password) > 0
         THEN pgp_sym_encrypt(p_password, v_key)
         ELSE NULL END,
    NULLIF(p_notes, ''),
    auth.uid()
  )
  ON CONFLICT (agent_id, service) DO UPDATE
     SET username           = COALESCE(NULLIF(EXCLUDED.username, ''), public.agent_credentials.username),
         password_encrypted = CASE
           WHEN EXCLUDED.password_encrypted IS NOT NULL THEN EXCLUDED.password_encrypted
           ELSE public.agent_credentials.password_encrypted
         END,
         notes              = COALESCE(EXCLUDED.notes, public.agent_credentials.notes),
         updated_by         = auth.uid(),
         updated_at         = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_credentials_upsert(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_credentials_upsert(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_credentials_upsert(uuid, text, text, text, text) TO authenticated;

-- 2) Reveal a single credential (admin-gated).
CREATE OR REPLACE FUNCTION public.agent_credentials_reveal(
  p_agent_id uuid,
  p_service  text
) RETURNS TABLE (
  username    text,
  password    text,
  notes       text,
  updated_at  timestamptz,
  updated_by  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'agent_credentials_reveal: admin only';
  END IF;
  v_key := public._agent_credentials_key();

  RETURN QUERY
    SELECT
      c.username,
      CASE WHEN c.password_encrypted IS NULL THEN NULL
           ELSE pgp_sym_decrypt(c.password_encrypted, v_key) END AS password,
      c.notes,
      c.updated_at,
      c.updated_by
    FROM public.agent_credentials c
    WHERE c.agent_id = p_agent_id
      AND c.service  = p_service
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_credentials_reveal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_credentials_reveal(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_credentials_reveal(uuid, text) TO authenticated;

-- 3) List credential metadata for one agent (admin-gated). NEVER returns password plaintext.
CREATE OR REPLACE FUNCTION public.agent_credentials_list(p_agent_id uuid)
RETURNS TABLE (
  service      text,
  username     text,
  has_password boolean,
  notes        text,
  updated_at   timestamptz,
  updated_by   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'agent_credentials_list: admin only';
  END IF;
  RETURN QUERY
    SELECT
      c.service,
      c.username,
      (c.password_encrypted IS NOT NULL) AS has_password,
      c.notes,
      c.updated_at,
      c.updated_by
    FROM public.agent_credentials c
    WHERE c.agent_id = p_agent_id
    ORDER BY c.service;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_credentials_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_credentials_list(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_credentials_list(uuid) TO authenticated;

-- 4) Coverage summary — counts credentials by service for the team hero.
CREATE OR REPLACE FUNCTION public.agent_credentials_coverage()
RETURNS TABLE (
  service       text,
  agents_count  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'agent_credentials_coverage: admin only';
  END IF;
  RETURN QUERY
    SELECT c.service, COUNT(*)::int
    FROM public.agent_credentials c
    WHERE c.password_encrypted IS NOT NULL
    GROUP BY c.service
    ORDER BY c.service;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_credentials_coverage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_credentials_coverage() FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_credentials_coverage() TO authenticated;

COMMENT ON TABLE public.agent_credentials IS
  '2026-06-15 — Per-agent third-party credentials (ReadyMode/InsuraCloud/AgentLink/etc.). password_encrypted is pgp_sym_encrypt(text, vault.agent_credentials_key). Read/write via SECURITY DEFINER RPCs; clients never touch the table directly.';
