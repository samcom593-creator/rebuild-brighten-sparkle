CREATE OR REPLACE FUNCTION public.landing_live_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    -- 2026-06-18 Sam directive 'fix all this people numbers right'.
    -- BEFORE: counted every non-terminated row as 'active' — included 65 inactive
    -- agents (55 licensed inactive + 10 unlicensed inactive + 2 deactivated +
    -- 1 deactivated-unlicensed = 68 ghost agents inflating 55 truth to 123).
    -- AFTER: status='active' AND NOT is_deactivated AND NOT canonical_agent_id.
    -- Canonical dedup pointers (Mahmod->Moody etc) hide the secondary row so the
    -- same person doesn't count twice.
    --
    -- 2026-10-03 (website-integrity-bot): the June fix caught the ghost shapes
    -- that existed in June. A NEW shape evades all three of its filters. The
    -- Ayro/AgentLink import mints placeholder rows carrying an explicit
    -- agent_code prefix of GHOST_, and they are created status='active',
    -- is_deactivated=false, canonical_agent_id=NULL -- so every one of them was
    -- counted. Measured on this date: 6 such rows (GHOST_AYRO_*), ALL with no
    -- profile_id, no user_id and 0 lifetime deals, one of them literally named
    -- 'snow flake', inflating the number this function publishes on the public
    -- landing page from 71 to 77 (+8.5%). They were minted on three separate
    -- days (09-23, 09-28, 09-30), so this is an ongoing writer, not a one-off
    -- backfill -- which is why the exclusion is a PREDICATE and not a cleanup.
    -- GHOST_ is the importer's own declaration that the row is a placeholder;
    -- it is the most semantically honest operand available. Deliberately NOT
    -- fixed by mutating agents.status: these rows carry upstream deal
    -- attribution, and changing their status to correct a display number would
    -- risk the book to fix a label.
    'active_agents', (
      SELECT count(*)::int
      FROM agents
      WHERE status = 'active'
        AND NOT is_deactivated
        AND canonical_agent_id IS NULL
        AND (agent_code IS NULL OR agent_code NOT LIKE 'GHOST%')
    ),
    'hires_recent',       (SELECT count(*)::int FROM landing_recent_hires()),
    'applications_30d',   (SELECT count(*)::int FROM public.v_applications_real applications WHERE created_at >= now() - interval '30 days'),
    'applications_total', (SELECT count(*)::int FROM public.v_applications_real applications),
    'carriers_partnered', greatest((select count(*)::int from public.carriers where coalesce(is_active,true)), 22),
    'generated_at',       now()
  );
$function$;
