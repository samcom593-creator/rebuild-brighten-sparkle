-- PL-WIB-SECDEF-SERVICE-WRITERS (2026-10-09)
--
-- Five SECURITY DEFINER functions that read no caller identity were EXECUTE-able by
-- every signed-in account. Signup is open and every new account is role 'agent', so
-- "signed in" admits strangers. None of the five has a browser caller: no .rpc() in
-- src/, and the only callers are pg_cron (as postgres), one edge function (service
-- key) and three other SECURITY DEFINER functions (which run as their owner, so this
-- revoke does not reach them). Measured on live prod as a bare self-signup
-- (ff0085b6..., role agent, no agents row), inside a rolled-back transaction:
--
--   trigger_interview_noshow_recovery(uuid)  -> {"queued": true} for a RANDOM uuid,
--       and one pending outbox_events row, destination 'slack', event
--       candidate.interview_noshow, "urgent follow-up", per call. The idempotency key
--       is per interview id, so any uuid is a new Slack post: unbounded posts into a
--       live channel (slack delivered 331 outbox events in the last 30 days). It has
--       no caller anywhere: not src/, not supabase/functions/, not cron, not pg_proc.
--   refresh_production_truth(boolean)  -> p_force=true ran all three materialized
--       view refreshes on demand ({"hierarchy":26,"production":455,"agent_flags":375} ms).
--       Its only caller is the refresh-production-truth cron (every 5 min, postgres).
--   fn_enqueue_onboarding_call_booking(uuid,text)  -> the inner writer behind
--       admin_enqueue_onboarding_call (admin/manager/va_manager role check) and
--       request_onboarding_call_booking (fn_recruit_scope_ok). Called directly it skips
--       both checks and queues the onboarding-call email for any eligible agent.
--       Other callers: trigger fn_enqueue_hired_licensed_onboarding, cron sweep
--       fn_sweep_onboarding_call_gaps. All SECURITY DEFINER.
--   fn_sweep_recruiting_milestones(text)  -> awards plaques and queues Slack + Discord
--       posts. Callers: two pg_cron jobs.
--   fn_match_readymode_calls()  -> rewrites readymode_dialer_calls.agent_id. Caller:
--       readymode-sync edge function with the service key.
--
-- Two more are open to the public anon key and have no reader at all (their views,
-- v_launch_readiness and v_interview_conflicts, are read by nothing in src/ or
-- supabase/functions/). Closed to anon only; authenticated keeps EXECUTE so the
-- authenticated-select views keep working if a staff page starts reading them.
--   data_quality_audit()  -> ops counts, joins auth.users.
--   interview_conflicts(timestamptz)  -> Sam's availability blocks; anon probed 14 days
--       at 30-minute steps and got 348 hits naming his off-hours windows.
--
-- apex-doctor Check #96 holds the five in `closed` and the two in `anon_closed`.
-- Proof: website-integrity-bot/scripts/prove-service-writers.sh (M1 re-grants).

REVOKE EXECUTE ON FUNCTION public.trigger_interview_noshow_recovery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_interview_noshow_recovery(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_production_truth(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_production_truth(boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_enqueue_onboarding_call_booking(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_onboarding_call_booking(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_sweep_recruiting_milestones(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_recruiting_milestones(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_match_readymode_calls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_match_readymode_calls() TO service_role;

REVOKE EXECUTE ON FUNCTION public.data_quality_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.data_quality_audit() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.interview_conflicts(timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.interview_conflicts(timestamp with time zone) TO authenticated, service_role;
