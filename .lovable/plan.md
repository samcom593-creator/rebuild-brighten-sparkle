

# Plan: Aged Leads Overhaul, Recruiter HQ Enhancements, Pipeline UX, Test Reminders & Cross-Board Consistency

## Issues Identified

### 1. Aged Leads — Missing contact info, no lead cards, broken bulk assign
- Table columns for Phone, Email, Instagram are hidden on smaller screens (`hidden sm:table-cell`, `hidden md:table-cell`, `hidden lg:table-cell`).
- No clickable lead detail card — rows are flat table rows with no expansion or detail sheet.
- Bulk assign panel exists but the "30 at a time" preset is missing (only 25, 50, 100).
- No quick-action buttons (call, email, licensing) visible in the table — only a dropdown "more" menu.

### 2. Recruiter HQ — Score shown for everyone, no "Mark Contacted" button, no Instagram, no motivation, no manager shown, no licensing actions
- Score column shows for ALL leads (line 1387: `<th>Score</th>` always visible).
- Desktop table has no "Mark Contacted" button — only available inside the mobile LeadCard.
- No Instagram icon/link in the desktop table rows.
- No motivation text visible in desktop table.
- No manager name shown for leads assigned to someone.
- No `ResendLicensingButton` in desktop table actions.
- Aged leads fetched into RecruiterHQ don't carry `instagram_handle` or `motivation` from `aged_leads` table (line 946-965: normalized aged leads set `instagram_handle: null`).

### 3. Pipeline (DashboardApplicants) — Instagram missing in table view, scroll UX broken
- Table view (lines 1064-1123) has no Instagram button — only the card view has it.
- Table uses `overflow-auto` without a `min-w` constraint, so horizontal scroll bar appears only at the bottom of a very long list.
- Text is "zoomed in" — `text-3xl` header and `text-2xl` stat values feel oversized.

### 4. Test Reminders — No push notifications
- `notify-test-reminder` only sends emails via Resend. No push notification or SMS channel integration.
- No post-test follow-up notification to the manager.

### 5. CRM — Missing license progress stages
- CRM filters and display need to show `course_purchased`, `test_scheduled`, `waiting_on_license` properly (this relates to the `DashboardCRM.tsx` onboarding tracker and filter logic).

## Changes

### 1. Overhaul Aged Leads page (`src/pages/DashboardAgedLeads.tsx`)
**Contact info visibility:**
- Remove `hidden sm:`, `hidden md:`, `hidden lg:` from Phone, Email, Instagram columns — always show them.
- Add `min-w-[1100px]` to the `<Table>` to enforce horizontal scroll rather than hiding columns.

**Lead detail sheet:**
- Add click handler on lead name to open `LeadDetailSheet` (import from `src/components/recruiter/LeadDetailSheet.tsx`), passing the lead data transformed to match its expected interface.
- Add state for `detailLead` and render `LeadDetailSheet` at the bottom.

**Bulk assign presets:**
- Add `30` to the presets array: `const presets = [30, 50, 100];`

**Quick action icons in table rows:**
- Add call (Phone), email (QuickEmailMenu icon), and licensing (ResendLicensingButton) icons to the actions cell alongside the existing QuickAssignMenu and dropdown.
- Transform the actions cell from 2 buttons to a proper icon row with `flex items-center gap-1`.

### 2. Enhance Recruiter HQ desktop table (`src/pages/RecruiterDashboard.tsx`)

**Score column — hide except for test phase:**
- Conditionally render the Score column. Only show the score badge when `license_progress` is `test_scheduled`, `passed_test`, `fingerprints_done`, or `waiting_on_license`. Otherwise show "—".

**Add "Mark Contacted" button:**
- Add a `CheckCircle` icon button in the Actions column (after Phone) that updates `last_contacted_at` to now and logs activity.

**Add Instagram link:**
- In the Name column, add an Instagram icon next to the name when `instagram_handle` exists, linking to `https://instagram.com/{handle}`.

**Show motivation:**
- Below the name in the Name column, show a truncated motivation text in `text-[10px] text-muted-foreground` if present.

**Show manager name:**
- Fetch agent names for `assigned_agent_id` values. Add a column or inline badge showing which manager the lead is under (similar to Pipeline's manager badge).

**Add ResendLicensingButton:**
- Add `ResendLicensingButton` to the desktop table actions row.

**Fix aged lead normalization:**
- When normalizing aged leads (line 946-965), carry over `instagram_handle` from the aged_leads query. Update the select to include `instagram_handle, motivation`.
- Update the Lead interface to include `motivation` field.

### 3. Fix Pipeline UX (`src/pages/DashboardApplicants.tsx`)

**Add Instagram to table view:**
- In the table row actions (line 1066-1116), add an Instagram icon button (same pattern as the card view) when `app.instagram_handle` exists.

**Fix scroll behavior:**
- Add `min-w-[1100px]` to the inner `<table>` element.
- Wrap the table container in a `sticky top-0` header approach — but more importantly, the real fix is reducing the outer page padding and ensuring the `overflow-x-auto` container has `max-h-[calc(100vh-200px)] overflow-y-auto` so both scrollbars are accessible without scrolling to the bottom.

**Reduce visual size:**
- Change header from `text-3xl` to `text-2xl`.
- Change stat values from `text-2xl` to `text-xl`.
- Reduce stat card padding from `p-4` to `p-3`.
- Reduce `mb-8` gaps to `mb-5`.

### 4. Add push notifications to test reminders (`supabase/functions/notify-test-reminder/index.ts`)

- After sending the email reminder, also invoke `send-push-notification` for the applicant (if they have an account).
- After the test day, send a push notification to the manager asking them to check in.
- Add SMS via `send-sms-auto-detect` for the day-of reminder.

### 5. Ensure CRM shows all license stages (`src/pages/DashboardCRM.tsx`)

- Verify the CRM's onboarding filter tabs include `course_purchased`, `test_scheduled`, `finished_course`, `waiting_on_license`. If missing, add them to the filter logic.
- Ensure the CRM agent rows cross-reference the `applications` table for license_progress when the agent's own `license_status` doesn't reflect the latest stage.

## Scope
- 4 page files (DashboardAgedLeads, RecruiterDashboard, DashboardApplicants, DashboardCRM)
- 1 edge function (notify-test-reminder)
- No database migrations needed
- No new dependencies

