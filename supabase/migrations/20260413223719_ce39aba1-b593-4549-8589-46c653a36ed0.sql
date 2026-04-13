-- Drop and recreate the conflicting policy
DROP POLICY IF EXISTS "Admins can manage all scheduled tasks" ON public.scheduled_tasks;
CREATE POLICY "Admins can manage all scheduled tasks"
  ON public.scheduled_tasks FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Notification log policies (may already exist too)
DROP POLICY IF EXISTS "Admins can manage all notification logs" ON public.notification_log;
CREATE POLICY "Admins can manage all notification logs"
  ON public.notification_log FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Managers can view notification logs" ON public.notification_log;
CREATE POLICY "Managers can view notification logs"
  ON public.notification_log FOR SELECT
  USING (has_role(auth.uid(), 'manager'::app_role));