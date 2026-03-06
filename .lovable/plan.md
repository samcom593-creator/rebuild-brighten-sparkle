

# Fix Notification Self-Healing + Add Delivery Health Checks

## Root Cause

The system health check (`system-health-check`) only monitors infrastructure (DB connections, RLS, API keys, table existence). It has zero visibility into whether notifications are actually being delivered. The 283 SMS failures in the past week are all Resend rate limit errors — sending too fast through the 8-carrier gateway approach.

**Push notifications are working fine** — confirmed with a live test (1/1 sent, 201 status). The previous failures were from leads without push subscriptions, which is expected.

## Problems to Fix

1. **Health check doesn't monitor notification delivery** — no checks for failed notification rates, stale push subscriptions, or delivery success rates
2. **SMS rate limiting** — `send-sms-auto-detect` uses 1s delay between carriers, but Resend's limit is 2 requests/second; the first carrier often gets rate-limited because the function boots and fires immediately
3. **No synthetic notification test** — the health check never verifies that email, SMS, or push can actually send
4. **No self-healing** — failed notifications are logged but never automatically retried
5. **Inconsistent ADMIN_EMAIL** — some functions still use `info@apex-financial.org` instead of `sam@apex-financial.org`

## Changes

### 1. `supabase/functions/system-health-check/index.ts` — Add notification delivery checks

Add 3 new checks after existing ones:

- **`notification_delivery_rate`** — Query `notification_log` for the last 24h, calculate failure rate per channel. Fail if any channel is >30% failed.
- **`push_subscriptions_health`** — Check `push_subscriptions` count. Warn if zero.
- **`synthetic_email_test`** — Send a small test email to admin (`sam@apex-financial.org`) with subject `[Health] Synthetic Test` via Resend. Fail if Resend rejects it.

Update `ALERT_EMAIL` from `info@apex-financial.org` to `sam@apex-financial.org`.

### 2. `supabase/functions/send-sms-auto-detect/index.ts` — Fix rate limiting

- Increase delay between carrier sends from `1000ms` to `1500ms` to stay safely under Resend's 2/sec limit
- Add a 500ms initial delay before the first send to avoid cold-start burst

### 3. Standardize ADMIN_EMAIL in remaining functions

Update these functions that still use `info@apex-financial.org` to `sam@apex-financial.org`:
- `check-low-aop-friday`
- `send-bulk-portal-logins`
- `send-followup-emails`
- `schedule-interview`
- `send-agent-portal-login`

### 4. Auto-retry failed notifications (lightweight)

Add a new check in `system-health-check` that:
- Queries `notification_log` for `status='failed'` in the last 6 hours where `channel='email'` and `error_message` does NOT contain "rate limit"
- For up to 5 such failures, calls `send-notification` with the original email/title/message
- Logs retry results

This keeps it passive (runs every 15 min with health check) and safe (max 5 retries per cycle, skips rate-limit errors).

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/system-health-check/index.ts` | Add notification delivery checks, synthetic test, auto-retry, fix admin email |
| `supabase/functions/send-sms-auto-detect/index.ts` | Increase delay to 1500ms, add initial 500ms delay |
| `supabase/functions/check-low-aop-friday/index.ts` | Change ADMIN_EMAIL to `sam@apex-financial.org` |
| `supabase/functions/send-bulk-portal-logins/index.ts` | Change ADMIN_EMAIL to `sam@apex-financial.org` |
| `supabase/functions/send-followup-emails/index.ts` | Change ADMIN_EMAIL to `sam@apex-financial.org` |
| `supabase/functions/schedule-interview/index.ts` | Change ADMIN_EMAIL to `sam@apex-financial.org` |
| `supabase/functions/send-agent-portal-login/index.ts` | Change ADMIN_EMAIL to `sam@apex-financial.org` |

