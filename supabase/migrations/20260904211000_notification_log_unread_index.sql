-- MP-430b — the bell's unread count 500s.
-- useUnreadNotifications reads notification_log filtered by recipient_user_id
-- + opened_at is null + status in (sent, delivered), limit 200. The table holds
-- 176,187 rows and had indexes only on agent_id / notification_type /
-- created_at, so the read was a sequential scan under RLS that regularly
-- crossed the authenticated role's 8s statement_timeout — PostgREST reports
-- that as HTTP 500 ("500 notification_log" in the dashboard console as Sam).
-- A partial index on exactly that predicate turns it into an index scan.
create index if not exists idx_notification_log_unread_by_recipient
  on public.notification_log (recipient_user_id, created_at desc)
  where opened_at is null and status in ('sent', 'delivered');
