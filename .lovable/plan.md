
# Fix: No Pickup Error, Tab Reloading, and Fill Numbers Emails

## Issues Found

### 1. "No Pickup" Database Error
The `application_status` enum in the database only allows: `new`, `reviewing`, `interview`, `contracting`, `approved`, `rejected`. When you click "No Pickup" on an application lead, the code tries to set `status = "no_pickup"` which the database rejects because that value isn't in the enum. Aged leads work fine because their `status` column is plain text.

**Fix:** Add `no_pickup` to the `application_status` database enum via a migration.

### 2. Page Reloading on Tab Switch / Instagram Return
When you leave the app (e.g., tap an Instagram link, switch tabs) and come back, the authentication system detects a token refresh event. This triggers `setUser()` with a new object reference, which cascades re-renders through the entire app -- re-fetching the agent ID, profile, roles, and in the Call Center, potentially re-triggering data loads.

**Fix:** In `useAuth.ts`, skip redundant state updates on `TOKEN_REFRESHED` events when the user ID hasn't changed. In `CallCenter.tsx`, stabilize the `agentId` effect so it doesn't re-run on every user object change (use `user?.id` instead of `user`).

### 3. Fill Numbers Reminder Emails Not Sending
The `notify-fill-numbers` edge function exists and is properly coded, but it's never triggered -- there's no cron job, no scheduled task, and no frontend code that calls it. It needs to be invoked on a schedule (10am, 4pm, 6pm, 9pm CST).

**Fix:** Create a lightweight cron-dispatcher edge function that the platform's cron can call, or document that these need to be triggered externally. Since Lovable Cloud doesn't support native cron, the best approach is to create a single `cron-dispatcher` edge function that checks the current CST time and calls `notify-fill-numbers` with the appropriate reminder type, then set up an external cron service (or add a manual "Send Reminders" button in the admin dashboard for now).

---

## Technical Details

### Database Migration
```sql
ALTER TYPE application_status ADD VALUE 'no_pickup';
```

### File: `src/hooks/useAuth.ts`
- In the `onAuthStateChange` callback (line 88-118), add a guard: if the event is `TOKEN_REFRESHED` and the user ID hasn't changed, skip calling `fetchProfile` and `fetchRoles` again. Just update the session silently.

### File: `src/pages/CallCenter.tsx`
- Line 78-89 (`fetchAgentId` effect): Change dependency from `[user]` to `[user?.id]` so it only re-runs when the actual user identity changes, not on every token refresh.

### Fill Numbers Emails
- Add a "Send Fill Numbers Reminder" button to the admin dashboard (or a dedicated admin action) that manually invokes the `notify-fill-numbers` edge function with the appropriate reminder type.
- This gives immediate control without needing external cron infrastructure.

### File: `src/components/callcenter/CallCenterLeadCard.tsx`
- No changes needed -- the Instagram link already uses `target="_blank"` correctly.

## Files to Modify
- Database migration (add `no_pickup` to `application_status` enum)
- `src/hooks/useAuth.ts` -- prevent redundant fetches on token refresh
- `src/pages/CallCenter.tsx` -- stabilize `user` dependency to `user?.id`
- `src/pages/DashboardAdmin.tsx` (or similar) -- add manual "Send Fill Numbers Reminder" button
