

# Plan: Full Multi-Channel WhatsApp + Check-In Blast to All Unlicensed Applicants

## What needs to happen

### 1) Create a new "WhatsApp Onboarding Blast" edge function
**New file:** `supabase/functions/send-whatsapp-onboarding-blast/index.ts`

This is the main orchestrator. For every unlicensed, non-terminated applicant it will:
- **Email**: Rich HTML with WhatsApp group link, daily check-in link, and step-by-step licensing instructions for their current stage
- **SMS**: Short message with WhatsApp link + check-in link (via carrier gateway or auto-detect)
- **Push notification**: Via existing `send-push-notification` function
- **All channels fire simultaneously** per applicant (not fallback — blast on all)

The email content will include:
- WhatsApp group invite CTA (from `WHATSAPP_GROUP_LINK` secret)
- Instructions: "Once you reach each milestone, post your update in the WhatsApp group so everyone can celebrate with you"
- Step-by-step licensing process based on their `license_progress`:
  - Waiting to Purchase Course → how to purchase
  - Already in Course → study tips, support contacts
  - Waiting to Schedule Test → how to schedule via PSI/Pearson
  - Test Scheduled → preparation tips
  - Waiting for Fingerprints → how to complete fingerprints
  - Fingerprints Done → what to expect next
  - Waiting on License → timeline expectations
- Daily check-in link (`/checkin?id={app.id}`)
- Log every delivery attempt to `notification_log`

### 2) Upgrade existing `send-daily-checkin-prompt` to be multi-channel
**File:** `supabase/functions/send-daily-checkin-prompt/index.ts`

Currently email-only. Upgrade to also send:
- **Push notification** via `send-push-notification` (lookup profile by email)
- **SMS** via carrier gateway or `send-sms-auto-detect`
- Keep the WhatsApp group link in the email (already there)
- Add SMS text: "Daily check-in time! Update your licensing progress: {checkinUrl} | Join our WhatsApp: {whatsappLink}"

### 3) Add "Send WhatsApp Blast" button to Notification Hub
**File:** `src/pages/NotificationHub.tsx`

Add a new quick action button alongside existing ones ("Text All Applicants", etc.):
- "📲 WhatsApp + Check-In Blast" — calls `send-whatsapp-onboarding-blast`
- Shows progress/result toast with counts

### 4) Trigger the blast immediately after deployment
After deploying the new function, invoke it once to send to all current unlicensed applicants right away.

## Technical details
- No database changes needed
- WhatsApp auto-add is not possible (WhatsApp API does not support programmatic group additions) — the email/SMS will instruct applicants to click the link to join
- The daily check-in prompt (already scheduled or manually triggered) will continue reinforcing the WhatsApp join CTA every day
- All deliveries logged to `notification_log` for tracking in the Notification Hub

## Limitations
- **Cannot auto-add people to WhatsApp groups** — WhatsApp does not allow this via any API. The best we can do is blast the invite link on all channels
- **Cannot send messages inside the WhatsApp group** — that would require WhatsApp Business API with group admin access, which is not set up

