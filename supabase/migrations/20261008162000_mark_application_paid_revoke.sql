-- PL-WIB-SECDEF-OPEN-WRITERS, part 2 (2026-10-08). Hand-applied via bot-sql at ~16:2xZ;
-- REVOKE/GRANT are idempotent, so the CI re-apply is a no-op.
--
-- mark_application_paid is SECURITY DEFINER, reads no caller identity, and was
-- EXECUTE-able by anon and authenticated: anyone holding the public anon key could
-- mark any application paid with a payment reference of their choosing over
-- /rest/v1/rpc/mark_application_paid. It was held out of 20261008160100 only
-- because an edge function names it; that one caller (stripe-webhook-lead-purchase)
-- builds its client with SUPABASE_SERVICE_ROLE_KEY, so service_role keeps the grant.
-- No src/ reference, no policy/view/invoker/default/CHECK reference, 0 anon calls in
-- 24h of /rest/v1/rpc API logs. Graded live by apex-doctor Check #96.

revoke execute on function public.mark_application_paid(uuid,text,integer,text,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.mark_application_paid(uuid,text,integer,text,text,timestamp with time zone) to service_role;
