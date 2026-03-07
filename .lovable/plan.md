
Problem re-stated
- You’re clicking actions, seeing success UI, but emails/notifications are not reliably going out.
- I verified this is not just one bug; it’s a chain of UI + backend response issues.

What I found (from code + logs)
1) False-success UI in action handlers
- Multiple dashboards call `supabase.functions.invoke(...)` but do not check `{ error, data }`.
- They show success toasts even when the function returned a failure payload.
- Key files:
  - `src/pages/RecruiterDashboard.tsx`
  - `src/pages/DashboardCRM.tsx`
  - `src/pages/NotificationHub.tsx`

2) Recruiter page runtime crash blocks actions
- Error logs show: `Cannot read properties of null (reading 'includes')` on recruiter route.
- Root cause in `src/pages/RecruiterDashboard.tsx` search filter:
  - `l.email.toLowerCase()` and `l.phone.includes()` run without null guards.
- This can break interaction flow and make actions feel “not working.”

3) `send-notification` returns success even when nothing is delivered
- `supabase/functions/send-notification/index.ts` currently returns:
  - `{ success: true, channels: { push/sms/email false... } }` even when all fail.
- Frontend interprets this as success, masking real failures.

4) Payload mismatch in check-in notifications
- `src/pages/ApplicantCheckin.tsx` sends `type: "checkin_help_request"` payload to `send-notification`.
- `send-notification` expects `userId` or `email`; this mismatch causes silent non-delivery behavior for that flow.

5) System health is generally up
- Health checks (`health_check_log`) show synthetic email/sms/push mostly passing.
- So the biggest issues are correctness/reporting and specific flow wiring, not total provider outage.

Implementation plan (immediate)
Phase 1 — Stop false positives (highest priority)
- Add a shared client helper to normalize edge-function results:
  - Throw when `error` exists.
  - Throw when response has `success: false`.
  - Throw when channel-specific success is false (e.g., SMS `successCount === 0`).
- Apply it to all recruiter/CRM notification actions.
- Files:
  - `src/lib/edgeInvoke.ts` (new helper)
  - `src/pages/RecruiterDashboard.tsx`
  - `src/pages/DashboardCRM.tsx`
  - `src/pages/NotificationHub.tsx`

Phase 2 — Fix recruiter crash and null-safe data
- Null-guard all searchable/contact fields (`email`, `phone`) in recruiter filtering.
- Normalize fetched leads so missing values become empty strings at mapping boundary.
- File:
  - `src/pages/RecruiterDashboard.tsx`

Phase 3 — Make backend delivery truthfully report status
- Update `send-notification` to return meaningful status:
  - `success = results.push || results.sms || results.email`
  - include per-channel failure reasons in response
  - return non-2xx when no channel delivered (so UI can correctly show failure)
- Keep `notification_log` writes for traceability.
- File:
  - `supabase/functions/send-notification/index.ts`

Phase 4 — Repair check-in help alert flow
- Either:
  A) add `checkin_help_request` handling in `send-notification`, or
  B) route check-in help to a dedicated function with explicit recipient resolution (preferred for clarity).
- Update UI text so it only says “manager/admin notified” after confirmed delivery.
- Files:
  - `src/pages/ApplicantCheckin.tsx`
  - `supabase/functions/send-notification/index.ts` (or new `notify-checkin-help` function)

Phase 5 — Harden operator visibility
- Add delivery result toast detail:
  - Example: “Email sent, Push failed (no subscription), SMS failed (rate limit)”.
- Add quick “View last attempt” link to Notification Hub for immediate debugging.
- Files:
  - `src/pages/RecruiterDashboard.tsx`
  - `src/pages/NotificationHub.tsx`

Verification plan (must pass)
1) Recruiter HQ: no `null.includes` runtime errors while typing search.
2) Send Push/SMS from recruiter row:
- success toast only when channel actually delivered.
- failure toast shows reason when not delivered.
3) CRM actions (portal login/course login/manual follow-up):
- success/failure toasts match real function outcome.
4) Applicant check-in “needs help”:
- creates actual outbound notification path and confirmed log.
5) Database confirmation:
- new attempts appear in `notification_log` with accurate `sent/failed` per channel.
6) End-to-end manual click-through:
- Recruiter HQ, CRM, Notification Hub flows tested from UI through delivery logs.

Scope + safety
- No schema migration required for this fix set.
- No RLS policy changes required for delivery repair.
- Changes are code-level only (frontend + backend functions), focused on correctness and honest status reporting.
