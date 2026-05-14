-- 2026-05-14 — Shared visibility helpers
--
-- Codex audit C2: today every page filters applications on a different
-- column (assigned_agent_id, referral_manager_id, recruiter_id,
-- hiring_manager_user_id). One shared predicate keeps it consistent and
-- means a future column addition is a one-line change.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- Returns TRUE if the application row should be visible to `p_user_id`.
-- Treats any of the 4 attribution columns as authoritative. Admins see all.
CREATE OR REPLACE FUNCTION public.app_visible_to(
  p_user_id uuid,
  p_application_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = p_application_id
      AND (
        public.has_role(p_user_id, 'admin'::app_role)
        OR a.hiring_manager_user_id = p_user_id
        OR a.assigned_agent_id     IN (SELECT id FROM public.agents WHERE user_id = p_user_id)
        OR a.referral_manager_id    IN (SELECT id FROM public.agents WHERE user_id = p_user_id)
        OR a.recruiter_id           IN (SELECT id FROM public.agents WHERE user_id = p_user_id)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.app_visible_to(uuid, uuid) TO authenticated;

-- Returns the set of application IDs the caller can see. Useful as a fast
-- IN-subselect filter from any client query and as a single source of truth.
CREATE OR REPLACE FUNCTION public.my_visible_applications()
RETURNS TABLE(application_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id
  FROM public.applications a
  WHERE
    public.has_role(auth.uid(), 'admin'::app_role)
    OR a.hiring_manager_user_id = auth.uid()
    OR a.assigned_agent_id     IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
    OR a.referral_manager_id    IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
    OR a.recruiter_id           IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
    -- Managers also see anything assigned to one of their direct invitees.
    OR (public.has_role(auth.uid(), 'manager'::app_role)
        AND (
          a.assigned_agent_id   IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
          OR a.referral_manager_id IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.my_visible_applications() TO authenticated;

-- A view variant for easy joins in dashboards.
CREATE OR REPLACE VIEW public.v_my_applications AS
SELECT a.*
FROM public.applications a
WHERE
  public.has_role(auth.uid(), 'admin'::app_role)
  OR a.hiring_manager_user_id = auth.uid()
  OR a.assigned_agent_id     IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR a.referral_manager_id    IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR a.recruiter_id           IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR (public.has_role(auth.uid(), 'manager'::app_role)
      AND (
        a.assigned_agent_id   IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
        OR a.referral_manager_id IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
      )
  );

GRANT SELECT ON public.v_my_applications TO authenticated;

COMMIT;
