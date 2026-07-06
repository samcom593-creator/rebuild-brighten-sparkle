-- =====================================================================
-- v_content_utm_analytics
-- Content attribution: aggregate applications by utm_source with
-- 7d + 30d application counts, plus 7d licensed + hired conversions.
--
-- Definitions:
--   applications_7d  = applications.created_at within last 7 days
--   applications_30d = applications.created_at within last 30 days
--   licensed_7d      = applications.licensed_at within last 7 days
--   hired_7d         = applications.contracted_at within last 7 days
--                      (contracted_at is the hire signal — the enum has no
--                       'hired' status; promote_applicant_to_agent stamps
--                       contracted_at when an applicant becomes an agent)
--
-- utm_source NULLs are bucketed as '(none)' so unattributed volume is
-- still visible in dashboards. Rows are ordered by 30d volume desc.
-- =====================================================================

DROP VIEW IF EXISTS public.v_content_utm_analytics CASCADE;

CREATE VIEW public.v_content_utm_analytics AS
SELECT
  COALESCE(NULLIF(TRIM(a.utm_source), ''), '(none)') AS utm_source,
  COUNT(*) FILTER (
    WHERE a.created_at >= NOW() - INTERVAL '7 days'
  )::bigint AS applications_7d,
  COUNT(*) FILTER (
    WHERE a.created_at >= NOW() - INTERVAL '30 days'
  )::bigint AS applications_30d,
  COUNT(*) FILTER (
    WHERE a.licensed_at IS NOT NULL
      AND a.licensed_at >= NOW() - INTERVAL '7 days'
  )::bigint AS licensed_7d,
  COUNT(*) FILTER (
    WHERE a.contracted_at IS NOT NULL
      AND a.contracted_at >= NOW() - INTERVAL '7 days'
  )::bigint AS hired_7d
FROM public.applications a
WHERE
  a.created_at >= NOW() - INTERVAL '30 days'
  OR (a.licensed_at IS NOT NULL AND a.licensed_at >= NOW() - INTERVAL '7 days')
  OR (a.contracted_at IS NOT NULL AND a.contracted_at >= NOW() - INTERVAL '7 days')
GROUP BY 1
ORDER BY applications_30d DESC, utm_source ASC;

COMMENT ON VIEW public.v_content_utm_analytics IS
  'Content UTM attribution: applications (7d, 30d) + licensed_7d + hired_7d per utm_source. NULL utm_source bucketed as (none). Hire signal = contracted_at.';

GRANT SELECT ON public.v_content_utm_analytics TO authenticated, service_role;
