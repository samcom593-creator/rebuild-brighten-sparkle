-- MP-LEAD-MANAGER-RM.3 (2026-11-24). CREATE OR REPLACE VIEW replaces a view's options list, so 20261124020000
-- silently dropped security_invoker from v_pool_dialer. Nothing was exposed (neither anon nor authenticated holds a
-- grant on it; it is read only by the pool snapshot), but it goes back to how it was: the view runs as its caller.
alter view public.v_pool_dialer set (security_invoker = true);
