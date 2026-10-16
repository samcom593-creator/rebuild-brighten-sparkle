-- PL-SEC-MANAGER-TABLES (2026-10-16): tables every manager could read in full, closed to the
-- audience that actually reads them. Measured as a non-admin manager: contracting_intakes 55/55,
-- partial_applications 456/456, email_delivery_log 850/850, notification_log 178,531/178,531.
--
-- contracting_intakes: every agent's comp percentage, email, phone, NPN and E&O details. Nothing in
-- the app reads the table; the two edge functions that do (submit-contracting-intake,
-- apex-outbox-dispatcher) use the service role. Admins only.
drop policy if exists contracting_intakes_staff_read on public.contracting_intakes;
create policy contracting_intakes_admin_read on public.contracting_intakes for select to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- partial_applications: abandoned application forms (name, email, phone, city, form data, IP).
-- Read only by service-role edge functions (check-abandoned-applications, send-abandoned-followup,
-- manychat-webhook). Admins only.
drop policy if exists "Admins and managers can read partial applications" on public.partial_applications;
create policy partial_applications_admin_read on public.partial_applications for select to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- email_delivery_log: every email's recipient and subject. The only page is /dashboard/email-log
-- (requireAdmin); email_log_admins_all already covers it.
drop policy if exists email_log_managers_read on public.email_delivery_log;

-- notification_log: every notification's recipient email, phone and body. The admin pages
-- (/dashboard/inbox, /dashboard/notifications) keep the admin policies. Everyone else reads only
-- their own notifications, which is what the unread badge (useUnreadNotifications) asks for; until
-- now an agent's badge read nothing and a manager's read everyone's.
drop policy if exists "Managers can view notification logs" on public.notification_log;
drop policy if exists notification_log_own_read on public.notification_log;
create policy notification_log_own_read on public.notification_log for select to authenticated
  using (recipient_user_id = (select auth.uid()));
