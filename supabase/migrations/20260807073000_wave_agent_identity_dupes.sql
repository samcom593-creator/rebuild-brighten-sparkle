-- wave-agent-identity-dupes — 2026-08-07
--
-- Problem (apex-platform-audit-2026-07-21.md, data-truth / risk medium):
-- production is attributed by agents.al_user_id (AgentLink) and agents.insuracloud_user_id,
-- but neither column has a unique constraint. 8 al_user_id values currently map to 2 agent rows
-- each; 3 of those pairs are BOTH unresolved (no canonical_agent_id):
--   al_user_id 352 -> "KJ Vaughn" + "Kaeden Vaughns"   (both active)
--   al_user_id 582 -> "Grey Bowman" + "Dudley Bowman"  (both active)
--   al_user_id 967 -> "Matthew Anduha" + "MATTHEW ANDUHA"
-- Any join keyed on the AgentLink id attributes the same policies to whichever row matches:
-- silent double-count or wrong producer on the leaderboard / book-of-business.
--
-- wave-100 shipped v_agent_duplicate_candidates + merge_agent_into_canonical, but both key on
-- EXACT display_name, so none of the three pairs above are visible or mergeable — different
-- spellings, same AgentLink identity. This migration:
--   1. widens the view to group on al_user_id / insuracloud_user_id / case-insensitive name
--   2. widens the merge RPC to accept a shared identity key as proof of the same person
--   3. adds a guard trigger so a NEW unresolved identity dup can never be written again
-- Existing dups are grandfathered (the trigger only fires on writes that create/move a key).

-- 1 ────────────────────────────────────────────────────────────────────────────
-- Back-compat: every column wave-100 exposed is preserved (apex-doctor Check #14 reads
-- created_at + group_display_name). New: group_key, dup_reason, display_name,
-- insuracloud_user_id, is_active.
-- dropped rather than replaced: the column list changes (new leading group_key column), and
-- CREATE OR REPLACE VIEW cannot rename or reorder existing columns.
DROP VIEW IF EXISTS public.v_agent_duplicate_candidates;
CREATE VIEW public.v_agent_duplicate_candidates AS
WITH unresolved AS (
  SELECT a.*, lower(btrim(COALESCE(a.display_name, ''))) AS name_key
  FROM public.agents a
  WHERE a.canonical_agent_id IS NULL
),
cand AS (
  SELECT 'display_name'::text AS dup_reason,
         'name:' || u.name_key AS group_key,
         u.display_name        AS group_label,
         u.id                  AS agent_id
  FROM unresolved u
  WHERE u.name_key <> ''
    AND u.name_key IN (
      SELECT name_key FROM unresolved WHERE name_key <> '' GROUP BY name_key HAVING count(*) > 1
    )
  UNION ALL
  SELECT 'al_user_id',
         'al:' || u.al_user_id::text,
         'AgentLink #' || u.al_user_id::text,
         u.id
  FROM unresolved u
  WHERE u.al_user_id IS NOT NULL
    AND u.al_user_id IN (
      SELECT al_user_id FROM unresolved WHERE al_user_id IS NOT NULL GROUP BY al_user_id HAVING count(*) > 1
    )
  UNION ALL
  SELECT 'insuracloud_user_id',
         'ic:' || u.insuracloud_user_id::text,
         'InsuraCloud #' || u.insuracloud_user_id::text,
         u.id
  FROM unresolved u
  WHERE u.insuracloud_user_id IS NOT NULL
    AND u.insuracloud_user_id IN (
      SELECT insuracloud_user_id FROM unresolved WHERE insuracloud_user_id IS NOT NULL
      GROUP BY insuracloud_user_id HAVING count(*) > 1
    )
),
-- one group per agent so a row can't render twice; identity-key dups outrank name dups
-- because they are the ones that actually double-count production.
one_per_agent AS (
  SELECT DISTINCT ON (agent_id) agent_id, dup_reason, group_key, group_label
  FROM cand
  ORDER BY agent_id,
           CASE dup_reason WHEN 'al_user_id' THEN 1 WHEN 'insuracloud_user_id' THEN 2 ELSE 3 END
),
sized AS (
  SELECT o.*, count(*) OVER (PARTITION BY o.group_key) AS group_size
  FROM one_per_agent o
)
SELECT
  s.group_key,
  s.dup_reason,
  s.group_label                                        AS group_display_name,
  a.id                                                 AS agent_id,
  a.agent_code,
  a.display_name,
  a.status,
  a.canonical_agent_id,
  a.al_user_id,
  a.insuracloud_user_id,
  (NOT COALESCE(a.is_deactivated, false))              AS is_active,
  a.created_at,
  (SELECT count(*)::int FROM public.deals d WHERE d.agent_id = a.id)                            AS lifetime_deals,
  (SELECT COALESCE(sum(d.annual_premium), 0)::numeric(12,2) FROM public.deals d WHERE d.agent_id = a.id) AS lifetime_alp,
  (SELECT count(*)::int FROM public.applications app WHERE app.assigned_agent_id = a.id)        AS applications_assigned,
  (SELECT count(*)::int FROM public.applications app WHERE app.referrer_agent_id = a.id)        AS applications_referred,
  (SELECT max(d.created_at) FROM public.deals d WHERE d.agent_id = a.id)                        AS last_deal_at,
  (SELECT count(*)::int FROM public.agents dl WHERE dl.manager_id = a.id)                       AS downline_count,
  (
    (SELECT count(*) FROM public.deals d WHERE d.agent_id = a.id) > 0
    OR (SELECT count(*) FROM public.applications app WHERE app.assigned_agent_id = a.id) > 0
    OR (SELECT count(*) FROM public.agents dl WHERE dl.manager_id = a.id) > 0
    OR a.al_user_id IS NOT NULL
  )                                                                                             AS has_production_signal
FROM sized s
JOIN public.agents a ON a.id = s.agent_id
WHERE s.group_size > 1
ORDER BY s.dup_reason, s.group_key, a.created_at;

COMMENT ON VIEW public.v_agent_duplicate_candidates IS
  'Unresolved agent duplicate pairs awaiting Sam adjudication at /admin/agent-duplicates. '
  'dup_reason = al_user_id | insuracloud_user_id | display_name. Identity-key reasons are the '
  'ones that double-count production, since deals are attributed through the AgentLink id.';

-- 2 ────────────────────────────────────────────────────────────────────────────
-- Merge RPC: a shared identity key is proof of the same person even when the spelling differs
-- ("KJ Vaughn" / "Kaeden Vaughns" both carry al_user_id 352). Admin gate unchanged.
CREATE OR REPLACE FUNCTION public.merge_agent_into_canonical(p_canonical_agent_id uuid, p_dup_agent_id uuid)
RETURNS TABLE(canonical_agent_id uuid, dup_agent_id uuid, dup_set_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_can  public.agents%ROWTYPE;
  v_dup  public.agents%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may merge agent duplicates' USING ERRCODE = '42501';
  END IF;

  IF p_canonical_agent_id = p_dup_agent_id THEN
    RAISE EXCEPTION 'Canonical and dup agent_ids must differ' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_can FROM public.agents WHERE id = p_canonical_agent_id;
  SELECT * INTO v_dup FROM public.agents WHERE id = p_dup_agent_id;

  IF v_can.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'One or both agents not found' USING ERRCODE = '23503';
  END IF;

  IF v_dup.canonical_agent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dup agent already merged into %', v_dup.canonical_agent_id USING ERRCODE = '23505';
  END IF;

  IF v_can.canonical_agent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical agent is itself a dup — pick the canonical from the chain' USING ERRCODE = '22023';
  END IF;

  -- same person proof: matching normalized name, or a shared AgentLink / InsuraCloud identity
  IF NOT (
       lower(btrim(COALESCE(v_can.display_name, ''))) = lower(btrim(COALESCE(v_dup.display_name, '')))
         AND COALESCE(v_can.display_name, '') <> ''
    OR (v_can.al_user_id IS NOT NULL AND v_can.al_user_id = v_dup.al_user_id)
    OR (v_can.insuracloud_user_id IS NOT NULL AND v_can.insuracloud_user_id = v_dup.insuracloud_user_id)
  ) THEN
    RAISE EXCEPTION
      'Agents share no identity: names (%, %) differ and al_user_id (%, %) / insuracloud_user_id (%, %) do not match',
      v_can.display_name, v_dup.display_name,
      v_can.al_user_id, v_dup.al_user_id,
      v_can.insuracloud_user_id, v_dup.insuracloud_user_id
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agents
     SET canonical_agent_id = p_canonical_agent_id,
         updated_at = NOW()
   WHERE id = p_dup_agent_id;

  RETURN QUERY SELECT p_canonical_agent_id, p_dup_agent_id, NOW();
END;
$function$;

-- 3 ────────────────────────────────────────────────────────────────────────────
-- Guard: a NEW unresolved identity dup can never be written again. Existing rows are
-- grandfathered — the check only runs when the write itself sets or moves the key.
CREATE OR REPLACE FUNCTION public.fn_block_new_agent_identity_dup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_clash uuid;
BEGIN
  -- a row explicitly marked as a dup is allowed to keep its twin's identity
  IF NEW.canonical_agent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.al_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.al_user_id IS DISTINCT FROM OLD.al_user_id) THEN
    SELECT id INTO v_clash FROM public.agents
     WHERE al_user_id = NEW.al_user_id
       AND id <> NEW.id
       AND canonical_agent_id IS NULL
       AND COALESCE(is_deactivated, false) = false
     LIMIT 1;
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION
        'al_user_id % already belongs to active agent % — production would double-count. Set canonical_agent_id to merge instead.',
        NEW.al_user_id, v_clash USING ERRCODE = '23505';
    END IF;
  END IF;

  IF NEW.insuracloud_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.insuracloud_user_id IS DISTINCT FROM OLD.insuracloud_user_id) THEN
    SELECT id INTO v_clash FROM public.agents
     WHERE insuracloud_user_id = NEW.insuracloud_user_id
       AND id <> NEW.id
       AND canonical_agent_id IS NULL
       AND COALESCE(is_deactivated, false) = false
     LIMIT 1;
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION
        'insuracloud_user_id % already belongs to active agent % — production would double-count. Set canonical_agent_id to merge instead.',
        NEW.insuracloud_user_id, v_clash USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_new_agent_identity_dup ON public.agents;
CREATE TRIGGER trg_block_new_agent_identity_dup
  BEFORE INSERT OR UPDATE OF al_user_id, insuracloud_user_id, canonical_agent_id ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_new_agent_identity_dup();
