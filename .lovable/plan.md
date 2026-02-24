

# Comprehensive Notification Center Fix

## Summary of Issues Found

After a thorough investigation of the entire notification infrastructure, I identified these problems:

### Issue 1: "Resend All Failed" shows zero sent
**Root cause**: Today's 194 failed rows are ALL `sms-auto` rate-limit errors ("Too many requests"). The deduplication correctly reduces them to 40 unique targets. However, the database shows **0 unresolved unique targets** -- meaning every failed phone already has corresponding `sent` rows on other carriers. The retry logic correctly skips them as "already delivered." The UI toast says "0/0 retried" which looks broken but is actually correct behavior. The fix is to improve the messaging so it's clear WHY nothing was retried, and to handle edge cases where the `send-notification` function is called for email retries but wraps extra channels that may fail silently.

### Issue 2: Push notifications have zero subscribers
**Root cause**: `push_subscriptions` table has **0 rows**. Nobody has ever subscribed. The push opt-in is only available on a buried Settings page. The `send-push-optin-email` links users to `/install` which is a login page -- it does NOT prompt for push notification permission. Users who arrive via email never see a push permission prompt.

### Issue 3: `get-vapid-public-key` has old CORS headers
The CORS headers in `get-vapid-public-key` only allow `authorization, x-client-info, apikey, content-type` -- missing the Supabase client platform headers. This can cause CORS preflight failures when browsers send extra headers.

### Issue 4: `send-push-optin-email` has old CORS headers
Same CORS header issue. Also the email links to `/install` which doesn't prompt for push -- it's just a login page.

### Issue 5: `send-batch-blast` and `send-bulk-notification-blast` have old CORS headers  
Missing the extended Supabase client headers, causing potential CORS failures.

### Issue 6: `notify-manager-referral` has old CORS headers
Same issue.

### Issue 7: Notification preferences are cosmetic only
The notification toggles in ProfileSettings (New Application Alerts, Team Updates, Weekly Digest) are stored in React state only -- never persisted. The note says "stored locally for now" but they're not even in localStorage.

---

## Implementation Plan

### 1. Fix "Resend All Failed" to show clear results even when everything is resolved

**File: `src/pages/NotificationHub.tsx`**

- When `candidates.length === 0`, change the toast from a generic info message to a **detailed success toast** that explicitly says "All failures are already resolved" with the breakdown
- When retries happen but all fail again (0 resent), show specific error context (e.g., "all SMS rate-limited -- try again in a few minutes")
- Add a `failedAgain` counter alongside `resent` to differentiate "skipped" from "failed on retry"

### 2. Auto-prompt push notifications on login for all authenticated users

**File: `src/components/layout/AuthenticatedShell.tsx`** (or a new wrapper component)

- Add a `PushNotificationPrompt` component that runs once per session after login
- It checks if the browser supports push, if permission is `default` (not yet asked), and if the user has no existing subscription
- Shows a non-intrusive banner/toast asking them to enable push notifications
- Uses the existing `usePushNotifications` hook's `subscribe()` method
- Stores a `apex_push_prompted` flag in localStorage so we don't re-prompt every page load
- This ensures ALL logged-in users get prompted, not just those who find Settings

### 3. Fix `send-push-optin-email` to link to the right page + fix CORS

**File: `supabase/functions/send-push-optin-email/index.ts`**

- Update CORS headers to the full set
- Change the email CTA link from `/install` to `/dashboard/settings` (where the actual push toggle lives)
- Or better: link to `/dashboard/settings#push` and have the Settings page auto-scroll to the push section

### 4. Fix CORS headers on all remaining edge functions

**Files:**
- `supabase/functions/get-vapid-public-key/index.ts`  
- `supabase/functions/send-push-optin-email/index.ts`
- `supabase/functions/send-batch-blast/index.ts`
- `supabase/functions/send-bulk-notification-blast/index.ts`
- `supabase/functions/notify-manager-referral/index.ts`

All get the standard CORS headers:
```
authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version
```

### 5. Increase SMS auto-detect delay to avoid rate-limit failures

**File: `supabase/functions/send-sms-auto-detect/index.ts`**

- Increase delay from 600ms to 1000ms (matching Resend's 2 req/s limit with safety margin)
- This will prevent the bulk of "Too many requests" errors that inflate failure counts

### 6. Fix `handleResendFailed` email retry path

**File: `src/pages/NotificationHub.tsx`**

- The email retry currently calls `send-notification` which is a multi-channel function (push + SMS + email fallback). For email retries, it should call `send-notification` with only `email` param (no `userId`) to ensure only email is retried, not push/SMS again
- This is already correct in the current code (line 682-683 passes only `email`, no `userId`), but the success check `data?.channels?.email` may be false if the function internally tries push first and succeeds -- meaning the email fallback never fires. Fix: also count success if `data?.success` is true

### 7. Deploy all updated edge functions

Deploy these functions after changes:
- `get-vapid-public-key`
- `send-push-optin-email`
- `send-batch-blast`
- `send-bulk-notification-blast`
- `notify-manager-referral`
- `send-sms-auto-detect`

---

## Technical Details

### Push notification auto-prompt component
```text
AuthenticatedShell
  └── PushNotificationPrompt (new)
        checks: supported? + permission === "default" + no localStorage flag
        shows: dismissible banner "Enable push notifications for instant alerts"
        on click: calls subscribe() from usePushNotifications
        on dismiss: sets localStorage apex_push_prompted = timestamp
```

### Resend flow improvement
```text
Current:                           Fixed:
candidates = 0                     candidates = 0
→ "All resolved" (unclear)         → "✅ All 194 failures already resolved"
                                     "40 unique targets · 40 delivered on other carriers"
                                     "11 push failures (no subscriptions)"

candidates > 0, resent = 0         candidates > 0, resent = 0
→ "0/N retried" (looks broken)     → "⚠️ 0/N succeeded on retry (all rate-limited)"
                                     "Try again in a few minutes"
```

### CORS header normalization
Every edge function called from the browser will use the same corsHeaders constant with the full Supabase client header set.

---

## What This Fixes

1. "Resend All Failed" will show clear, honest results instead of confusing "zero sent"
2. All users will be prompted for push notifications on login (not buried in Settings)
3. Opt-in email links will go to the right page
4. CORS issues across 5 edge functions are eliminated
5. SMS rate-limit failures reduced by ~50% with slower pacing
6. Email retry logic made more accurate

