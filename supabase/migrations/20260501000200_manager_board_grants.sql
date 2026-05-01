-- Per-manager admin-board access grants. Sam 2026-05-01: "give me a
-- function to give some managers access to every board. So any board,
-- if it's a board that's just for admin, give me a button manager
-- because there's hierarchies — some managers should get more access."
--
-- Pattern: manager_board_grants junction table + has_board_access(uid,key)
-- RPC + useBoardAccess hook in React. Pages opt in via the hook;
-- ProtectedRoute can also gate by board_key. Admin assigns grants from
-- /dashboard/admin/board-access.
CREATE TABLE IF NOT EXISTS public.manager_board_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  board_key text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (manager_user_id, board_key)
);

ALTER TABLE public.manager_board_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all board grants" ON public.manager_board_grants;
CREATE POLICY "Admins manage all board grants" ON public.manager_board_grants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Managers see own grants" ON public.manager_board_grants;
CREATE POLICY "Managers see own grants" ON public.manager_board_grants
  FOR SELECT TO authenticated
  USING (manager_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_board_access(_user_id uuid, _board_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM public.manager_board_grants
    WHERE manager_user_id = _user_id AND board_key = _board_key
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_board_access(uuid, text) TO authenticated;
