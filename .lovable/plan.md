

# Plan: Make the Licensing Button Green & Add Push/SMS Notifications

## Current State
The `ResendLicensingButton` (GraduationCap icon) already exists in both mobile and desktop views of Recruiter HQ. However:
1. The button uses `text-primary` (purple/blue) — not green as expected.
2. It only sends an **email** via `send-licensing-instructions`. No push notification or SMS is sent.

## Changes

### 1. Make the button green (`src/components/callcenter/ResendLicensingButton.tsx`)
- Change the default (non-sent) style from `border-primary/30 text-primary` to `border-green-500/30 text-green-400 hover:text-green-300 hover:border-green-500/50` so the graduation cap is always visibly green.

### 2. Add push + SMS to `send-licensing-instructions` edge function
- After sending the email, also invoke `send-push-notification` (if applicant has an account) and `send-sms-auto-detect` with a short licensing message.
- Accept an optional `phone` parameter for SMS delivery.
- Return channel results in the response.

### 3. Pass phone number through the button
- Add optional `recipientPhone` prop to `ResendLicensingButton`.
- Pass it from RecruiterDashboard where `lead.phone` is available (both mobile card and desktop table instances).

**Files to edit:** `ResendLicensingButton.tsx`, `send-licensing-instructions/index.ts`, `RecruiterDashboard.tsx`

