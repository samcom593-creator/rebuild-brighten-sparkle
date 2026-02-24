
## Immediate fix plan for “Resend All Failed” not working

### What I found (root cause)
I traced the current implementation and confirmed why this feels broken:

1. The retry button currently reprocesses **every failed log row**, not every failed lead/message.
2. For auto-SMS, one message creates multiple carrier attempts (up to 8 rows), so failures are heavily duplicated.
3. Current data today shows this clearly:
   - **191 failed `sms-auto` rows**
   - but only **42 unique SMS targets**
4. Most failures are rate-limit errors (“Too many requests”), and retrying raw rows multiplies work and can create a retry storm.
5. Push retries are currently counted as success if there is no transport error, even when `sent = 0` (no subscriptions). That inflates retry-success reporting.

---

## Implementation plan (what I will change)

### 1) Rebuild retry selection to target unique unresolved failures
**File:** `src/pages/NotificationHub.tsx`

- Replace raw row-by-row retry logic in `handleResendFailed` with a pipeline:
  1. Load today’s failed logs.
  2. Load today’s sent logs.
  3. Build normalized “delivery target keys” (recipient + channel + message + app/agedLead metadata).
  4. **Deduplicate failed entries** to one retry candidate per logical target.
  5. Skip any failed candidate that already has a matching sent delivery today.
  6. Skip non-actionable push failures (`No push subscriptions`) to prevent pointless retries.

Result: Retry focuses only on unresolved failures, not noisy carrier-attempt rows.

---

### 2) Fix channel-specific retry correctness
**File:** `src/pages/NotificationHub.tsx`

- **Push:** count as success only if backend response says `sent > 0`.
- **Email:** count as success only if email channel actually sent in backend response.
- **SMS / SMS-Auto:** keep success gate on `successCount > 0`.
- Add small pacing between retries to reduce back-to-back rate-limit collisions.

---

### 3) Improve “what happened” transparency after retry
**File:** `src/pages/NotificationHub.tsx`

Enhance result summary with:
- attempted retries
- successful retries
- skipped as already delivered
- skipped non-actionable (no push subscription)
- per-channel attempted/sent counts

This will make it obvious why counts change (or don’t) after pressing the button.

---

### 4) Update button/confirm copy so behavior is explicit
**File:** `src/pages/NotificationHub.tsx`

- Update wording from generic “Retry today’s failures” to “Retry unresolved failures (deduped by lead/message)” so expectation matches actual behavior.

---

### 5) Harden backend function CORS headers used by this flow (stability pass)
**Files:**
- `supabase/functions/send-sms-auto-detect/index.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/send-push-notification/index.ts`
- `supabase/functions/send-sms-via-email/index.ts`

Normalize CORS allow-headers to include the full client header set used by browser invokes.  
This is a defensive fix to avoid intermittent preflight mismatches.

---

## Technical details (for implementation review)

```text
Current flow (problem):
failed rows (many sms-auto carrier attempts)
  -> retry every row
     -> invokes sms-auto repeatedly
        -> creates more attempt rows + rate-limit failures
           -> user sees "not working"

New flow:
failed rows + sent rows (today)
  -> normalize key per logical delivery target
  -> dedupe failed targets
  -> exclude already-delivered targets
  -> retry only unresolved targets with pacing
  -> accurate per-channel success accounting
```

### Target key strategy
- Push key: `push|recipient_user_id|title|message`
- Email key: `email|recipient_email|title|message`
- SMS key: `sms|applicationId/agedLeadId/phone|message`  
  (falls back safely when metadata is missing)

### No schema migration needed
- No table or RLS changes required.
- Existing admin-only access to `notification_log` remains correct for this page.

---

## Validation plan (end-to-end)

1. Open Notification Hub and click **Resend All Failed**.
2. Confirm the run shows:
   - smaller retry attempt count than raw failed row count,
   - explicit skipped counts (already delivered / non-actionable).
3. Verify no “retry explosion” in logs (failed rows should not spike uncontrollably).
4. Confirm success summary aligns with backend outcomes (`sent > 0`, `successCount > 0`).
5. Re-run once more and verify second run is mostly skipped (idempotent behavior).

