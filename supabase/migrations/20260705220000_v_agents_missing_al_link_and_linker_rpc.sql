-- v_agents_missing_al_link + set_agent_al_link RPC
-- Purpose: back /admin/missing-al-link (AdminMissingAlLink.tsx) so Sam can
-- one-tap link agents whose al_user_id is NULL to an agentlink_agents.insuracloud_user_id.
--
-- Bulk email/name auto-link was NOT safe: profiles/applications email <-> agentlink_agents email
-- had 0 matches on the 64 unlinked agents; only 2 exact name matches. Manual linker is the path.
--
-- Already applied to prod via supabase MCP apply_migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP VIEW IF EXISTS public.v_agents_missing_al_link CASCADE;

CREATE VIEW public.v_agents_missing_al_link AS
WITH base AS (
  SELECT
    a.id AS agent_id,
    a.display_name,
    NULLIF(TRIM(COALESCE(p.full_name,'')), '') AS full_name,
    COALESCE(p.email, apps.email) AS email,
    a.license_status::text AS license_status,
    a.status::text AS status,
    a.onboarding_stage::text AS onboarding_stage,
    a.created_at,
    GREATEST(0, EXTRACT(EPOCH FROM (now() - a.created_at))/86400)::int AS days_since_created,
    mp.full_name AS manager_name,
    LOWER(TRIM(COALESCE(NULLIF(a.display_name,''), p.full_name, ''))) AS name_key
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  LEFT JOIN applications apps ON apps.id = a.source_application_id
  LEFT JOIN agents m ON m.id = a.manager_id
  LEFT JOIN profiles mp ON mp.id = m.profile_id
  WHERE a.al_user_id IS NULL
    AND a.canonical_agent_id IS NULL
    AND COALESCE(a.is_inactive, false) = false
    AND COALESCE(a.is_deactivated, false) = false
),
scored AS (
  SELECT
    b.agent_id,
    ala.insuracloud_user_id,
    TRIM(COALESCE(ala.first_name,'') || ' ' || COALESCE(ala.last_name,'')) AS al_name,
    GREATEST(
      CASE WHEN b.name_key <> '' THEN similarity(LOWER(TRIM(COALESCE(ala.first_name,'') || ' ' || COALESCE(ala.last_name,''))), b.name_key) ELSE 0 END,
      CASE WHEN b.email IS NOT NULL AND (LOWER(ala.email)=LOWER(b.email) OR LOWER(ala.contact_email)=LOWER(b.email)) THEN 1.0 ELSE 0 END
    ) AS sim
  FROM base b
  CROSS JOIN agentlink_agents ala
  WHERE ala.insuracloud_user_id IS NOT NULL
),
ranked AS (
  SELECT agent_id, insuracloud_user_id, al_name, sim,
         ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY sim DESC) AS rn
  FROM scored
  WHERE sim >= 0.35
),
suggestions AS (
  SELECT
    agent_id,
    jsonb_agg(
      jsonb_build_object(
        'downline_external_id', insuracloud_user_id::text,
        'downline_name', al_name,
        'similarity', ROUND(sim::numeric, 3)
      )
      ORDER BY sim DESC
    ) AS suggested_matches
  FROM ranked
  WHERE rn <= 5
  GROUP BY agent_id
)
SELECT
  b.agent_id,
  b.display_name,
  b.full_name,
  b.email,
  b.license_status,
  b.status,
  b.onboarding_stage,
  b.created_at,
  b.days_since_created,
  b.manager_name,
  COALESCE(sug.suggested_matches, '[]'::jsonb) AS suggested_matches
FROM base b
LEFT JOIN suggestions sug ON sug.agent_id = b.agent_id
ORDER BY (b.license_status = 'licensed') DESC, b.created_at DESC;

GRANT SELECT ON public.v_agents_missing_al_link TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_agent_al_link(p_agent_id uuid, p_al_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('admin','manager','super_admin','owner')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_al_id IS NULL OR p_al_id <= 0 THEN
    RAISE EXCEPTION 'al_id must be positive';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agents
    WHERE al_user_id = p_al_id
      AND id <> p_agent_id
      AND COALESCE(is_deactivated,false) = false
  ) THEN
    RAISE EXCEPTION 'al_user_id % already linked to another active agent', p_al_id;
  END IF;

  UPDATE public.agents
    SET al_user_id = p_al_id,
        insuracloud_user_id = COALESCE(insuracloud_user_id, p_al_id),
        updated_at = now()
  WHERE id = p_agent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent % not found', p_agent_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_agent_al_link(uuid, int) TO authenticated;
