

# Fix All Notifications: Multi-Channel Delivery + Mandatory Push Enrollment

## Root Cause

The notification system has two critical architectural flaws:

1. **Most `notify-*` functions bypass `send-notification`** — they send email directly via Resend without attempting push or SMS. Only 3 frontend call sites use `send-notification`. The ~30 `notify-*` edge functions each implement their own email-only delivery.

2. **Push adoption is 9%** (5/55 users). The prompt is too easy to dismiss and never reappears after first choice. Agents who denied or dismissed never get prompted again.

**Result: Zero successful push notifications have ever been delivered system-wide.**

## Plan

### 1. Make Push Prompt Blocking (PushNotificationPrompt)

**File:** `src/components/layout/PushNotificationPrompt.tsx`

- Show a **full-screen overlay** (not a dismissible floating card) on first load for users who haven't made a choice
- Remove the dismiss button — force users to click "Enable" or "Not Now"
- "Not Now" saves a `localStorage` timestamp and re-prompts after 24 hours
- Only stop prompting after browser permission is explicitly set to "granted" or "denied"
- Show on EVERY page load until resolved (not just once per session)

### 2. Route All `notify-*` Functions Through `send-notification`

Instead of rewriting 30+ edge functions, update the 8 most critical ones to call `send-notification` (which handles push + SMS + email):

**Critical functions to update:**

| Function | Current | Change |
|----------|---------|--------|
| `notify-lead-assigned` | Email only | Add push via `send-push-notification` to the assigned agent's `user_id` |
| `notify-deal-alert` | Email only | Add push to agent's `user_id` |
| `notify-production-submitted` | Email only | Add push to agent + manager |
| `notify-stage-change` | Email only | Add push to assigned agent |
| `notify-hire-announcement` | Email only | Add push to all managers |
| `notify-fill-numbers` | Has push but emails `info@` | Fix admin email to `sam@` |
| `notify-lead-closed` | Email only | Add push to agent + manager |
| `notify-notes-added` | Email only | Add push to manager |

For each function, add a call to `send-push-notification` with the target user's `user_id` (resolved via agents → profiles lookup) BEFORE the existing email send. This is the same pattern already used in `send-notification`.

### 3. Fix `notify-lead-assigned` Admin Email

**File:** `supabase/functions/notify-lead-assigned/index.ts`

- Change `ADMIN_EMAIL` from `"info@apex-financial.org"` to `"sam@apex-financial.org"`
- Add push notification to the assigned agent (look up `user_id` from agent record → call `send-push-notification`)
- Add push notification to the agent's manager (look up `invited_by_manager_id` → `user_id`)

### 4. Auto-Subscribe Users on Login

**File:** `src/hooks/usePushNotifications.ts`

- Add an `autoSubscribe()` function that checks if the user has an existing push subscription in the DB
- If they don't, and browser permission is "granted", automatically re-register the service worker subscription and save it
- This catches users who cleared browser data or switched devices

### 5. Fix `send-application-notification` Admin Email

**File:** `supabase/functions/send-application-notification/index.ts`

- Change admin email from `"info@apex-financial.org"` to `"sam@apex-financial.org"` (line 131)

### 6. Fix Orphaned Manager Profile

**Database migration:** The manager with `user_id = c1a2b3d4-e5f6-7890-abcd-ef1234567890` has no profile record. Create one or clean up the orphan.

## Files Modified

| File | Change |
|------|--------|
| `src/components/layout/PushNotificationPrompt.tsx` | Full-screen mandatory prompt with 24h re-prompt on dismiss |
| `src/hooks/usePushNotifications.ts` | Add auto-resubscribe on login if permission already granted |
| `supabase/functions/notify-lead-assigned/index.ts` | Add push, fix admin email |
| `supabase/functions/notify-deal-alert/index.ts` | Add push to agent |
| `supabase/functions/notify-production-submitted/index.ts` | Add push to agent + manager |
| `supabase/functions/notify-stage-change/index.ts` | Add push to agent |
| `supabase/functions/notify-hire-announcement/index.ts` | Add push to all managers |
| `supabase/functions/notify-lead-closed/index.ts` | Add push to agent + manager |
| `supabase/functions/notify-notes-added/index.ts` | Add push to manager |
| `supabase/functions/send-application-notification/index.ts` | Fix admin email |
| Database migration | Clean up orphaned manager profile |

