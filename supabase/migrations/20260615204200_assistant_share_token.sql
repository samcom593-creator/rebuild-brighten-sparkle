-- 20260615204200_assistant_share_token.sql
--
-- Assistant share-link tokens — Sam directive 2026-06-15:
-- Sam wants a public URL he can text to his assistant. The assistant fills out
-- an interview form, an interview row gets added to manual_interview_entries
-- under Sam's user_id, and a one-tap "Add to Google Calendar" link is shown.
--
-- Token table is admin-scoped (RLS); only the edge fn (service-role) validates
-- and writes via the token. Token is opaque hex (32 bytes = 64 chars).
--
-- assistant_token_id on manual_interview_entries marks provenance so Sam can
-- see "added by assistant via share link" vs added directly in admin UI.

CREATE TABLE IF NOT EXISTS public.assistant_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  label text NOT NULL DEFAULT 'Assistant interview share link',
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.assistant_share_tokens IS
  'Opaque share tokens for the public /assistant/interviews form. Validated by the assistant-add-interview edge fn (service-role bypass). Admin manages via RLS.';

CREATE INDEX IF NOT EXISTS assistant_share_tokens_owner_idx
  ON public.assistant_share_tokens (owner_user_id);

CREATE INDEX IF NOT EXISTS assistant_share_tokens_active_idx
  ON public.assistant_share_tokens (is_active) WHERE is_active = true;

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.assistant_share_tokens ENABLE ROW LEVEL SECURITY;

-- Owner + admin can read
DROP POLICY IF EXISTS assistant_share_tokens_select
  ON public.assistant_share_tokens;
CREATE POLICY assistant_share_tokens_select
  ON public.assistant_share_tokens
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR owner_user_id = auth.uid()
  );

-- Admin can write
DROP POLICY IF EXISTS assistant_share_tokens_all
  ON public.assistant_share_tokens;
CREATE POLICY assistant_share_tokens_all
  ON public.assistant_share_tokens
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT ON public.assistant_share_tokens TO authenticated;
GRANT ALL ON public.assistant_share_tokens TO service_role;

-- Provenance column on manual_interview_entries
ALTER TABLE public.manual_interview_entries
  ADD COLUMN IF NOT EXISTS assistant_token_id uuid
  REFERENCES public.assistant_share_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS manual_interview_entries_assistant_token_idx
  ON public.manual_interview_entries (assistant_token_id)
  WHERE assistant_token_id IS NOT NULL;

-- Seed Sam's first token (idempotent via WHERE NOT EXISTS — token UNIQUE default
-- generates a fresh value each call, so we guard on label match instead).
INSERT INTO public.assistant_share_tokens (owner_user_id, label)
SELECT '811fc5f4-05f4-446e-a916-445ce7fd051f'::uuid,
       'Sam James assistant intake · 2026-06-15'
WHERE NOT EXISTS (
  SELECT 1 FROM public.assistant_share_tokens
  WHERE owner_user_id = '811fc5f4-05f4-446e-a916-445ce7fd051f'::uuid
    AND label = 'Sam James assistant intake · 2026-06-15'
);
