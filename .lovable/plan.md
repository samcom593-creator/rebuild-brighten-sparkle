
# Notification Hub Upgrade: Quick Action Buttons + Full-Channel Blast + Auto Opt-In

## What's Changing

### 1. New Quick Action Buttons on Notification Hub
Add prominent action buttons at the top of the Bulk Blast tab:

- **"Text All Applicants"** -- sends SMS (+ email + push) to every active applicant with a motivational or licensing message
- **"Text Applicants with Course Progress"** -- targets only applicants who have course progress and sends them a message to schedule a meeting/interview
- **"Send Opt-In Email to All"** -- sends an email to all applicants encouraging them to enable push notifications (with a direct link to the app's install/notification page)

### 2. Blast Sends ALL Channels (Not Just Email + SMS)
Currently the bulk blast sends email + SMS but doesn't attempt push notifications. Update `send-bulk-notification-blast` to also:
- Send **push notifications** to every applicant who has a push subscription
- Send **SMS** (known carrier or auto-detect)
- Send **email**
- All three channels fire for every lead (not fallback -- all at once)

### 3. Opt-In Recovery Email
Create a new edge function `send-push-optin-email` that sends a clean branded email to applicants saying:
- "Stay in the loop! Enable push notifications so you never miss an update from Apex Financial"
- Links to the app's `/install` page where they can install the PWA and enable notifications
- Tracks in `notification_log` as channel "email" with metadata `{ trigger: "push-optin" }`

### 4. Auto Opt-In on Application Submission
Update `submit-application` to:
- After successful insert, call `send-notification` for the new applicant to deliver a welcome push/SMS/email
- This ensures every new applicant immediately gets a notification through all available channels
- The confirmation email already exists; this adds push + SMS to the welcome flow

---

## Technical Details

### New file:
- `supabase/functions/send-push-optin-email/index.ts` -- sends opt-in encouragement email via Resend

### Modified files:

**`supabase/functions/send-bulk-notification-blast/index.ts`**
- Add push notification call for each applicant (invoke `send-push-notification` with the applicant's user_id if they have one linked via the agents table)
- Keep existing email + SMS logic

**`supabase/functions/submit-application/index.ts`**
- After insert + email notifications, also call `send-notification` to send a welcome push/SMS to the applicant's phone (auto-detect carrier)
- This happens in the background alongside existing email sends

**`src/pages/NotificationHub.tsx`**
- Add 3 new action buttons to the Bulk Blast tab:
  1. "Text All Applicants" -- calls `send-bulk-notification-blast` with a flag to send motivational outreach
  2. "Text Course Progress Leads" -- queries applicants with course progress, then sends scheduling messages via `send-sms-auto-detect` for each
  3. "Send Opt-In Email" -- calls `send-push-optin-email` for all applicants
- Update blast results display to show push notification stats
- Add push count to the stats summary

### Blast flow after changes:
```text
For each applicant:
  1. Send push notification (if user has push subscription)
  2. Send SMS (known carrier direct, unknown carrier auto-detect)
  3. Send email (licensing instructions or re-engagement)
All three fire -- no fallback chain, all channels attempted
```

### Course Progress targeting logic:
- Query `applications` joined with `onboarding_course_progress` or check `license_progress` for values like `started_course`, `finished_course`
- Send SMS: "Hey {name}! You're making great progress on your course. Let's schedule a call to discuss next steps!"
- Include a link or prompt to schedule via the calendar

### Implementation order:
1. Create `send-push-optin-email` edge function
2. Update `send-bulk-notification-blast` to send push + SMS + email (all channels)
3. Update `submit-application` to send welcome notification via all channels
4. Update NotificationHub UI with new action buttons and push stats
