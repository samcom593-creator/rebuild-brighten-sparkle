
Goal: “Head-to-toe” verify every approved prompt is actually done, and close the remaining gaps that still make recruiting/notifications feel unreliable.

## What I already verified in your code + backend (current state)
1) **Manager visibility (RLS)**
- `applications` now has manager SELECT/UPDATE policies allowing managers to see/update apps assigned to themselves OR their sub-agents. Confirmed via live policies list.

2) **Dashboard date + “My Directs”**
- `src/pages/Dashboard.tsx` now passes `dateRange` + `myDirectsOnly` into `fetchDashboardData()` and filters results.

3) **Aged Leads horizontal scrolling**
- `src/pages/DashboardAgedLeads.tsx` table is wrapped with `overflow-x-auto` and has `min-w-[1000px]`.

4) **Email sending guardrails**
- `src/components/dashboard/QuickEmailMenu.tsx` uses `invokeEdge("send-outreach-email")` and blocks send if `applicationId` is missing.
- `supabase/functions/send-outreach-email/index.ts` returns structured 400s for missing fields.

5) **Truthful multi-channel UI behavior (partial)**
- `src/lib/edgeInvoke.ts` correctly throws on `data.success === false` and throws if `channels` indicates all failed.
- `supabase/functions/send-notification/index.ts` sets `success:false` when all channels fail (but see “Remaining gaps” below about HTTP status + broader usage).

## Remaining gaps I found (these are why it can still “feel broken”)
### A) Unreferred applications are STILL being auto-assigned to a single default agent
- DB trigger `trg_auto_assign_application` calls `public.auto_assign_unassigned_application()` which forces:
  - `NEW.assigned_agent_id := '7c3c5581-3544-437f-bfe2-91391afb217d'` when null.
- Even though `submit-application` now passes `null` when no referral is selected, the DB trigger still funnels them to that same agent.

**Fix depends on your decision (still unanswered):**
- Option 1: Leave truly unassigned (no automatic assignment)
- Option 2: Round-robin auto-assign across active managers

### B) Push looks “dead” in logs because pushes are being attempted/logged in the wrong place
What the backend shows:
- `push_subscriptions` has **9** rows (so push enrollment exists for some internal users).
- But `notification_log` shows **push_sent = 0** in last 30 days, **push_failed = 31**, all with `recipient_user_id = null`.
- Those “push failed” entries are coming from `send-batch-blast` which tries to resolve a push target by matching lead email to a profile user. Most leads don’t have accounts, so it logs “No push subscriptions” even though it never had a real user to target.

So there are two separate issues:
1) Bulk blasts are logging misleading push failures for non-users.
2) Internal push sending (to agents/managers/admin) is not consistently logged into `notification_log`, so you don’t get a clean audit trail of real push deliveries.

### C) NotificationHub still uses raw `supabase.functions.invoke()` in many paths
- NotificationHub has many loops using `supabase.functions.invoke()` without standardizing “truthful success” checks (some do, some don’t).
- It also calls SMS auto-detect in loops; your `notification_log` shows fresh **429 rate-limit failures** (“2 requests/sec”), which creates “it said it sent but didn’t” moments during bursts.

### D) `send-notification` still returns HTTP 207 on total failure
- It returns `{ success:false }` (good), but uses status **207** (still treated as “OK-ish” by many clients).
- Your `invokeEdge` wrapper catches `success:false`, but any place calling `supabase.functions.invoke("send-notification")` directly (now or in the future) can mis-handle 207.

## Plan to make this “done for real” (implementation steps)
### 1) Finalize lead routing behavior (DB)
**You choose one:**
- **Leave unassigned:** Update `public.auto_assign_unassigned_application()` so it does not overwrite `assigned_agent_id` when null.
- **Round-robin:** Replace `public.auto_assign_unassigned_application()` with logic that selects the next active manager (or least-loaded manager) and assigns `assigned_agent_id` accordingly. (This likely requires a small helper table like `assignment_rotation_state` OR a deterministic “least open leads” query.)

Deliverable:
- A DB migration updating the function (and possibly adding a small state table if round-robin).

### 2) Make push reporting truthful + useful (backend)
A. **Stop logging fake push failures for non-auth users**
- Update `supabase/functions/send-batch-blast/index.ts`:
  - Only attempt push if you can resolve a real `recipient_user_id`.
  - If no user_id exists, do not write a push row to `notification_log` (or log as `skipped` with explicit reason if you want visibility).

B. **Centralize push logging**
- Update `supabase/functions/send-push-notification/index.ts` to optionally:
  - Write to `notification_log` with `recipient_user_id`, `status`, and an error reason per user when it fails.
  - Return a structured result like:
    - `sent`, `total`, `failedUserIds`, and optional failure reasons.
This makes push auditable the same way email/SMS is.

### 3) Fix `send-notification` to follow the “truthful status code” standard
- Update `supabase/functions/send-notification/index.ts`:
  - If all channels fail: return **HTTP 500** (or 424) with `{ success:false, channels, errors }`.
  - If any channel succeeds: return **200** with `{ success:true, channels, errors }`.
- Keep the current per-channel logging into `notification_log`.

### 4) Remove false-success behavior in NotificationHub + reduce rate-limit failures
In `src/pages/NotificationHub.tsx`:
- Replace the remaining `supabase.functions.invoke(...)` “blast loops” with:
  - `invokeEdge(...)` where appropriate, OR
  - explicit checks on returned `data` (e.g., `successCount > 0`) before counting as success.
- Add pacing/backoff in client loops:
  - hard delay between sends (and/or batch size reduction)
  - on rate-limit error, pause longer (e.g., 2–5s) and retry once, then skip to next.
- Ensure all toasts reflect “any channel succeeds” (you selected this) and show channel breakdown when available.

### 5) End-to-end verification checklist (this is the “make sure it’s done” pass)
After implementing the above, we’ll validate with real actions and confirm both delivery + logs:

1) **Lead routing**
- Submit an application with no referral:
  - Confirm `assigned_agent_id` matches your chosen behavior (null OR round-robin), and does not silently funnel to the old default.

2) **Email**
- From Pipeline / Recruiter HQ: send an outreach email via QuickEmailMenu
  - Confirm: email arrives
  - Confirm: `notification_log` has `email: sent` row
  - Confirm: UI toast success matches backend result

3) **Push**
- From an internal user workflow that targets real users (agent/manager/admin), trigger a push:
  - Confirm: a push is delivered to at least one subscribed test user
  - Confirm: `notification_log` records `push: sent` with a real `recipient_user_id` (not null)

4) **SMS Auto**
- Trigger SMS auto-detect for 1–2 leads:
  - Confirm: no immediate 429 spam
  - Confirm: `notification_log` reflects sent vs failed accurately

## Files / areas that will change (next implementation pass)
Backend:
- `supabase/functions/send-notification/index.ts` (status codes + error payload detail)
- `supabase/functions/send-push-notification/index.ts` (optional logging + per-user failure reporting)
- `supabase/functions/send-batch-blast/index.ts` (skip fake push attempts; only log meaningful push)
Database:
- Migration updating `public.auto_assign_unassigned_application()` (and possibly adding a small helper table if round-robin)
Frontend:
- `src/pages/NotificationHub.tsx` (standardize success detection + backoff/pacing)

## One missing input from you (required to finish “done”)
- Lead routing choice for unreferred applications: **Leave unassigned** vs **Round-robin auto-assign**.
