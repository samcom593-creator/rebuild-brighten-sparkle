
Immediate diagnosis (from current code + logs)
- Recruiting flow is partially blocked by UX/layout and action visibility in Recruiter HQ:
  - `DashboardCRM.tsx` table shell uses `min-w-[800px]`, which is too narrow for dense ops usage; actions are hidden in expanded rows, making “can’t access right-side controls” feel like a lock.
- Email actions still fail silently in key paths:
  - `QuickEmailMenu.tsx` still uses raw `supabase.functions.invoke("send-outreach-email")` and only checks transport error, not payload-level failure.
  - Recent function logs show `send-outreach-email` failures: “Missing required fields: applicationId and templateType.”
- Notification blast success is overstated:
  - `NotificationHub.tsx` counts many sends as successful when no exception is thrown, even if delivery result indicates failure.
- Manager ranking perception issue is real in data flow:
  - `submit-application` hardcodes fallback `assigned_agent_id` to a single manager/agent ID, which skews ownership/rankings and “who owns which recruits.”

Implementation plan (what I will build)
1) Recruiter HQ usability fix (first, unblock operations)
- In `src/pages/DashboardCRM.tsx`:
  - Increase desktop table width baseline to ops-safe width (`min-w-[1200px]`+).
  - Add sticky right action column so critical controls remain visible.
  - Keep horizontal scroll container (`overflow-x-auto`) and add visual cue when overflow exists.
  - Add explicit visible “Last Contacted” quick action in-row (not buried in expansion).

2) Email reliability hardening (stop silent failures)
- In `src/components/dashboard/QuickEmailMenu.tsx`:
  - Switch to `invokeEdge` wrapper.
  - Add hard guard before send: require `applicationId` + `selectedTemplate`; show precise toast if missing.
  - Surface backend error message directly (not generic “Failed”).
- In pages using QuickEmailMenu:
  - Validate each caller passes correct `applicationId` + `leadSource` consistently.
- In `supabase/functions/send-outreach-email/index.ts`:
  - Return structured errors with explicit missing fields and source context.
  - Add stronger request validation logs (for tracing exact bad payload origin).

3) Notification truthfulness + retry correctness
- In `src/pages/NotificationHub.tsx`:
  - Replace remaining direct invoke paths with `invokeEdge` where applicable.
  - For SMS auto-detect, count success by `data.successCount > 0` (not “no exception”).
  - Show channel-by-channel retry result in UI.
- In `supabase/functions/send-sms-auto-detect/index.ts`:
  - Add stronger 429-aware pacing/backoff for gateway attempts to reduce rate-limit false failures.

4) Manager ownership/ranking integrity fix
- In `supabase/functions/submit-application/index.ts`:
  - Remove hardcoded fallback assignment to single manager ID.
  - If no referral agent selected, set unassigned (or apply deterministic assignment strategy).
- In dashboard manager views:
  - Keep Personal AOP vs Team AOP separated and explicit.
  - Ensure manager drill-down remains clickable and roster-visible for ownership audits.

5) End-to-end validation (must pass before done)
- Recruiter HQ: horizontal access and right-side controls usable at 1280/1366 and laptop zoom levels.
- Email send tests from:
  - Recruiter HQ row email
  - Pipeline/LeadCenter email menu
  - Licensing button
- Backend confirmation:
  - `contact_history` gets new outreach rows
  - `notification_log` reflects actual sent/failed channel outcomes
- Manager data sanity:
  - New applications no longer auto-funnel to one default manager
  - Rankings and team ownership align with actual assignments.

One product decision needed during implementation
- Default assignment policy when no referral manager is selected:
  - A) Leave unassigned for manual routing (most transparent), or
  - B) Auto round-robin among active managers.
I’ll implement A by default unless you want B.
