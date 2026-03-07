
Goal
- Stabilize core operational dashboards so they are usable (especially Recruiter HQ horizontal scrolling), correct manager comparison logic/visibility, fix wrong “View Application” target mapping, and make notification/email delivery status truthful and auditable.

What I found
1) Recruiter HQ is horizontally locked by layout
- In `src/pages/RecruiterDashboard.tsx`, desktop table uses a raw `<table>` inside `overflow-hidden` with no horizontal scroll container + no minimum table width.
- Result: right-side columns/actions can be clipped with no way to pan.

2) “View Application” can show the wrong person in CRM
- In `src/pages/DashboardCRM.tsx`, expanded row uses `onViewApp(agent.id)` and opens sheet by `agentId`.
- `ApplicationDetailSheet` then fetches latest application by `assigned_agent_id`, which can return someone else’s lead, not that agent’s own application.

3) Manager comparison is not operationally drillable
- `src/components/dashboard/TeamOverviewDashboard.tsx` shows stacked bars but no click-through to see who is under each manager.
- Current list emphasizes total only; user needs clear Personal AOP vs Team AOP and agent roster validation.

4) Notification/email trust gap
- Email rows in backend logs are mostly “sent,” but UI still has multiple places with optimistic success patterns and uneven error detail.
- `NotificationHub` retry flow still does direct invokes and partial checks.
- Check-in help call (`ApplicantCheckin`) still invokes notification directly without shared strict response handling.
- SMS gateway retries are hitting provider rate limits in logs; this muddies “notification sent” confidence.

Implementation plan
Phase 1 — Unblock dashboard usability immediately
- Recruiter HQ table shell hardening:
  - Wrap desktop table in `overflow-x-auto`.
  - Add `min-w-[1200px]` (or similar) on table to force scroll region.
  - Keep important columns readable with truncation + `whitespace-nowrap` on dense cells.
- Apply same table-shell standard to other core operational pages where needed (CRM/Aged Leads sections that can compress under medium widths).

Files
- `src/pages/RecruiterDashboard.tsx`
- `src/pages/DashboardCRM.tsx` (table containers)
- `src/pages/DashboardAgedLeads.tsx` (table container consistency)

Phase 2 — Fix wrong application mapping in CRM
- Build and store each agent’s own application id during `fetchAgents` (by normalized email match, same pass used for license progress).
- Pass `applicationId` to “View Application” whenever available; only fallback to `agentId` if no application exists.
- Update expanded row action to call `onViewApp({ applicationId, agentId })` so sheet opens the correct record.

Files
- `src/pages/DashboardCRM.tsx`
- `src/components/dashboard/ApplicationDetailSheet.tsx` (tighten fallback resolution rules)

Phase 3 — Make manager comparison actionable and transparent
- Upgrade `TeamOverviewDashboard` manager section:
  - Add metric toggle: Team AOP / Personal AOP / Total AOP.
  - Show explicit values per manager row: `Personal`, `Team`, `Total`.
  - Make manager rows clickable to expand direct agent roster (name, onboarding stage, weekly/monthly AOP).
- Add “Open Team Hierarchy” CTA from expanded manager row for reassignment verification/fixes.

Files
- `src/components/dashboard/TeamOverviewDashboard.tsx`
- `src/pages/Dashboard.tsx` (if passing filters/state needed)

Phase 4 — Notification/email reliability and truthful UX
- Standardize edge call handling everywhere critical with `invokeEdge`:
  - Check-in help alerts
  - NotificationHub retry email path
  - Any remaining direct notification invokes in recruiter/CRM paths
- Return/consume structured results (`success`, channel booleans, reason list) and show exact toast outcome.
- Add resilient retry pacing for high-volume SMS retry paths to reduce rate-limit false negatives.
- Add “last delivery attempt detail” UI in Notification Hub (per attempt reason, not just success/fail badge).

Files
- `src/pages/ApplicantCheckin.tsx`
- `src/pages/NotificationHub.tsx`
- `src/pages/RecruiterDashboard.tsx` (remaining direct calls)
- `src/lib/edgeInvoke.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/send-sms-auto-detect/index.ts` (retry pacing/backoff tuning)

Technical details
- No schema migration required for these fixes.
- Key logic correction: CRM app detail should resolve by the person’s own application identity (email/app id), not by `assigned_agent_id` lookup for expanded agent rows.
- UX standard for dense ops tables:
  - container: `overflow-x-auto`
  - table: explicit `min-w-*`
  - text cells: `min-w-0 truncate`
  - actions: fixed icon targets (`h-8 w-8`) with labels via tooltip/title/aria.
- Notification truth model:
  - UI success only when backend confirms `success === true` and at least one channel succeeded (where relevant).
  - Explicit user-facing failure reasons from returned payload.

Validation checklist
1) Recruiter HQ desktop: can horizontally scroll to rightmost columns/actions at 1280/1366 widths.
2) CRM “View Application” opens the correct person’s application for at least 10 random records.
3) Dashboard manager comparison:
   - displays Personal + Team + Total values clearly
   - clicking manager reveals direct roster.
4) NotificationHub retry:
   - success toasts only on confirmed delivery
   - failure toasts include channel reason.
5) Applicant check-in “needs help”:
   - logs a real outbound notification attempt and reports actual result.
6) End-to-end manual pass across Recruiter HQ, CRM, Dashboard manager comparison, Notification Hub.
