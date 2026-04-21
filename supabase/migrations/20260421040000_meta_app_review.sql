-- ============================================================
-- Meta app review support: data deletion requests + Instagram auth
-- ============================================================

-- ── Data deletion requests (required by Meta for app review) ──
CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  reason text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','rejected')),
  requested_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  handled_by uuid,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_ddr_status ON public.data_deletion_requests(status, requested_at DESC);
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_insert_deletion_requests ON public.data_deletion_requests;
CREATE POLICY public_insert_deletion_requests ON public.data_deletion_requests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS admins_manage_deletion_requests ON public.data_deletion_requests;
CREATE POLICY admins_manage_deletion_requests ON public.data_deletion_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── Instagram connections per user ──
CREATE TABLE IF NOT EXISTS public.instagram_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  instagram_user_id text NOT NULL,
  instagram_username text,
  access_token text NOT NULL,
  token_expires_at timestamptz,
  scopes text[] DEFAULT '{}',
  connected_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE(user_id, instagram_user_id)
);
CREATE INDEX IF NOT EXISTS idx_ig_user ON public.instagram_connections(user_id);
ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_own_instagram ON public.instagram_connections;
CREATE POLICY user_own_instagram ON public.instagram_connections FOR ALL TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS admins_read_all_instagram ON public.instagram_connections;
CREATE POLICY admins_read_all_instagram ON public.instagram_connections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── Instagram activity log ──
CREATE TABLE IF NOT EXISTS public.instagram_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  event_type text,
  external_id text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_events_user ON public.instagram_events(user_id, created_at DESC);
ALTER TABLE public.instagram_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_read_ig_events ON public.instagram_events;
CREATE POLICY admins_read_ig_events ON public.instagram_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
