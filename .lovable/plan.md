

# Fix Notification Delivery & Add Admin CC Everywhere

## Root Cause Analysis

After inspecting the edge functions and logs:

1. **`send-notification` (central hub) sends email ONLY as a fallback** — if push or SMS succeeds, no email goes out. This means you never get CC'd on most notifications.
2. **`send-notification` has NO admin CC** — even when emails do send, your address isn't included.
3. **`send-push-notification` is silently failing** — zero logs found, meaning push notifications from RecruiterHQ never actually deliver. The function uses a complex Web Crypto encryption approach that likely errors before sending.
4. **SMS via carrier gateway has no admin CC** — you're not included in SMS sends.
5. **Some functions use `sam@apex-financial.org`, others use `info@apex-financial.org`** — inconsistent admin email across ~70+ edge functions.

## Fix Plan

### 1. Fix `send-notification/index.ts` — Always send email + CC admin

- Change email from "fallback only" to "always send alongside push/SMS"
- Add `cc: ["sam@apex-financial.org"]` to every email send
- Add admin SMS: after sending SMS to the lead, also send the same SMS text to admin's phone via carrier gateway (need admin phone number)

### 2. Fix `send-push-notification/index.ts` — Add error logging

- Add `console.error` logging around the Web Crypto encryption so failures are visible
- Return meaningful error responses instead of silent failures

### 3. Fix `send-sms-auto-detect/index.ts` — CC admin on SMS

- After sending SMS to all carrier gateways for the lead, also send a copy to admin's phone number
- This lets you know SMS was attempted

### 4. Standardize admin CC across key notification functions

Update these high-traffic functions that currently lack admin CC:
- `notify-notes-added` — add CC
- `notify-training-reminder` — add CC  
- `notify-attendance-missing` — add CC
- `notify-evaluation-due` — add CC
- `notify-evaluation-result` — already has admin, just standardize email
- `send-notification` — add CC (covered above)

All will use `const ADMIN_EMAIL = "sam@apex-financial.org"` consistently.

### 5. RecruiterDashboard SMS button — pass `applicationId`

The SMS button in RecruiterDashboard already passes `applicationId`, which is correct. But the push notification call passes `applicationId` instead of `userId` — the push function expects a `userId` to look up subscriptions. This needs fixing so push actually works from the dashboard.

## Summary of Changes

| File | Change |
|------|--------|
| `send-notification/index.ts` | Always send email (not just fallback), add admin CC |
| `send-push-notification/index.ts` | Add error logging for crypto failures |
| `send-sms-auto-detect/index.ts` | Send copy of SMS to admin phone |
| `notify-notes-added/index.ts` | Add admin CC |
| `notify-training-reminder/index.ts` | Add admin CC |
| `notify-attendance-missing/index.ts` | Add admin CC |
| `notify-evaluation-due/index.ts` | Standardize admin CC |
| `RecruiterDashboard.tsx` | Fix push notification call to pass correct `userId` |

