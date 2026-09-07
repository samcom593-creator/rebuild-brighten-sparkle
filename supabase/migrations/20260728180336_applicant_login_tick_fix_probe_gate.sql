-- ════════════════════════════════════════════════════════════════════════
-- Fix applicant_login_tick: the deploy-probe gate could never pass.
--
-- pg_net response rows are not visible inside the transaction that fired
-- the request (documented in applicant_magic_login v2), so the tick's
-- same-transaction poll always read NULL and returned
-- 'skipped: edge_fn_not_deployed' — even though applicant-magic-link is
-- deployed and returns 200. On top of that, the 'applicant-login-tick'
-- cron job from 20260423000001 was missing from cron.job in production.
-- Net effect: 379 applicants sat 'queued' since 2026-04-30 and never got
-- a login email.
--
-- New shape (all cross-transaction, matching the 2-phase design):
--   drain — resolve responses to requests fired by a PREVIOUS tick
--   send  — email link_ready rows
--   fire  — dispatch new magic-link requests (resolved by the NEXT tick)
-- A 404 from an undeployed fn now just marks rows 'error' with the status
-- code, which is visible and retryable, instead of silently stalling.
--
-- Applied to production 2026-07-28 alongside a one-time queue triage:
-- rows older than 30 days → 'skipped_stale'; rows whose email already has
-- an auth user → 'skipped_user_exists'; the 10 remaining recent rows were
-- provisioned and their login emails sent.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.applicant_login_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_drained jsonb; v_fired jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_drained := public.applicant_login_drain();
  PERFORM public.applicant_login_send(30);
  v_fired := public.applicant_login_fire(50);
  RETURN jsonb_build_object('alive', true, 'drained', v_drained, 'fired', v_fired);
END $fn$;

GRANT EXECUTE ON FUNCTION public.applicant_login_tick() TO service_role, authenticated;

-- Re-assert the 3-minute cron (was missing from cron.job in production)
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='applicant-login-tick') THEN
    PERFORM cron.unschedule('applicant-login-tick'); END IF;
  PERFORM cron.schedule('applicant-login-tick', '*/3 * * * *',
    $j$ SELECT public.applicant_login_tick(); $j$);
END $outer$;

SELECT 'applicant_login_tick probe gate removed; 3min cron re-asserted' AS r;
