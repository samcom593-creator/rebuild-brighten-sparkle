-- ============================================================
-- Missing public.notifications table
-- Multiple cron jobs (apex-email-status, apex-insuracloud-sync, etc.)
-- write into public.notifications but no migration created it.
-- Root cause for 25+ cron failures over the past 24 hours.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type text DEFAULT 'info',
  priority text DEFAULT 'normal',
  read_at timestamptz,
  link text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON public.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_created
  ON public.notifications(created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_notifications      ON public.notifications;
DROP POLICY IF EXISTS own_notif_update       ON public.notifications;
DROP POLICY IF EXISTS service_write_notif    ON public.notifications;

CREATE POLICY own_notifications   ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY own_notif_update    ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY service_write_notif ON public.notifications FOR ALL    TO service_role  USING (true);
