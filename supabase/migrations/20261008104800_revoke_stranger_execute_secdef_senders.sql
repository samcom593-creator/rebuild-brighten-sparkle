-- PL-WIB-SECDEF-SENDER-EXECUTE (2026-10-08). Hand-applied via bot-sql at ~10:47Z,
-- before this file was pushed; REVOKE/GRANT are idempotent, so the CI re-apply is a no-op.
--
-- 38 public SECURITY DEFINER functions post outbound (net.http_post, or a call to an
-- edge function under /functions/v1/) and were EXECUTE-able by anon and authenticated
-- through Supabase's default privileges. PostgREST exposes every such function at
-- /rest/v1/rpc/<name>, and the anon key ships in the browser bundle, so the edge
-- function gates shipped today (requireSendAuth) could be walked around one layer
-- down: 11 of these read system_settings.service_role_key, the exact credential
-- those gates accept. Examples: send_reapply_email_blast(p_dry) mails every applicant
-- of the last 30 days as Sam, or with p_dry=true returns their names and emails;
-- broadcast_to_all_channels / discord_route / fn_broadcast_to_telegram_chat take
-- caller-chosen text; fn_agentlink_alert_page pages Sam.
--
-- Proven reachable before the revoke: a stranger call with the anon key to
-- send_reapply_email_blast {"p_dry":true} EXECUTED and died on anon's 3s
-- statement_timeout (57014) -- safe only because that loop happens to be slow.
-- After: 42501 permission denied. Nothing was sent by either probe.
--
-- Callers inventoried first: 0 .rpc() in src/ or supabase/functions (positive
-- control: 230 rpc calls in src), 0 /rest/v1/rpc hits for any of the 38 in 24h of
-- API logs (other RPCs: thousands), 9 cron jobs all run as postgres, 21 pg callers
-- all SECURITY DEFINER owned by postgres. A definer caller runs as its owner, so
-- the /apply trigger chain (anon insert -> applications_trigger_* -> run_automation_job)
-- keeps working; proven on prod with a throwaway definer pair (caller 200, direct 42501),
-- dropped after.
--
-- Pre-image ACLs: business-ops/website-integrity-bot/ledger/snapshots/2026-10-08-secdef-outbound-acl.pre.json
-- (all 38 were {=X,postgres=X,anon=X,authenticated=X,service_role=X}).
--
-- A function re-created later inherits the default privileges again, so the
-- regression is graded live by apex-doctor Check #95.

revoke execute on function public.applicant_login_fire(integer) from public, anon, authenticated;
grant execute on function public.applicant_login_fire(integer) to service_role;
revoke execute on function public.applicant_login_send(integer) from public, anon, authenticated;
grant execute on function public.applicant_login_send(integer) to service_role;
revoke execute on function public.broadcast_to_all_channels(text,text,text) from public, anon, authenticated;
grant execute on function public.broadcast_to_all_channels(text,text,text) to service_role;
revoke execute on function public.check_speed_to_lead() from public, anon, authenticated;
grant execute on function public.check_speed_to_lead() to service_role;
revoke execute on function public.detect_milestone_verge() from public, anon, authenticated;
grant execute on function public.detect_milestone_verge() to service_role;
revoke execute on function public.discord_route(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.discord_route(text,text,text,jsonb) to service_role;
revoke execute on function public.dm_overnight_digest() from public, anon, authenticated;
grant execute on function public.dm_overnight_digest() to service_role;
revoke execute on function public.dm_send_retry() from public, anon, authenticated;
grant execute on function public.dm_send_retry() to service_role;
revoke execute on function public.drain_sms_fallback_queue() from public, anon, authenticated;
grant execute on function public.drain_sms_fallback_queue() to service_role;
revoke execute on function public.fn_agentlink_alert_page(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.fn_agentlink_alert_page(uuid,text,text,text) to service_role;
revoke execute on function public.fn_automation_liveness_check() from public, anon, authenticated;
grant execute on function public.fn_automation_liveness_check() to service_role;
revoke execute on function public.fn_broadcast_to_telegram_chat(text,text) from public, anon, authenticated;
grant execute on function public.fn_broadcast_to_telegram_chat(text,text) to service_role;
revoke execute on function public.fn_close_communication_gaps(integer) from public, anon, authenticated;
grant execute on function public.fn_close_communication_gaps(integer) to service_role;
revoke execute on function public.fn_email_failure_alarm() from public, anon, authenticated;
grant execute on function public.fn_email_failure_alarm() to service_role;
revoke execute on function public.fn_missed_opportunity_digest() from public, anon, authenticated;
grant execute on function public.fn_missed_opportunity_digest() to service_role;
revoke execute on function public.fn_post_unlicensed_digest() from public, anon, authenticated;
grant execute on function public.fn_post_unlicensed_digest() to service_role;
revoke execute on function public.fn_run_applicant_nudges() from public, anon, authenticated;
grant execute on function public.fn_run_applicant_nudges() to service_role;
revoke execute on function public.in_course_peer_pressure() from public, anon, authenticated;
grant execute on function public.in_course_peer_pressure() to service_role;
revoke execute on function public.manager_daily_accountability() from public, anon, authenticated;
grant execute on function public.manager_daily_accountability() to service_role;
revoke execute on function public.mp264_capture_stall_check() from public, anon, authenticated;
grant execute on function public.mp264_capture_stall_check() to service_role;
revoke execute on function public.nudge_day2_not_enrolled() from public, anon, authenticated;
grant execute on function public.nudge_day2_not_enrolled() to service_role;
revoke execute on function public.nudge_day4_not_enrolled() from public, anon, authenticated;
grant execute on function public.nudge_day4_not_enrolled() to service_role;
revoke execute on function public.orphan_deal_audit() from public, anon, authenticated;
grant execute on function public.orphan_deal_audit() to service_role;
revoke execute on function public.post_daily_top_producer() from public, anon, authenticated;
grant execute on function public.post_daily_top_producer() to service_role;
revoke execute on function public.post_evening_recap() from public, anon, authenticated;
grant execute on function public.post_evening_recap() to service_role;
revoke execute on function public.post_morning_huddle() from public, anon, authenticated;
grant execute on function public.post_morning_huddle() to service_role;
revoke execute on function public.post_weekly_recap() from public, anon, authenticated;
grant execute on function public.post_weekly_recap() to service_role;
revoke execute on function public.rescue_stale_applications() from public, anon, authenticated;
grant execute on function public.rescue_stale_applications() to service_role;
revoke execute on function public.run_automation_job(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.run_automation_job(text,text,jsonb) to service_role;
revoke execute on function public.schedule_auto_populate_tick() from public, anon, authenticated;
grant execute on function public.schedule_auto_populate_tick() to service_role;
revoke execute on function public.send_completion_contracting_handoff() from public, anon, authenticated;
grant execute on function public.send_completion_contracting_handoff() to service_role;
revoke execute on function public.send_reapply_blast(boolean,integer) from public, anon, authenticated;
grant execute on function public.send_reapply_blast(boolean,integer) to service_role;
revoke execute on function public.send_reapply_email_blast(boolean) from public, anon, authenticated;
grant execute on function public.send_reapply_email_blast(boolean) to service_role;
revoke execute on function public.send_reapply_sms_blast(boolean) from public, anon, authenticated;
grant execute on function public.send_reapply_sms_blast(boolean) to service_role;
revoke execute on function public.stale_submitted_alert() from public, anon, authenticated;
grant execute on function public.stale_submitted_alert() to service_role;
revoke execute on function public.stuck_applicants_daily_digest() from public, anon, authenticated;
grant execute on function public.stuck_applicants_daily_digest() to service_role;
revoke execute on function public.trigger_stripe_sync() from public, anon, authenticated;
grant execute on function public.trigger_stripe_sync() to service_role;
revoke execute on function public.weekly_xcel_progress_emails() from public, anon, authenticated;
grant execute on function public.weekly_xcel_progress_emails() to service_role;
