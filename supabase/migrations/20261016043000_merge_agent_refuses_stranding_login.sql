-- PL-WIB-MERGE-DIRECTION: merge_agent_into_canonical() refuses to merge the row a
-- person logs in with into a row nobody logs in with.
--
-- Merging sets canonical_agent_id on the dup. agents.user_id stays where it was,
-- and useScriptsUnlocked, interviews-pipeline and add-agent all look the login up
-- with `canonical_agent_id IS NULL`. Merge the login row away and those lookups
-- find nothing, while the canonical-mapped production views roll his book up to a
-- row he cannot sign in as.
--
-- /admin/agent-duplicates proposes the login row first (src/lib/agentDuplicateWinner.ts),
-- but that is one caller's ordering. The RPC accepted either direction, so the
-- hole was only closed for the page that happens to sort correctly. On the live
-- pair (Tyler Krejcha) the no-login ghost row holds $14,354 canonical ALP against
-- $1,411 on the login row, so any caller that ranks by production picks the wrong
-- winner.
--
-- Refused only when the reverse direction is strictly better: dup has a login and
-- canonical has none. Two rows that BOTH hold a login strand one account whichever
-- way they merge, so that case is left to the admin rather than made unmergeable.
-- "Has a login" is `user_id IS NOT NULL`, the same expression as
-- v_agent_duplicate_candidates.has_login, so the page and the RPC cannot disagree.
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

  IF v_dup.user_id IS NOT NULL AND v_can.user_id IS NULL THEN
    RAISE EXCEPTION
      'Refusing to merge % (%) into % (%): the row being merged away is the one this person logs in with, and the row it would merge into has no login. Merge the other way: keep % as canonical.',
      COALESCE(v_dup.display_name, 'the duplicate'), v_dup.id,
      COALESCE(v_can.display_name, 'the canonical row'), v_can.id,
      v_dup.id
      USING ERRCODE = '22023';
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
