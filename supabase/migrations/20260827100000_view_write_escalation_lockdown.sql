-- MP-325 (class sweep): 28 reporting views granted INSERT/UPDATE/DELETE to
-- `authenticated`. All are AUTO-UPDATABLE (single-table, no aggregate), and 27 of
-- 28 are owner-run (no security_invoker=true), so a write through them executes as
-- the view owner and BYPASSES the base table's RLS entirely.
--
-- PROVEN, not inferred: before this migration a plain non-staff agent
-- (Johnathan Carter d6635596-...) successfully ran
--   UPDATE v_profile_directory SET full_name='...' WHERE user_id <> <self>
-- and rewrote another user's row. Rolled back. The 28 below share that exact shape.
--
-- CAUSE: this database has default privileges granting ALL on new relations to
-- `authenticated`, so every CREATE VIEW silently ships a write path unless the
-- author revokes. Nobody was revoking -- these read as harmless reporting views.
--
-- SAFE BECAUSE: zero writes through any of these 28 exist in src/ or
-- supabase/functions/ (verified by AST-ish scan for .insert/.update/.delete/.upsert
-- within 200 chars of a .from("<view>")). Edge functions use service_role, whose
-- grants are untouched here. SELECT is preserved on every view.
--
-- This does NOT claim the class is now closed forever: the default privilege that
-- created it is still in place, so the NEXT view ships the same hole.
-- apex-doctor Check #31 owns the recurrence.

do $$
declare v text;
begin
  foreach v in array array[
    'v_agent_canonical_map','v_agent_crm_active','v_agent_referrals',
    'v_agents_missing_al_user_id','v_agents_status_deac_mismatch',
    'v_bot_alert_delivery_truth','v_critical_losses_open','v_deals_leaderboard',
    'v_deals_needing_real_policy','v_hire_notification_gaps','v_ica_paid_missing_data',
    'v_insuracloud_push_blocked','v_insuracloud_push_eligible','v_insuracloud_push_refused',
    'v_insuracloud_push_verdict','v_lead_purchases_today','v_leads_orphan_rewrite',
    'v_my_applications','v_readymode_ingest_health','v_sam_inbox','v_sam_today_tasks',
    'v_sam_todo_blocker_source','v_sam_todo_manual_source','v_schedule_auto_events',
    'v_stripe_refund_watch','v_telegram_stuck_users','v_unclaimed_new_apps','v_va_call_queue'
  ] loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', v);
  end loop;
end $$;
