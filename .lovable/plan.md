

# Fix Calendar Date Picker, Email Notifications, and Calendar Page Scheduling

## Issues Identified

### 1. Calendar popup broken in LicenseProgressSelector (Test Scheduled date picker)
The `Popover` component uses a **hidden trigger** (`<span className="hidden" />`), which means it has no anchor element for positioning. When `showDatePicker` is set to `true`, the popover tries to open but has nowhere to render relative to. This is the root cause of the broken calendar popup across all platforms (CRM, Pipeline, Call Center, etc.).

**Fix**: Replace the detached `Popover` with a `Dialog` component that doesn't need an anchor point. This ensures the date picker renders as a centered modal overlay that works everywhere.

### 2. Test Scheduled email only goes to admin + direct manager -- needs ALL managers
The `notify-test-scheduled` edge function currently resolves only the direct manager via `invited_by_manager_id` and CCs them + admin. It does NOT notify all managers.

**Fix**: Update the edge function to query ALL managers (all agents with a corresponding `manager` role in `user_roles`) and include their emails in the CC list. This ensures every manager is notified when any applicant schedules a licensing exam.

### 3. Calendar page "Schedule" button opens empty InterviewScheduler
The Calendar page passes `applicationId=""` to InterviewScheduler, so it can't actually schedule anything.

**Fix**: Replace the Schedule button with a two-step flow:
- Step 1: Open a lead search dialog with a search bar querying `applications` by name/email/phone
- Step 2: Once a lead is selected, open the InterviewScheduler pre-filled with that lead's data

### 4. InterviewScheduler calls wrong edge function
It calls `notify-test-scheduled` (for licensing exams) instead of `schedule-interview` (for interview emails). This means interview emails are formatted incorrectly.

**Fix**: Change the edge function call to `schedule-interview` which sends the proper interview notification email.

### 5. Weekend dates not disabled
The InterviewScheduler allows selecting Saturday and Sunday.

**Fix**: Add a weekend check to the `disabled` prop on the CalendarPicker.

---

## Technical Implementation

### File: `src/components/dashboard/LicenseProgressSelector.tsx`
- Remove the broken `Popover` + hidden trigger pattern (lines 208-227)
- Replace with a `Dialog` containing the Calendar picker
- The Dialog opens when `showDatePicker` is `true` and closes on date selection or cancel
- This fix applies everywhere the component is used (CRM, Pipeline, Call Center, HR, etc.)

### File: `supabase/functions/notify-test-scheduled/index.ts`
- After resolving the direct manager, add a query to get ALL managers:
  - Query `user_roles` where `role = 'manager'` to get all manager user IDs
  - Query `profiles` to get their emails
  - Add all manager emails to the CC list (deduplicated)
- Send a separate "heads up" email to all managers notifying them that an applicant has scheduled their licensing exam
- Keep the applicant email + prep tips as-is

### File: `src/pages/CalendarPage.tsx`
- Add a `LeadSearchDialog` component inline:
  - Search input that queries `applications` by first_name, last_name, email, or phone (using `ilike`)
  - Shows matching leads in a list with name, email, and current status
  - On lead selection, sets `selectedLead` state and opens InterviewScheduler with proper props
- Replace the empty `applicationId=""` with the selected lead's actual data
- The "Schedule" button now opens the search dialog first

### File: `src/components/dashboard/InterviewScheduler.tsx`
- Change edge function call from `notify-test-scheduled` to `schedule-interview` (line 136)
- Pass correct payload: `{ applicationId, interviewDate, interviewType, meetingLink, notes }`
- Add weekend disabling to CalendarPicker: `disabled={(date) => date < today || date.getDay() === 0 || date.getDay() === 6}`

### Edge Function: `supabase/functions/schedule-interview/index.ts`
- Fix the import: uses `npm:@hono/node-server` which is incorrect for Deno.serve pattern -- change to standard `Deno.serve`
- Ensure it sends the interview email to the applicant with CC to admin, assigned agent, direct manager, AND all managers

### Files Modified
- `src/components/dashboard/LicenseProgressSelector.tsx` -- fix calendar popup (Popover to Dialog)
- `src/pages/CalendarPage.tsx` -- add lead search flow for scheduling
- `src/components/dashboard/InterviewScheduler.tsx` -- fix edge function call + disable weekends
- `supabase/functions/notify-test-scheduled/index.ts` -- email all managers
- `supabase/functions/schedule-interview/index.ts` -- fix serve pattern + email all managers

