

# Plan: Add Seminar Opt-In to Onboarding Blast + Send Seminar Invite

## Current state
- WhatsApp onboarding blast already sent to all 111 unlicensed applicants (confirmed via logs)
- Seminar registration page exists at `/seminar` with full form
- Seminar reminder infrastructure exists (24h, 1h, 15m automated reminders)

## What to build

### 1) Create a "Send Seminar Invite Blast" edge function
**New file:** `supabase/functions/send-seminar-invite-blast/index.ts`

Sends to all unlicensed, non-terminated applicants across all channels:
- **Email**: Rich HTML invitation to Thursday seminar with registration link (`APP_URL/seminar`), explaining they'll get a full overview of the opportunity
- **SMS**: Short message with seminar link
- **Push**: Via existing push function
- Includes a one-click registration link that pre-fills their name/email
- Logs all deliveries to `notification_log`

### 2) Add pre-fill support to Seminar Page
**File:** `src/pages/SeminarPage.tsx`

Read URL query params (`?first_name=X&last_name=Y&email=Z`) to pre-fill the registration form so applicants can register with one click from email/SMS links.

### 3) Add "Send Seminar Invite" button to Notification Hub
**File:** `src/pages/NotificationHub.tsx`

New quick action card alongside the WhatsApp blast button — "📅 Seminar Invite Blast" that calls the new function.

### 4) Trigger the seminar blast immediately after deployment

## Technical details
- No database changes needed — `seminar_registrations` table already exists
- Pre-fill URL format: `/seminar?first_name=John&last_name=Doe&email=john@example.com`
- The existing seminar reminder system (24h, 1h, 15m) will automatically pick up new registrants

