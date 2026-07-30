-- 2026-05-22 QA sweep — create views + RPCs the frontend already calls but
-- never had backing definitions (silently failing on /dashboard/stale-recovery,
-- /admin/setup, /dashboard/hall-of-fame, /dashboard/conversion-audit).

-- v_stale_applicants — stale-recovery panel + Sam HQ proxy reference
-- staleness buckets: <24h = fresh (excluded), 24-72h = stale, 72-168h = icy, >168h = cold
CREATE OR REPLACE VIEW public.v_stale_applicants AS
WITH base AS (
  SELECT
    a.id,
    a.first_name,
    a.last_name,
    a.email,
    a.phone,
    a.city,
    a.state,
    a.license_status::text AS license_status,
    a.status::text AS status,
    a.assigned_agent_id,
    a.instagram_handle,
    a.created_at,
    EXTRACT(EPOCH FROM (now() - a.created_at)) / 3600 AS hours_since_application,
    COALESCE(mgr.display_name, '(unassigned)') AS assigned_manager_name,
    NULL::text AS assigned_manager_avatar  -- agents table has no photo column; profile avatar requires nested join
  FROM public.applications a
  LEFT JOIN public.agents mgr ON mgr.id = a.assigned_agent_id
  WHERE a.status NOT IN ('paid','approved','rejected','disqualified','attended','producing')
    AND a.contacted_at IS NULL
    AND a.created_at > now() - INTERVAL '60 days'
)
SELECT
  *,
  CASE
    WHEN hours_since_application BETWEEN 24 AND 72  THEN 'stale'
    WHEN hours_since_application BETWEEN 72 AND 168 THEN 'icy'
    WHEN hours_since_application > 168              THEN 'cold'
    ELSE 'fresh'
  END AS staleness
FROM base
WHERE hours_since_application >= 24;

-- v_application_conversion_funnel — single-row funnel summary for header tile
CREATE OR REPLACE VIEW public.v_application_conversion_funnel AS
SELECT
  count(*)                                                                                AS total,
  count(*) FILTER (WHERE status::text = 'new')                                            AS new_count,
  count(*) FILTER (WHERE contacted_at IS NOT NULL)                                        AS contacted_count,
  count(*) FILTER (WHERE ica_paid_at IS NOT NULL)                                         AS paid_count,
  count(*) FILTER (WHERE qualified_at IS NOT NULL)                                        AS qualified_count,
  count(*) FILTER (WHERE status::text IN ('approved','attended','producing'))             AS approved_count,
  count(*) FILTER (WHERE status::text IN ('rejected','disqualified'))                     AS rejected_count,
  count(*) FILTER (WHERE created_at > now() - INTERVAL '7 days')                          AS last_7d,
  count(*) FILTER (WHERE created_at > now() - INTERVAL '30 days')                         AS last_30d,
  -- conversion percentages, NULL-safe (avoid div-by-zero)
  CASE WHEN count(*) > 0
       THEN round(100.0 * count(*) FILTER (WHERE ica_paid_at IS NOT NULL) / count(*), 1)
       ELSE 0 END                                                                          AS pct_paid_of_total,
  CASE WHEN count(*) > 0
       THEN round(100.0 * count(*) FILTER (WHERE status::text IN ('approved','attended','producing')) / count(*), 1)
       ELSE 0 END                                                                          AS pct_approved_of_total
FROM public.applications;

-- count_unscheduled_agents — admin/setup tile. Returns a single int wrapped
-- in a row Supabase can serialize via maybeSingle().
CREATE OR REPLACE FUNCTION public.count_unscheduled_agents()
RETURNS TABLE (count bigint) LANGUAGE sql STABLE AS $$
  SELECT count(*)::bigint
  FROM public.agents a
  WHERE COALESCE(a.is_inactive, false) = false
    AND COALESCE(a.is_deactivated, false) = false
    AND a.first_appointment_at IS NULL;
$$;

-- sum_plaque_amounts — hall-of-fame footer tile. Returns total plaque $ awarded.
-- Best-effort: looks at agent_plaques table if present, else returns 0.
CREATE OR REPLACE FUNCTION public.sum_plaque_amounts()
RETURNS TABLE (total bigint) LANGUAGE plpgsql STABLE AS $body$
BEGIN
  IF to_regclass('public.agent_plaques') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'SELECT COALESCE(sum(amount), 0)::bigint FROM public.agent_plaques';
  ELSE
    RETURN QUERY SELECT 0::bigint;
  END IF;
END$body$;
