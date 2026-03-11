

# Daily WhatsApp Check-In Link + Email Fixes

## Problem
1. The current check-in page (`/checkin?id=<uuid>`) requires a unique per-applicant ID — you can't share one link in WhatsApp for everyone.
2. Unlicensed applicant confirmation emails don't include the WhatsApp group link.
3. No easy way to copy the check-in link from the CRM.

## Plan

### 1. Create a Universal Check-In Page (`/daily-checkin`)
A new public page at `/daily-checkin` that works without an application ID:
- Applicant enters their **email** (or phone) to identify themselves
- System looks up their application record
- Shows the same progress step selector + "Request Phone Call" button
- If no match found, shows a friendly error
- This is the single link you paste into WhatsApp every day

Route: `/daily-checkin` → new `DailyCheckin.tsx` page

### 2. Add "Copy Check-In Link" Button to CRM Header
At the top of the Agent CRM page (next to existing buttons like "Bulk Actions", "Refresh"):
- A button with a copy icon: **"📋 Check-In Link"**
- Clicking it copies `https://rebuild-brighten-sparkle.lovable.app/daily-checkin` to clipboard
- Shows a toast: "Link copied! Paste into WhatsApp"

### 3. Add WhatsApp Group Link to Unlicensed Applicant Confirmation Email
In `submit-application/index.ts`, after the unlicensed applicant email content:
- Fetch the `WHATSAPP_GROUP_LINK` secret
- Add a "Join Our WhatsApp Group" section with button in the unlicensed email template
- Also add the daily check-in link in the email for good measure

### 4. Verify All Emails Are Using Correct Domain
Already confirmed all 86+ functions use `notifications@apex-financial.org`. Will ensure the submit-application function's CC logic includes the admin and referring manager on the applicant confirmation email (currently it only CCs on the admin notification, not the applicant email).

## Files Changed
- **New**: `src/pages/DailyCheckin.tsx` — Universal check-in page (email lookup → progress form)
- **Edit**: `src/App.tsx` — Add `/daily-checkin` route
- **Edit**: `src/pages/DashboardCRM.tsx` — Add copy check-in link button in header
- **Edit**: `supabase/functions/submit-application/index.ts` — Add WhatsApp link + daily check-in link to unlicensed email, CC manager on applicant email

