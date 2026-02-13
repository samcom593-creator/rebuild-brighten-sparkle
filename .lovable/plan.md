

# Fix Pipeline Actions, Unlicensed Dashboard View, and Hire Email

## Problems Identified

1. **Pipeline (Applicants) page still uses old workflow** -- Buttons go "Contacted" then "Qualified" then "Close". The user wants only two actions: **Hired** and **Contracted**. Remove "Contacted", "Qualified", and "Close" as separate steps. Replace with "Hired" (marks as hired, sends email) and "Contracted" (opens contracting modal).

2. **Dashboard doesn't show unlicensed recruits** -- The OnboardingPipelineCard only tracks onboarding stages (onboarding, training_online, in_field_training, evaluated). It doesn't show unlicensed agents. Need to add an "Unlicensed" count to the pipeline card showing all active agents with `license_status = 'unlicensed'`.

3. **Hire email content is wrong** -- When clicking "Hired", the post-call follow-up email needs to clearly tell the recruit: "You've been chosen for the program. If you get your license within 2 weeks, everything is paid for." Currently it sends a generic follow-up.

4. **Pipeline stat cards still show "Contacted"** -- Replace with Hired/Contracted counts.

---

## Changes

### 1. Pipeline (Applicants) Page -- `src/pages/DashboardApplicants.tsx`

**Remove intermediate status buttons:**
- Remove `handleMarkAsContacted` and `handleMarkAsQualified` functions
- Replace the action buttons section: for any non-closed, non-terminated lead, show:
  - **"Hired"** button -- sets `contacted_at` (if not set), `closed_at`, and status to hired. Sends the hire email. Fires a hire announcement.
  - **"Contracted"** button -- opens the ContractedModal (available for any lead, not just licensed ones)
- Remove the "Qualified" status filter option from the dropdown

**Update stat cards:**
- Replace "Contacted" with "Hired" (count of apps with `closed_at` set but no `contracted_at`)
- Replace the existing "Closed" with "Contracted" (count of apps with `contracted_at` set)
- Keep "Total Leads" and "Terminated"

**Update status determination:**
- `getApplicationStatus` should return "hired" when `closed_at` is set, and "contracted" when `contracted_at` is set

### 2. Dashboard Pipeline Card -- `src/components/dashboard/OnboardingPipelineCard.tsx`

**Add "Unlicensed" stage:**
- Add a query for agents with `license_status = 'unlicensed'` and `is_deactivated = false`
- Show as a fifth stage in the pipeline: "Unlicensed" with a graduation cap icon and amber color
- This ensures when someone is hired and added as an agent with unlicensed status, they show up on the dashboard

### 3. Hire Email -- `supabase/functions/send-post-call-followup/index.ts`

**Update the "hired" action type email:**
- Change the email body for `actionType === "hired"` to clearly say:
  - "You've been selected for the APEX program!"
  - "Get your license within 2 weeks and everything is paid for"
  - Include the licensing course link (XcelSolutions) for unlicensed recruits
  - Keep the CC to admin and manager

### 4. Pipeline Applicant Actions -- Pass `agentId` to hire email

**In DashboardApplicants `handleMarkAsHired`:**
- Call `send-post-call-followup` with `actionType: "hired"` and include the `agentId` so the manager gets CC'd
- Also call `notify-hire-announcement` to broadcast to all managers

---

## Technical Details

### File: `src/pages/DashboardApplicants.tsx`

- Remove `handleMarkAsContacted` (lines 276-288) and `handleMarkAsQualified` (lines 290-305)
- Rename `handleMarkAsClosed` to `handleMarkAsHired` -- keep the same logic but also send the hire email via `send-post-call-followup` with `actionType: "hired"` and fire `notify-hire-announcement`
- In `getApplicationStatus`: check `contracted_at` first (return "contracted"), then `closed_at` (return "hired"), remove "qualified" status
- In action buttons section (lines 659-743): replace the status-based button chain with just two buttons for any active lead: "Hired" and "Contracted"
- In stat cards (lines 780-804): change to Total Leads, Hired, Contracted, Terminated
- In status filter dropdown (lines 828-835): remove "qualified", rename "closed" to "hired", add "contracted"
- Remove `statusColors.qualified`, update `statusColors.closed` to use "hired" key

### File: `src/components/dashboard/OnboardingPipelineCard.tsx`

- Add `license_status` to the agents query select (line 47)
- Add a new stage counting agents with `license_status = 'unlicensed'` regardless of onboarding stage
- Insert "Unlicensed" as the first item in the stages array with amber coloring and GraduationCap icon

### File: `supabase/functions/send-post-call-followup/index.ts`

- Update the "hired" email template to include the message: "You've been selected for the APEX program. Get licensed within 2 weeks and we cover everything."
- For unlicensed hires, include the XcelSolutions licensing course link and the 3-step process
- Keep existing CC logic (admin + manager)

