-- PL-WIB-SECDEF-OPEN-WRITERS (2026-10-08). Hand-applied via bot-sql at ~16:01Z,
-- before this file was pushed; REVOKE/GRANT are idempotent, so the CI re-apply is a no-op.
--
-- One layer past 20261008104800 (the 38 functions that POST outbound). That sweep
-- graded only bodies containing net.http_post or /functions/v1/. This one grades
-- every public SECURITY DEFINER function a stranger can EXECUTE whose body reads no
-- caller identity (no auth.uid / auth.role / auth.jwt / has_role / is_admin /
-- is_staff / is_manager / service_role): 156 on 2026-10-08. 98 of them have no
-- caller that needs anon or authenticated, so they are closed here:
--   70 write (insert/update/delete), e.g.
--   promote_applicant_to_agent(uuid,uuid), apex_provision_licensed_applicant(uuid),
--   dedupe_applications_by_email(), fn_skool_members_replace(jsonb), and the
--   outreach enqueuers onboarding_drip(), nudge_unlicensed_applicants(),
--   reactivate_nopickup_day3/7(), revive_dead_leads(), client_birthday_wisher();
--   28 read, e.g. apex_daily_briefing(), which returned 15 applicant names and
--   emails to an anonymous POST (proven 2026-10-08 ~15:59Z, HTTP 200).
--
-- Callers inventoried first, and a function was kept OUT of this list if ANY of:
--   * its name appears as a word anywhere in src/ (incl. raw fetch
--     /rest/v1/rpc/<name>: landing_deal_highlights was excluded on this rule,
--     and API logs showed it at 166 anon calls/24h);
--   * any supabase/functions file names it (edge callers may use a user client);
--   * an RLS policy, view, matview, invoker function, column default or CHECK
--     names it (those evaluate as the querying role);
--   * it appeared in 24h of /rest/v1/rpc API logs under the anon/user key.
-- Remaining callers are pg_cron (no job runs as anything but postgres), SECURITY DEFINER
-- callers (run as owner postgres), bot-sql (postgres) and the external-cron-backup
-- workflow (bot-sql). After: anon 42501 on apex_daily_briefing and
-- detect_duplicate_applicants; landing_* controls still 200; service role 200.
--
-- Pre-image ACLs: business-ops/website-integrity-bot/ledger/snapshots/2026-10-08-secdef-open-writers-acl.pre.json
-- A function re-created later inherits default privileges again; graded live by
-- apex-doctor Check #96.

revoke execute on function public.agentlink_pull_appointments() from public, anon, authenticated;
grant execute on function public.agentlink_pull_appointments() to service_role;
revoke execute on function public.agentlink_pull_book_of_business() from public, anon, authenticated;
grant execute on function public.agentlink_pull_book_of_business() to service_role;
revoke execute on function public.agentlink_pull_commissions() from public, anon, authenticated;
grant execute on function public.agentlink_pull_commissions() to service_role;
revoke execute on function public.agentlink_pull_leads() from public, anon, authenticated;
grant execute on function public.agentlink_pull_leads() to service_role;
revoke execute on function public.agentlink_refresh_downline() from public, anon, authenticated;
grant execute on function public.agentlink_refresh_downline() to service_role;
revoke execute on function public.agentlink_upsert_from_payload(jsonb) from public, anon, authenticated;
grant execute on function public.agentlink_upsert_from_payload(jsonb) to service_role;
revoke execute on function public.agentlink_watchdog() from public, anon, authenticated;
grant execute on function public.agentlink_watchdog() to service_role;
revoke execute on function public.alert_stuck_xcel_students() from public, anon, authenticated;
grant execute on function public.alert_stuck_xcel_students() to service_role;
revoke execute on function public.apex_agent_book(uuid) from public, anon, authenticated;
grant execute on function public.apex_agent_book(uuid) to service_role;
revoke execute on function public.apex_daily_briefing() from public, anon, authenticated;
grant execute on function public.apex_daily_briefing() to service_role;
revoke execute on function public.apex_provision_licensed_applicant(uuid) from public, anon, authenticated;
grant execute on function public.apex_provision_licensed_applicant(uuid) to service_role;
revoke execute on function public.applicant_login_drain() from public, anon, authenticated;
grant execute on function public.applicant_login_drain() to service_role;
revoke execute on function public.applicant_login_tick() from public, anon, authenticated;
grant execute on function public.applicant_login_tick() to service_role;
revoke execute on function public.assign_va_to_application(uuid,uuid) from public, anon, authenticated;
grant execute on function public.assign_va_to_application(uuid,uuid) to service_role;
revoke execute on function public.audit_phantom_assignments() from public, anon, authenticated;
grant execute on function public.audit_phantom_assignments() to service_role;
revoke execute on function public.auto_advance_stale_applications() from public, anon, authenticated;
grant execute on function public.auto_advance_stale_applications() to service_role;
revoke execute on function public.auto_assign_hiring_manager() from public, anon, authenticated;
grant execute on function public.auto_assign_hiring_manager() to service_role;
revoke execute on function public.autoposter_leak_watchdog() from public, anon, authenticated;
grant execute on function public.autoposter_leak_watchdog() to service_role;
revoke execute on function public.backfill_monthly_awards(numeric,integer) from public, anon, authenticated;
grant execute on function public.backfill_monthly_awards(numeric,integer) to service_role;
revoke execute on function public.backfill_plaque_images() from public, anon, authenticated;
grant execute on function public.backfill_plaque_images() to service_role;
revoke execute on function public.bot_alert_insuracloud_err_throttled(text,text,text) from public, anon, authenticated;
grant execute on function public.bot_alert_insuracloud_err_throttled(text,text,text) to service_role;
revoke execute on function public.cc_dispose(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.cc_dispose(text,text,text,text,text) to service_role;
revoke execute on function public.churn_calc() from public, anon, authenticated;
grant execute on function public.churn_calc() to service_role;
revoke execute on function public.cleanup_expired_idempotency_keys() from public, anon, authenticated;
grant execute on function public.cleanup_expired_idempotency_keys() to service_role;
revoke execute on function public.client_birthday_wisher() from public, anon, authenticated;
grant execute on function public.client_birthday_wisher() to service_role;
revoke execute on function public.commission_ledger_reconcile() from public, anon, authenticated;
grant execute on function public.commission_ledger_reconcile() to service_role;
revoke execute on function public.dashboard_paid_today_summary() from public, anon, authenticated;
grant execute on function public.dashboard_paid_today_summary() to service_role;
revoke execute on function public.deal_sync_queue_promote_dead() from public, anon, authenticated;
grant execute on function public.deal_sync_queue_promote_dead() to service_role;
revoke execute on function public.dedupe_applications_by_email() from public, anon, authenticated;
grant execute on function public.dedupe_applications_by_email() to service_role;
revoke execute on function public.detect_duplicate_applicants() from public, anon, authenticated;
grant execute on function public.detect_duplicate_applicants() to service_role;
revoke execute on function public.dialer_payment_summary(date) from public, anon, authenticated;
grant execute on function public.dialer_payment_summary(date) to service_role;
revoke execute on function public.discord_audit_ok(text,text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.discord_audit_ok(text,text,numeric,numeric) to service_role;
revoke execute on function public.disposition_interview(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.disposition_interview(text,uuid,text,text) to service_role;
revoke execute on function public.ensure_next_month_partitions() from public, anon, authenticated;
grant execute on function public.ensure_next_month_partitions() to service_role;
revoke execute on function public.flex_hire(uuid) from public, anon, authenticated;
grant execute on function public.flex_hire(uuid) to service_role;
revoke execute on function public.fn_auto_merge_clear_duplicates() from public, anon, authenticated;
grant execute on function public.fn_auto_merge_clear_duplicates() to service_role;
revoke execute on function public.fn_backfill_orphan_agent_id() from public, anon, authenticated;
grant execute on function public.fn_backfill_orphan_agent_id() to service_role;
revoke execute on function public.fn_backfill_orphan_failed_payments() from public, anon, authenticated;
grant execute on function public.fn_backfill_orphan_failed_payments() to service_role;
revoke execute on function public.fn_backfill_orphan_lead_purchases() from public, anon, authenticated;
grant execute on function public.fn_backfill_orphan_lead_purchases() to service_role;
revoke execute on function public.fn_backfill_refund_sync() from public, anon, authenticated;
grant execute on function public.fn_backfill_refund_sync() to service_role;
revoke execute on function public.fn_book_audit_run() from public, anon, authenticated;
grant execute on function public.fn_book_audit_run() to service_role;
revoke execute on function public.fn_calls_today_summary() from public, anon, authenticated;
grant execute on function public.fn_calls_today_summary() to service_role;
revoke execute on function public.fn_canonical_agent_id(uuid) from public, anon, authenticated;
grant execute on function public.fn_canonical_agent_id(uuid) to service_role;
revoke execute on function public.fn_capture_pg_cron_timeout_state() from public, anon, authenticated;
grant execute on function public.fn_capture_pg_cron_timeout_state() to service_role;
revoke execute on function public.fn_commission_rate(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_commission_rate(uuid,uuid) to service_role;
revoke execute on function public.fn_dedupe_phantom_lead_purchases() from public, anon, authenticated;
grant execute on function public.fn_dedupe_phantom_lead_purchases() to service_role;
revoke execute on function public.fn_emit_inbox_notification(uuid,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.fn_emit_inbox_notification(uuid,text,text,text,text,text,jsonb) to service_role;
revoke execute on function public.fn_ensure_contracting_delivery_legs(uuid) from public, anon, authenticated;
grant execute on function public.fn_ensure_contracting_delivery_legs(uuid) to service_role;
revoke execute on function public.fn_hierarchy_first_hops_live(uuid[]) from public, anon, authenticated;
grant execute on function public.fn_hierarchy_first_hops_live(uuid[]) to service_role;
revoke execute on function public.fn_identity_collision_observe() from public, anon, authenticated;
grant execute on function public.fn_identity_collision_observe() to service_role;
revoke execute on function public.fn_is_first_slack_deal_today() from public, anon, authenticated;
grant execute on function public.fn_is_first_slack_deal_today() to service_role;
revoke execute on function public.fn_license_renewal_sweep() from public, anon, authenticated;
grant execute on function public.fn_license_renewal_sweep() to service_role;
revoke execute on function public.fn_logged_backfill_orphan_agent_id() from public, anon, authenticated;
grant execute on function public.fn_logged_backfill_orphan_agent_id() to service_role;
revoke execute on function public.fn_logged_backfill_orphan_failed_payments() from public, anon, authenticated;
grant execute on function public.fn_logged_backfill_orphan_failed_payments() to service_role;
revoke execute on function public.fn_logged_backfill_orphan_lead_purchases() from public, anon, authenticated;
grant execute on function public.fn_logged_backfill_orphan_lead_purchases() to service_role;
revoke execute on function public.fn_logged_backfill_refund_sync() from public, anon, authenticated;
grant execute on function public.fn_logged_backfill_refund_sync() to service_role;
revoke execute on function public.fn_logged_dedupe_phantom_lead_purchases() from public, anon, authenticated;
grant execute on function public.fn_logged_dedupe_phantom_lead_purchases() to service_role;
revoke execute on function public.fn_next_step_manual_advance(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_next_step_manual_advance(uuid,uuid,text,uuid,text) to service_role;
revoke execute on function public.fn_next_step_nudge_sweep() from public, anon, authenticated;
grant execute on function public.fn_next_step_nudge_sweep() to service_role;
revoke execute on function public.fn_next_step_recompute_all() from public, anon, authenticated;
grant execute on function public.fn_next_step_recompute_all() to service_role;
revoke execute on function public.fn_next_step_recompute_one(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_next_step_recompute_one(uuid,uuid) to service_role;
revoke execute on function public.fn_next_step_stall_sweep() from public, anon, authenticated;
grant execute on function public.fn_next_step_stall_sweep() to service_role;
revoke execute on function public.fn_onboarding_email_backfill_sweep() from public, anon, authenticated;
grant execute on function public.fn_onboarding_email_backfill_sweep() to service_role;
revoke execute on function public.fn_post_deal_celebration(uuid,numeric,text,text) from public, anon, authenticated;
grant execute on function public.fn_post_deal_celebration(uuid,numeric,text,text) to service_role;
revoke execute on function public.fn_prune_agentlink_alerts() from public, anon, authenticated;
grant execute on function public.fn_prune_agentlink_alerts() to service_role;
revoke execute on function public.fn_skool_members_replace(jsonb) from public, anon, authenticated;
grant execute on function public.fn_skool_members_replace(jsonb) to service_role;
revoke execute on function public.fn_sweep_interview_reminders() from public, anon, authenticated;
grant execute on function public.fn_sweep_interview_reminders() to service_role;
revoke execute on function public.fn_sweep_manager_followup_reminders() from public, anon, authenticated;
grant execute on function public.fn_sweep_manager_followup_reminders() to service_role;
revoke execute on function public.fn_telegram_queue_inactivity_nudges() from public, anon, authenticated;
grant execute on function public.fn_telegram_queue_inactivity_nudges() to service_role;
revoke execute on function public.fn_unlicensed_digest_health() from public, anon, authenticated;
grant execute on function public.fn_unlicensed_digest_health() to service_role;
revoke execute on function public.fn_unlicensed_slack_digest() from public, anon, authenticated;
grant execute on function public.fn_unlicensed_slack_digest() to service_role;
revoke execute on function public.fn_xcel_auto_upgrade_all() from public, anon, authenticated;
grant execute on function public.fn_xcel_auto_upgrade_all() to service_role;
revoke execute on function public.generate_weekly_dialer_invoices(date) from public, anon, authenticated;
grant execute on function public.generate_weekly_dialer_invoices(date) to service_role;
revoke execute on function public.get_application_seminar_invite(uuid) from public, anon, authenticated;
grant execute on function public.get_application_seminar_invite(uuid) to service_role;
revoke execute on function public.job_run_finish(uuid,text,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.job_run_finish(uuid,text,integer,text,jsonb) to service_role;
revoke execute on function public.job_run_start(text) from public, anon, authenticated;
grant execute on function public.job_run_start(text) to service_role;
revoke execute on function public.landing_hire_meter() from public, anon, authenticated;
grant execute on function public.landing_hire_meter() to service_role;
revoke execute on function public.leaderboard_book(date,date,boolean) from public, anon, authenticated;
grant execute on function public.leaderboard_book(date,date,boolean) to service_role;
revoke execute on function public.leaderboard_book_tenure(date,date) from public, anon, authenticated;
grant execute on function public.leaderboard_book_tenure(date,date) to service_role;
revoke execute on function public.nudge_unlicensed_applicants() from public, anon, authenticated;
grant execute on function public.nudge_unlicensed_applicants() to service_role;
revoke execute on function public.nudge_xcel_completions_to_contract() from public, anon, authenticated;
grant execute on function public.nudge_xcel_completions_to_contract() to service_role;
revoke execute on function public.onboarding_drip() from public, anon, authenticated;
grant execute on function public.onboarding_drip() to service_role;
revoke execute on function public.post_hiring_bottleneck_alert() from public, anon, authenticated;
grant execute on function public.post_hiring_bottleneck_alert() to service_role;
revoke execute on function public.post_midday_snapshot() from public, anon, authenticated;
grant execute on function public.post_midday_snapshot() to service_role;
revoke execute on function public.producer_deep_dive(integer) from public, anon, authenticated;
grant execute on function public.producer_deep_dive(integer) to service_role;
revoke execute on function public.promote_applicant_to_agent(uuid,uuid) from public, anon, authenticated;
grant execute on function public.promote_applicant_to_agent(uuid,uuid) to service_role;
revoke execute on function public.queue_sms(text,text,text) from public, anon, authenticated;
grant execute on function public.queue_sms(text,text,text) to service_role;
revoke execute on function public.reactivate_nopickup_day3() from public, anon, authenticated;
grant execute on function public.reactivate_nopickup_day3() to service_role;
revoke execute on function public.reactivate_nopickup_day7() from public, anon, authenticated;
grant execute on function public.reactivate_nopickup_day7() to service_role;
revoke execute on function public.recompute_agent_metrics_for_period(date,date) from public, anon, authenticated;
grant execute on function public.recompute_agent_metrics_for_period(date,date) to service_role;
revoke execute on function public.record_snap_stats_public(text,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.record_snap_stats_public(text,integer,integer,integer,text) to service_role;
revoke execute on function public.refresh_mat_production_unified_if_needed() from public, anon, authenticated;
grant execute on function public.refresh_mat_production_unified_if_needed() to service_role;
revoke execute on function public.resolve_hiring_manager_for_scope(hiring_scope) from public, anon, authenticated;
grant execute on function public.resolve_hiring_manager_for_scope(hiring_scope) to service_role;
revoke execute on function public.revive_dead_leads() from public, anon, authenticated;
grant execute on function public.revive_dead_leads() to service_role;
revoke execute on function public.run_policy_quality_check() from public, anon, authenticated;
grant execute on function public.run_policy_quality_check() to service_role;
revoke execute on function public.sync_automation_status() from public, anon, authenticated;
grant execute on function public.sync_automation_status() to service_role;
revoke execute on function public.webhook_health_check() from public, anon, authenticated;
grant execute on function public.webhook_health_check() to service_role;
revoke execute on function public.weekly_dialer_status(date) from public, anon, authenticated;
grant execute on function public.weekly_dialer_status(date) to service_role;
