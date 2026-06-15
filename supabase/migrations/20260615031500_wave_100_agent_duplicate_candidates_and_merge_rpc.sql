-- wave-100: Sam-adjudication surface for unresolved same-display_name agent pairs.
-- v_agent_duplicates only shows POST-merge pairs (where canonical_agent_id is set).
-- v_agent_duplicate_candidates surfaces PRE-merge pairs so /admin/agent-duplicates
-- can show Sam the row-by-row production stats and let him click Merge.
-- Wave-93+ canonicalized views (v_agent_canonical_map + 25 production-side views)
-- auto-collapse downstream once canonical_agent_id is set.

CREATE OR REPLACE VIEW public.v_agent_duplicate_candidates AS
WITH dup_groups AS (
  SELECT display_name
  FROM public.agents
  WHERE display_name IS NOT NULL AND display_name <> ''
  GROUP BY display_name
  HAVING COUNT(*) > 1
     AND COUNT(*) FILTER (WHERE canonical_agent_id IS NULL) > 1
)
SELECT
  a.display_name                                                      AS group_display_name,
  a.id                                                                AS agent_id,
  a.agent_code,
  a.status,
  a.canonical_agent_id,
  a.al_user_id,
  a.created_at,
  (SELECT COUNT(*)::int FROM public.deals d WHERE d.agent_id = a.id)  AS lifetime_deals,
  (SELECT COALESCE(SUM(d.annual_premium),0)::numeric(12,2)
     FROM public.deals d WHERE d.agent_id = a.id)                     AS lifetime_alp,
  (SELECT COUNT(*)::int FROM public.applications app
     WHERE app.assigned_agent_id = a.id)                              AS applications_assigned,
  (SELECT COUNT(*)::int FROM public.applications app
     WHERE app.referrer_agent_id = a.id)                              AS applications_referred,
  (SELECT MAX(d.created_at) FROM public.deals d WHERE d.agent_id = a.id) AS last_deal_at,
  (SELECT COUNT(*)::int FROM public.agents downline
     WHERE downline.manager_id = a.id)                                AS downline_count,
  (CASE
     WHEN (SELECT COUNT(*) FROM public.deals d WHERE d.agent_id = a.id) > 0
       OR (SELECT COUNT(*) FROM public.applications app WHERE app.assigned_agent_id = a.id) > 0
       OR (SELECT COUNT(*) FROM public.agents downline WHERE downline.manager_id = a.id) > 0
       OR a.al_user_id IS NOT NULL
     THEN TRUE ELSE FALSE
   END)                                                               AS has_production_signal
FROM public.agents a
WHERE a.display_name IN (SELECT display_name FROM dup_groups)
  AND a.canonical_agent_id IS NULL
ORDER BY a.display_name, a.created_at;

ALTER VIEW public.v_agent_duplicate_candidates SET (security_invoker = true);

COMMENT ON VIEW public.v_agent_duplicate_candidates IS
  'wave-100: unresolved same-display_name agent pairs awaiting Sam adjudication on /admin/agent-duplicates. Pairs surface here when there are 2+ agents.display_name matches AND at least 2 of them have canonical_agent_id IS NULL.';

CREATE OR REPLACE FUNCTION public.merge_agent_into_canonical(
  p_canonical_agent_id uuid,
  p_dup_agent_id       uuid
)
RETURNS TABLE(
  canonical_agent_id uuid,
  dup_agent_id       uuid,
  dup_set_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_display text;
  v_dup_display       text;
  v_dup_existing      uuid;
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

  SELECT display_name INTO v_canonical_display FROM public.agents WHERE id = p_canonical_agent_id;
  SELECT display_name, canonical_agent_id INTO v_dup_display, v_dup_existing FROM public.agents WHERE id = p_dup_agent_id;

  IF v_canonical_display IS NULL OR v_dup_display IS NULL THEN
    RAISE EXCEPTION 'One or both agents not found' USING ERRCODE = '23503';
  END IF;

  IF v_canonical_display <> v_dup_display THEN
    RAISE EXCEPTION 'Display names must match (canonical=%, dup=%)', v_canonical_display, v_dup_display USING ERRCODE = '22023';
  END IF;

  IF v_dup_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Dup agent already merged into %', v_dup_existing USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.agents WHERE id = p_canonical_agent_id AND canonical_agent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Canonical agent is itself a dup -- pick the canonical from the chain' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agents
     SET canonical_agent_id = p_canonical_agent_id,
         updated_at = NOW()
   WHERE id = p_dup_agent_id;

  RETURN QUERY SELECT p_canonical_agent_id, p_dup_agent_id, NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.merge_agent_into_canonical(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_agent_into_canonical(uuid, uuid) TO authenticated;
