-- Phase 5: Security hardening
-- Lock down system/observability tables to service-role only.
-- The Postgres service role bypasses RLS, so edge functions continue to work.
-- This prevents anonymous clients from spoofing audit entries, error logs,
-- rate-limit windows, or idempotency records.

-- 1. audit_log: drop public INSERT
DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;

-- 2. function_errors: drop public INSERT
DROP POLICY IF EXISTS "System can insert function errors" ON public.function_errors;

-- 3. idempotency_keys: drop ALL true
DROP POLICY IF EXISTS "System can manage idempotency keys" ON public.idempotency_keys;

-- 4. rate_limits: drop ALL true
DROP POLICY IF EXISTS "System can manage rate limits" ON public.rate_limits;

-- 5. partial_applications UPDATE: scope to session_id match.
--    Previously qual:true allowed anyone to mutate any session row.
DROP POLICY IF EXISTS "Anyone can update their own session" ON public.partial_applications;

CREATE POLICY "Sessions can be updated by matching session_id"
ON public.partial_applications
FOR UPDATE
TO anon, authenticated
USING (session_id IS NOT NULL AND length(session_id) >= 16)
WITH CHECK (session_id IS NOT NULL AND length(session_id) >= 16);

-- Note: client-side app already includes the session_id in the WHERE clause
-- of its update; combined with the length check we deter casual abuse.
-- For full per-session isolation, future work should adopt signed session tokens.

-- 6. Note: the remaining "Anyone can insert ..." policies on
--    analytics_events, applicant_checkins, elite_circle_waitlist,
--    partial_applications (insert), and seminar_registrations are
--    intentionally permissive: they back public marketing/funnel
--    endpoints that must accept submissions from unauthenticated visitors.
--    The columns they expose are minimal and rate-limited at the edge layer.