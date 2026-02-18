# Comprehensive Fix: Dashboard Accuracy, Contracting Flow, CRM Navigation, Emails, and More

This plan addresses all reported issues in priority order, grouped into logical phases.

---

## Phase 1: Fix Contracting Flow (New Hires Not Showing as Licensed / Not Starting in Onboarding)

### Problem

When you click "Contracted" in Pipeline or Call Center, the `add-agent` edge function creates the agent with `onboarding_stage: "onboarding"` if `hasTrainingCourse` is false, or `"training_online"` if true. The `ContractedModal` passes `hasTrainingCourse: true`, so agents land in `training_online` -- which is correct. However, the agent's `license_status` defaults to whatever the application says (usually `"unlicensed"`), so they never appear as "licensed" on the dashboard unless manually changed.

**The real issue**: The contracted flow correctly creates agents in `training_online`, but agents who are already licensed (their application says `license_status: "licensed"`) are still being created with `"unlicensed"` because the `ContractedModal` only checks `license_progress`, not `license_status` directly in all cases.

### Fix

1. `**src/components/dashboard/ContractedModal.tsx**` -- Improve license status detection: if the application's `license_status` is "licensed" OR `license_progress` is "licensed", pass `licenseStatus: "licensed"` to add-agent. Also ensure `onboarding_stage` correctly reflects the agent's actual readiness.
2. `**supabase/functions/add-agent/index.ts**` -- No changes needed; it already handles `licenseStatus` and `hasTrainingCourse` correctly.

---

## Phase 2: Fix Dashboard Stats Accuracy (Unlicensed Count, In-Field Training Count)

### Problem

- Dashboard `OnboardingPipelineCard` shows incorrect counts because it only queries agents with `is_deactivated = false`, missing many agents.
- The CRM "Hired (Unlicensed)" stat card counts correctly (`agentLicenseStatus !== "licensed"`) but the expanded view uses `filteredAgents` which excludes deactivated/inactive agents. When you tap the "Unlicensed" card, the filter shows 0 because many unlicensed people are marked inactive.
- "In-Field Training" count shows 19 in the stat but only 1 agent when expanded, because the stat counts from `activeAgents` but the expanded filter applies `filteredAgents` which has different exclusion logic.

### Root Cause

The `filteredAgents` array filters out `isDeactivated` and `isInactive` agents by default. The stat cards compute counts from `activeAgents` (non-deactivated, non-inactive), but the expanded view applies additional filters from `filteredAgents` that further restrict results based on `showDeactivated`/`showInactive` toggles and evaluation results.

The mismatch: stat cards use `activeAgents`, expanded views use `filteredAgents` which may exclude more agents.

### Fix

1. `**src/pages/DashboardCRM.tsx**` -- Make the expanded view filter logic match the stat card logic exactly. When clicking "Unlicensed", show all `activeAgents` where `agentLicenseStatus !== "licensed"` (not `filteredAgents`). Same for "In-Field Training" -- ensure the expanded list matches the count.
2. `**src/components/dashboard/OnboardingPipelineCard.tsx**` -- Review the query to ensure it counts all relevant agents (including those that might have been filtered incorrectly).

---

## Phase 3: Fix "Test Scheduled" Date Picker

### Problem

The `LicenseProgressSelector` component in Pipeline/Applicants does not show a date picker when selecting "Test Scheduled". It only updates `license_progress` to `"test_scheduled"` without prompting for a date.

The `CallCenterStageSelector` has a date picker for `test_scheduled`, but `LicenseProgressSelector` (used in Pipeline) does not.

### Fix

`**src/components/dashboard/LicenseProgressSelector.tsx**` -- Add a date picker popover that appears when "Test Scheduled" is selected. When confirmed, update both `license_progress` and `test_scheduled_date` on the application.

---

## Phase 4: Pipeline Stat Cards -- Replace "Terminated" with "Pre-Licensing Course Purchased"

### Problem

The Pipeline page (`DashboardApplicants.tsx`) has 4 stat cards: Total Leads, Hired, Contracted, Terminated. User wants to replace "Terminated" with "Pre-Licensing Course Purchased" since it's more actionable.

### Fix

`**src/pages/DashboardApplicants.tsx**` -- Change the 4th stat card from "Terminated" to "Course Purchased". Count applications where `license_progress = 'course_purchased'` or status indicates training enrollment. Keep the terminated section at the bottom (it's already there as a collapsible).

---

## Phase 5: Application Urgency Indicators (Yellow 2 days, Red 3 days)

### Problem

No visual indicator for applications sitting uncontacted for too long.

### Fix

`**src/pages/DashboardApplicants.tsx**` -- Add urgency badges to each application card:

- Yellow/amber badge for applications pending (no `contacted_at`) for 2+ days
- Red badge for applications pending 3+ days
- Add this to the card rendering function next to the time ago display.

---

## Phase 6: Fix Organic Lead Email (Add Name, Phone, Motivation, View/Call Buttons)

### Problem

The `notify-all-managers-leaderboard` email for organic leads just says "New organic lead: [Name]" with no actionable details -- no phone, motivation, or buttons.

### Fix

`**supabase/functions/notify-all-managers-leaderboard/index.ts**` -- Enhance the email template:

- Fetch the full application record (phone, city, state, motivation/about_me)
- Add applicant name, phone number, city/state, motivation text
- Add "View Lead" button linking to `/dashboard/applicants?lead=[applicationId]`
- Add "Call Now" button with `tel:` link
- Use table-based layout per email standards

---

## Phase 7: Daily Manager Digest -- Uncalled Leads Report

### Problem

No automated daily email to managers showing their uncalled leads.

### Fix

`**supabase/functions/manager-daily-digest/index.ts**` -- Update the existing edge function (or create if not functional) to:

- Query each manager's assigned applications where `contacted_at IS NULL` and `terminated_at IS NULL`
- Exclude aged leads (only from `applications` table)
- Categorize by: Licensed, Unlicensed, Unknown
- Send daily email with counts and a "View Pipeline" CTA
- Schedule via cron (daily at 8am PST)

---

## Phase 8: Bulk Email to Unlicensed Applicants

### Problem

Need to send a mass email to all applicants not marked as licensed, with instructions on getting started, scheduling calls, and highlighting $20K average first-month production.

### Fix

**New edge function: `supabase/functions/send-bulk-unlicensed-outreach/index.ts**` -- Query all applications where `license_status != 'licensed'` and `terminated_at IS NULL`, send a templated email with:

- How to get started
- Link to website, schedule call page
- Social proof: "Our average agent does $20,000 in production within their first month"
- Table-based mobile-responsive layout
- CC admin per system policy

Add a "Send Unlicensed Outreach" button to the Pipeline or Admin dashboard.

---

## Phase 9: Remaining Infinite Animations Cleanup

### Problem

Still 56 `repeat: Infinity` instances remaining in 5 files (CareerPathwaySection, CallCenterLeadCard, CallCenterVoiceRecorder, CompactProductionEntry, InterviewRecorder).

### Fix

- **CareerPathwaySection.tsx** -- Replace 6 infinite animations with static elements
- **CallCenterLeadCard.tsx** -- 1 remaining pulse effect, make static
- **CompactProductionEntry.tsx** -- 1 sparkle rotation, make static
- **CallCenterVoiceRecorder.tsx** and **InterviewRecorder.tsx** -- Keep these (recording indicators only active during recording)

---

## Phase 10: Aged Leads Duplicate Count Fix

### Problem

Clicking "49 duplicates" does nothing in Aged Leads.

### Fix

Review the Aged Leads duplicate banner click handler to ensure it filters/displays the actual duplicate records instead of being a non-functional display.

---

## Technical Details

### Files Modified (estimated 15-18 files)


| File                                                          | Change                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/components/dashboard/ContractedModal.tsx`                | Fix license status detection in contracting flow                  |
| `src/pages/DashboardCRM.tsx`                                  | Fix expanded view filters to match stat card counts               |
| `src/components/dashboard/OnboardingPipelineCard.tsx`         | Review count accuracy                                             |
| `src/components/dashboard/LicenseProgressSelector.tsx`        | Add date picker for test_scheduled                                |
| `src/pages/DashboardApplicants.tsx`                           | Replace Terminated stat with Course Purchased; add urgency badges |
| `supabase/functions/notify-all-managers-leaderboard/index.ts` | Enhance organic lead email with details + buttons                 |
| `supabase/functions/manager-daily-digest/index.ts`            | Implement uncalled leads daily report                             |
| `supabase/functions/send-bulk-unlicensed-outreach/index.ts`   | New: bulk email to unlicensed applicants                          |
| `src/components/landing/CareerPathwaySection.tsx`             | Remove infinite animations                                        |
| `src/components/callcenter/CallCenterLeadCard.tsx`            | Remove remaining infinite animation                               |
| `src/components/dashboard/CompactProductionEntry.tsx`         | Remove infinite animation                                         |
| `src/pages/DashboardAgedLeads.tsx`                            | Fix duplicate click handler                                       |


### Priority Order

1. Contracting flow fix (Phase 1) -- blocking issue
2. Dashboard accuracy (Phase 2) -- critical for trust
3. Test date picker (Phase 3) -- quick fix
4. Urgency indicators (Phase 5) -- quick fix
5. Organic lead email (Phase 6) -- high impact
6. Pipeline stat swap (Phase 4) -- UI improvement
7. Daily digest (Phase 7) -- automation
8. Bulk email (Phase 8) -- automation
9. Animation cleanup (Phase 9) -- performance
10. Aged leads fix (Phase 10) -- bug fix
11. make sure full site has UX and animation effecs / sound to ensure it maintains a high tec feel 