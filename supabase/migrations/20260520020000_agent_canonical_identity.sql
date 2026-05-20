-- Agent identity merge — PL-052
--
-- THE BUG: Sam James has two agent rows (SJAMES01 = canonical, SJAMES02 = orphan
-- with same display_name). Leaderboards + recruiting stats treat them as two
-- different people, splitting the numbers ("1 advance, 0 contracted" instead
-- of the real totals).
--
-- THE FIX (non-destructive): add a self-referencing canonical_agent_id column
-- to agents. Each row points at the canonical version of the same identity
-- (NULL = it IS the canonical). Views + UI queries coalesce id with
-- canonical_agent_id so all stats roll up to one row.
--
-- Built: 2026-05-20. Idempotent.

-- 1) Column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agents' AND column_name='canonical_agent_id'
  ) THEN
    ALTER TABLE public.agents
      ADD COLUMN canonical_agent_id UUID
        REFERENCES public.agents(id) ON DELETE SET NULL;
    COMMENT ON COLUMN public.agents.canonical_agent_id IS
      'Identity merge: NULL = this row IS canonical. Otherwise points at the row that should aggregate stats. Set via fn_set_canonical_agent.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_canonical_agent_id
  ON public.agents(canonical_agent_id) WHERE canonical_agent_id IS NOT NULL;

-- 2) Helper view: every agent → its effective canonical id
DROP VIEW IF EXISTS public.v_agent_canonical_map CASCADE;
CREATE VIEW public.v_agent_canonical_map AS
SELECT
  id AS agent_id,
  COALESCE(canonical_agent_id, id) AS canonical_agent_id
FROM public.agents;

GRANT SELECT ON public.v_agent_canonical_map TO anon, authenticated, service_role;

-- 3) Helper fn: canonicalize a single agent id (used in SQL contexts)
CREATE OR REPLACE FUNCTION public.fn_canonical_agent_id(p_agent_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT COALESCE(canonical_agent_id, id) FROM public.agents WHERE id = p_agent_id;
$$;

-- 4) Apply the known dup: Sam James SJAMES02 → canonical SJAMES01
--    Both rows have display_name='Samuel James'. SJAMES01 has the profile +
--    email info@kingofsales.net. SJAMES02 is the orphan ingested duplicate.
UPDATE public.agents
   SET canonical_agent_id = '7c3c5581-3544-437f-bfe2-91391afb217d'::uuid
 WHERE id = 'cde14d07-2366-444a-80cc-58a8f7da6f95'::uuid
   AND canonical_agent_id IS NULL;

COMMENT ON FUNCTION public.fn_canonical_agent_id IS
'Returns the canonical agent_id for an agent. Used by leaderboards + recruiting stats to merge duplicate identity rows. PL-052.';
