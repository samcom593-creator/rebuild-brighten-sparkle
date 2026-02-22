

# Twilio SMS Integration

Add real SMS capability via Twilio so you can text any lead with just their phone number — no carrier data needed.

---

## What You Need First

1. Go to [twilio.com](https://twilio.com) and create a free account
2. Get a phone number (takes 2 minutes, costs ~$1.15/month)
3. From your Twilio Console, grab:
   - **Account SID** (starts with "AC...")
   - **Auth Token**
   - **Twilio Phone Number** (the number you purchased, e.g. +1234567890)

---

## What Gets Built

### 1. Store Twilio Credentials
Add three secrets to your project:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

### 2. New Edge Function: `send-sms-twilio`
A simple function that sends a real SMS via Twilio's REST API:
- Takes `to` (phone number) and `body` (message text)
- Normalizes phone to E.164 format (+1XXXXXXXXXX)
- Logs the result to `notification_log` with channel = "sms-twilio"
- No SDK needed — just a fetch call to Twilio's API

### 3. Update `send-notification` Function
Add Twilio as the preferred SMS channel:
- **Priority**: Push -> Twilio SMS -> Email-to-SMS (fallback if Twilio fails) -> Email
- If the user has a phone number, use Twilio directly (no carrier needed)
- Falls back to email-to-SMS gateway if Twilio creds aren't set

### 4. Update `send-bulk-notification-blast`
- For every applicant and aged lead with a phone number, send SMS via Twilio
- No longer dependent on carrier data for SMS delivery
- Still sends email in parallel

### 5. Update Notification Hub UI
- Add a "sms-twilio" channel badge (green) alongside existing badges
- Stats row shows Twilio SMS count separately
- Carrier assignment tool becomes optional (still useful for cost savings with free email-to-SMS)

---

## Technical Details

### New file:
- `supabase/functions/send-sms-twilio/index.ts`

### Modified files:
- `supabase/functions/send-notification/index.ts` — add Twilio as primary SMS
- `supabase/functions/send-bulk-notification-blast/index.ts` — use Twilio for bulk SMS
- `src/pages/NotificationHub.tsx` — add Twilio badge and stats

### Twilio API call (no SDK needed):
```text
POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
Auth: Basic (SID:Token)
Body: To, From, Body
```

### Implementation order:
1. Request Twilio secrets from you
2. Create `send-sms-twilio` edge function
3. Update `send-notification` to use Twilio as primary SMS
4. Update bulk blast to use Twilio
5. Update Notification Hub UI
6. Deploy and test with a single number before blasting
