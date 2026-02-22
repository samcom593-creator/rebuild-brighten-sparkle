
# SMS Auto-Carrier-Detection: Try All Gateways Until Success

Instead of manually guessing carriers, the system will automatically try sending SMS through every carrier gateway (AT&T, Verizon, T-Mobile, etc.) for each phone number. The first one that delivers successfully gets saved as that lead's carrier for future sends.

---

## How Auto-Detection Works

For any lead without a carrier assigned:
1. Try sending via all 8 carrier email gateways (AT&T, Verizon, T-Mobile, Sprint, US Cellular, Cricket, Metro, Boost)
2. Resend's email API returns success/failure — if the gateway rejects it, we move to the next
3. When one succeeds, save that carrier to the lead's record so future sends skip straight to it
4. Log every attempt to `notification_log` for visibility

**Important caveat**: Email-to-SMS gateways don't always return clear delivery failures — Resend may report "sent" even if the carrier gateway silently drops it. So this is a "best effort spray" approach: all 8 get attempted, and the message will arrive on whichever carrier actually matches. We save the carrier once you manually confirm which one worked (via a "Mark as delivered" button in the UI).

---

## What Gets Built

### 1. New Edge Function: `send-sms-auto-detect`
- Accepts `phone`, `message`, and optionally `applicationId` or `agedLeadId`
- If the lead already has a carrier, sends to that one only
- If no carrier, loops through all 8 gateways sending the SMS via Resend
- Adds a 200ms delay between each attempt to avoid rate limits
- Logs each attempt to `notification_log` with channel = "sms-auto"
- Returns which gateways were attempted

### 2. Update `send-bulk-notification-blast`
- For leads WITH a carrier: send to that carrier only (fast, 1 call)
- For leads WITHOUT a carrier: call `send-sms-auto-detect` which tries all 8
- Stats updated to show "sms_auto_detected" count

### 3. Update `send-notification`
- Add auto-detect as step 2 in the priority chain:
  - Push -> SMS (known carrier) -> SMS Auto-Detect (unknown carrier) -> Email
- If carrier is known, use it directly; if not, try all gateways

### 4. Update Notification Hub UI
- New "SMS Auto" badge in the log table (purple)
- Stats row adds "Auto SMS" count
- Carrier Assignment tool gets a new "Auto-Blast All" button that triggers auto-detect for all leads missing carriers
- Add a "Mark Delivered" action on SMS log entries so you can confirm which carrier worked and save it

---

## Technical Details

### New file:
- `supabase/functions/send-sms-auto-detect/index.ts`

### Modified files:
- `supabase/functions/send-notification/index.ts` — add auto-detect fallback
- `supabase/functions/send-bulk-notification-blast/index.ts` — use auto-detect for unknown carriers
- `src/pages/NotificationHub.tsx` — add auto SMS badge, stats, and auto-blast button
- `src/lib/carrierOptions.ts` — no changes needed (carriers stay the same)

### Auto-detect loop logic:
```text
for each carrier in [att, verizon, tmobile, sprint, uscellular, cricket, metro, boost]:
  send email to {phone}@{gateway}
  if Resend returns success: log as "sent"
  if Resend returns error: log as "failed", try next
  wait 200ms between attempts
```

### Implementation order:
1. Create `send-sms-auto-detect` edge function
2. Update `send-notification` to use auto-detect when no carrier
3. Update `send-bulk-notification-blast` to use auto-detect
4. Update Notification Hub UI with auto SMS stats and controls
