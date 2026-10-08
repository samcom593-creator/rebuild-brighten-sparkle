-- PL-WIB-SECDEF-ANON-STAFF (2026-10-08). Hand-applied via bot-sql at ~17:16Z;
-- REVOKE/GRANT are idempotent, so the CI re-apply is a no-op.
--
-- 20261008160100 closed the definer functions that NOTHING calls. It kept open every
-- function with a caller anywhere in src/ or supabase/functions, without asking whether
-- that caller ever runs without a session. These 22 are SECURITY DEFINER, read no caller
-- identity, and were EXECUTE-able by anon, so the public key alone reached them. Proven
-- as a stranger at 17:13Z, HTTP 200 each: sam_todo_list (Sam's 10 open to-dos),
-- finance_snapshot, get_canonical_sam_agent (Sam's auth email + last sign-in),
-- apex_dashboard_summary, kj_seminar_metrics, recruiting_pipeline_rollup,
-- sync_health_summary. The writers let a stranger mark an applicant's phone bad, move
-- license progress, assign a VA, advance a referral, promote an aged lead, inject
-- ReadyMode calls, or burn another address's password-reset rate-limit bucket.
--
-- Part A: every src/ caller renders inside ProtectedRoute or the AuthenticatedShell
-- (/dashboard/*, /admin/recovery-queue, /admin/unlicensed-all, /dashboard/referrals,
-- /dashboard/book-quality, /dashboard/pre-licensing, /dashboard/seminar*,
-- /dashboard/sam-todo, /agent-portal). Signed-in callers keep their explicit
-- authenticated grant; only PUBLIC and anon lose it. In-function staff checks are the
-- next layer (open signup means authenticated is not staff) and are NOT done here.
--
-- Part B: no live src/ caller. Callers are edge functions built on
-- SUPABASE_SERVICE_ROLE_KEY (readymode-ingest, send-password-reset,
-- submit-contracting-intake, _shared/rateLimit, notion-sync), definer triggers
-- (handle_new_user, auto_admin_for_sam) or the postgres-owned cron job
-- recover_partial_applications_hourly. get_canonical_sam_agent is only reached from
-- tests. So only service_role keeps it.
--
-- None is named by a policy, a view, an invoker function or a column default. 24h of
-- /rest/v1/rpc API logs: 0 anon calls other than the 17:13Z probe; check_rate_limit's
-- 7 calls carry the service secret key. Pre-image ACLs:
-- business-ops/website-integrity-bot/ledger/snapshots/2026-10-08-secdef-anon-staff-acl.pre.json

-- Part A: signed-in staff pages call these. Close to strangers only.
revoke execute on function public.advance_referral_status(uuid,referral_status,text) from public, anon;
grant execute on function public.advance_referral_status(uuid,referral_status,text) to authenticated, service_role;
revoke execute on function public.agentlink_award_top_producers() from public, anon;
grant execute on function public.agentlink_award_top_producers() to authenticated, service_role;
revoke execute on function public.agentlink_live_pull() from public, anon;
grant execute on function public.agentlink_live_pull() to authenticated, service_role;
revoke execute on function public.fn_match_carrier_policy_agents() from public, anon;
grant execute on function public.fn_match_carrier_policy_agents() to authenticated, service_role;
revoke execute on function public.fn_match_xcel_students() from public, anon;
grant execute on function public.fn_match_xcel_students() to authenticated, service_role;
revoke execute on function public.mark_phone_bad(uuid,text) from public, anon;
grant execute on function public.mark_phone_bad(uuid,text) to authenticated, service_role;
revoke execute on function public.promote_aged_lead_to_application(uuid) from public, anon;
grant execute on function public.promote_aged_lead_to_application(uuid) to authenticated, service_role;
revoke execute on function public.unified_assign_va(uuid,uuid,text) from public, anon;
grant execute on function public.unified_assign_va(uuid,uuid,text) to authenticated, service_role;
revoke execute on function public.unified_mark_contacted(uuid,text,uuid) from public, anon;
grant execute on function public.unified_mark_contacted(uuid,text,uuid) to authenticated, service_role;
revoke execute on function public.unified_set_license_progress(uuid,text,text) from public, anon;
grant execute on function public.unified_set_license_progress(uuid,text,text) to authenticated, service_role;
revoke execute on function public.sam_todo_list() from public, anon;
grant execute on function public.sam_todo_list() to authenticated, service_role;
revoke execute on function public.apex_dashboard_summary() from public, anon;
grant execute on function public.apex_dashboard_summary() to authenticated, service_role;
revoke execute on function public.kj_seminar_metrics() from public, anon;
grant execute on function public.kj_seminar_metrics() to authenticated, service_role;
revoke execute on function public.sync_health_summary() from public, anon;
grant execute on function public.sync_health_summary() to authenticated, service_role;
revoke execute on function public.get_agent_production_stats(date,date) from public, anon;
grant execute on function public.get_agent_production_stats(date,date) to authenticated, service_role;

-- Part B: service key, definer triggers and cron only.
revoke execute on function public.fn_readymode_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.fn_readymode_ingest(jsonb) to service_role;
revoke execute on function public.fn_record_auth_provision_failure(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.fn_record_auth_provision_failure(uuid,text,text,text,text) to service_role;
revoke execute on function public.check_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text,integer,integer) to service_role;
revoke execute on function public.recover_partial_applications() from public, anon, authenticated;
grant execute on function public.recover_partial_applications() to service_role;
revoke execute on function public.finance_snapshot() from public, anon, authenticated;
grant execute on function public.finance_snapshot() to service_role;
revoke execute on function public.recruiting_pipeline_rollup() from public, anon, authenticated;
grant execute on function public.recruiting_pipeline_rollup() to service_role;
revoke execute on function public.get_canonical_sam_agent() from public, anon, authenticated;
grant execute on function public.get_canonical_sam_agent() to service_role;
