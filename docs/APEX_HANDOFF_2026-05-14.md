# APEX Handoff Report — 2026-05-14

## Confirmed Findings

1. Public referral link resolution is fragile. `src/pages/Apply.tsx` reads `agents.ref_slug` directly from an anonymous public route; if RLS blocks anon reads, `referrerId` stays null and applications default away from the intended recruiter.
2. Initial application submission sets `assigned_agent_id` and `recruiter_id`, but not `referral_manager_id`. Newer routing and “marked me as referrer” filters expect `referral_manager_id`, so KJ-style visibility can fail.
3. Post-submit referral update can silently fail. `update-application-referral` only permits reassignment from one hardcoded old admin UUID; the frontend catches errors and navigates to success anyway.
4. Seminar invites link to `/seminar?...`, but `SeminarPage.tsx` ignores query params and does not insert into `seminar_registrations`.
5. Manager/agent navigation has dead ends: sidebar exposes manager destinations that are admin-only, notification bell points non-admins to an admin inbox, and command palette exposes admin routes globally.
6. Several production-number paths still use unsafe sources such as `daily_production.aop`, `effective_date`, or polluted lifetime tables instead of canonical `deals.posted_at`.

## Suspected Issues

1. KJ cannot see athletes because referral attribution is split across `assigned_agent_id`, `recruiter_id`, `referral_manager_id`, and `hiring_manager_user_id`, while different pages filter different columns.
2. Manager views may overexpose or underexpose data depending on RLS and client-side filtering. Some pages fetch all applications for managers and rely on optional UI filters.
3. AgentLink/InsuraCloud legacy endpoints can still create phantom attribution if missing mappings fall back to Sam/default IDs.
4. Dashboard and leaderboard numbers can disagree with AgentLink because some functions and SQL snapshots still use `effective_date` or `daily_production`.

## Exact Next Steps

1. Add a service-role edge function to resolve `ref_slug -> agent id, name, user_id` and update `/apply` to use it.
2. Patch `submit-application` to insert `referral_manager_id: selectedReferralAgentId || recruiterId || null`.
3. Patch `update-application-referral` to detect unclaimed/default assignment dynamically, not by hardcoded UUID, and make frontend failure visible.
4. Backfill existing applications where `referral_manager_id IS NULL AND recruiter_id IS NOT NULL`.
5. Update visibility filters to OR across `assigned_agent_id`, `referral_manager_id`, `recruiter_id`, and `hiring_manager_user_id` where appropriate.
6. Build `/seminar` registration: idempotent insert from email/application query params or a short form, then surface registrations to managers/admins.
7. Extend `scripts/check-metric-truth.mjs` to scan all Supabase functions and SQL migrations for forbidden sales truth sources.
8. Replace remaining ALP/deal leaderboards with `deals.posted_at` Chicago windows and valid deal statuses.

## Files To Inspect Next

- `src/pages/Apply.tsx`
- `supabase/functions/submit-application/index.ts`
- `supabase/functions/update-application-referral/index.ts`
- `supabase/functions/get-active-managers/index.ts`
- `supabase/functions/notify-manager-referral/index.ts`
- `src/pages/SeminarPage.tsx`
- `supabase/functions/send-seminar-invite-blast/index.ts`
- `src/pages/CallCenter.tsx`
- `src/pages/DashboardApplicants.tsx`
- `src/pages/HiringPipeline.tsx`
- `src/pages/AgentPipeline.tsx`
- `src/pages/PrelicensingManager.tsx`
- `src/components/layout/GlobalSidebar.tsx`
- `src/components/layout/NotificationBell.tsx`
- `src/components/command/CommandPalette.tsx`
- `scripts/check-metric-truth.mjs`
- `api/sync-insuracloud.ts`
- `supabase/functions/agentlink-import/index.ts`
- `supabase/functions/discord-leaderboards/index.ts`
- `supabase/migrations/20260428000000_truth_layer_rpcs_to_deals.sql`
- `supabase/migrations/20260422040000_agentlink_top_producers_rewards.sql`

## Smaller Codex Follow-Up Prompts

1. “Patch only the APEX referral application path so `/apply?ref=slug` reliably credits the right agent. Do not touch dashboards.”
2. “Patch only KJ/manager lead visibility across CallCenter, DashboardApplicants, HiringPipeline, and AgentPipeline. Keep scope to filtering and RLS assumptions.”
3. “Patch only `/seminar` registration so invite links create one `seminar_registrations` row and managers can see attendance.”
4. “Patch only metric-truth guardrails: expand `check-metric-truth.mjs` and fix any failing `daily_production.aop`/`effective_date` sales metric uses.”
5. “Patch only navigation dead ends: role-aware sidebar, notification bell destination, and command palette filtering.”

## Files Inspected In This Session

Directly inspected: `AGENTS.md`, `FIXES_PRIORITY_1.md`, `src/App.tsx`, `src/pages/Apply.tsx`, `src/pages/HiringPipeline.tsx`, `src/pages/DashboardApplicants.tsx`, `src/pages/CallCenter.tsx`, `src/pages/RecruitCommandCenter.tsx`, `src/pages/PrelicensingManager.tsx`, `src/pages/Join.tsx`, `src/pages/AgentSignup.tsx`, `src/hooks/useAuth.ts`, `src/lib/metricTruth.ts`, `src/lib/dateUtils.ts`, `src/components/agent/AgentReferralLinkCard.tsx`, `src/components/dashboard/QuickInviteLink.tsx`, `src/components/dashboard/ManagerInviteLinks.tsx`, `src/integrations/supabase/client.ts`, `supabase/functions/submit-application/index.ts`, `supabase/functions/update-application-referral/index.ts`, `supabase/functions/notify-manager-referral/index.ts`, `supabase/functions/get-active-managers/index.ts`, `supabase/functions/agent-signup/index.ts`, `supabase/functions/manager-signup/index.ts`, `supabase/migrations/20260504143000_route_applicants_by_referrer.sql`, `supabase/migrations/20260430000000_fix_auto_assign_trigger.sql`, `docs/prompt-pack/MASTER_APEX_WEBSITE_PERFECTION.md`, `docs/prompt-pack/PROMPT_TEMPLATE.md`, `docs/prompt-pack/METRICS_AND_LEADERBOARDS.md`, `docs/prompt-pack/RECRUITING_AND_LICENSING.md`, `docs/prompt-pack/UX_NAV_PERFORMANCE.md`, `docs/metric_audit.md`.

Memory/context inspected: `project_apex.md`, `apex_source_of_truth_agentlink.md`, `apex_master_prompt_progress.md`, `apex_agent_link_live_pull.md`, `apex_status_sync_fix.md`, `apex_celebration_attribution_bug.md`, `apex_business_overview.md`, `apex_bot_sql_access.md`.

Subagents additionally reported on: `api/sync-insuracloud.ts`, `supabase/functions/agentlink-import/index.ts`, `supabase/functions/discord-leaderboards/index.ts`, `supabase/functions/morning-brief/index.ts`, `supabase/functions/send-daily-sales-leaderboard/index.ts`, `supabase/functions/notify-top-performers-morning/index.ts`, `src/pages/DashboardCommandCenter.tsx`, `src/pages/AgentManagement.tsx`, `src/pages/Dashboard.tsx`, `src/pages/AgentPortal.tsx`, `src/pages/MyTeam.tsx`, `src/pages/RecruiterDashboard.tsx`, `src/components/layout/GlobalSidebar.tsx`, `src/components/layout/MobileBottomNav.tsx`, `src/components/command/CommandPalette.tsx`, `src/components/layout/NotificationBell.tsx`, `src/components/deals/DealEntryForm.tsx`, `src/pages/MyDeals.tsx`, `src/pages/Leaderboard.tsx`.

## Files Changed

- `docs/APEX_HANDOFF_2026-05-14.md`

No implementation files were changed.
