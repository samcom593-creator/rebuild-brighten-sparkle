

# Implementation Plan — Multi-Feature Update

This is a large request with ~12 distinct features. I'll organize them into prioritized batches.

---

## Batch 1: Daily Check-In Revamp + Automated Daily Prompts

### 1A. Revamp the Check-In Questionnaire (`/checkin`)
The current check-in page has generic license progress options. Replace them with the specific flow requested:

New progress options (single-select, each reveals contextual follow-ups):
- **Waiting to Purchase Course** → marks `pre_course`
- **Already in Course** → follow-up: "Having questions with the course?" Yes/No
- **Waiting to Schedule Test** → marks `studying`
- **Test Already Scheduled** → date picker for exam date
- **Waiting for Fingerprints** → new value `waiting_fingerprints`
- **Fingerprints Done** → new value `fingerprints_done`
- **Waiting on License** → marks `pending_state`
- **🆘 I Need Help / Phone Call** → triggers admin + manager notification

**DB migration**: Add `waiting_fingerprints` and `fingerprints_done` to the `license_progress` enum, and add `needs_help` boolean + `help_notified_at` timestamp to `applicant_checkins`.

**Files**: `src/pages/ApplicantCheckin.tsx`, new migration.

### 1B. Daily Check-In Prompt (Edge Function)
Create `send-daily-checkin-prompt` edge function that:
- Queries all unlicensed applications (license_status != 'licensed', not terminated)
- Sends each person an email + push with their personalized check-in link (`/checkin?id={applicationId}`)
- Scheduled daily via cron

### 1C. One-Time Email to All Current Unlicensed Pipeline
Create `send-unlicensed-process-update` edge function that:
- Emails all current unlicensed applicants about the new daily check-in process
- Includes the WhatsApp group link (admin-provided)
- Mentions the 2-week license incentive (cost covered if licensed within 2 weeks of application date)
- Admin triggers this manually from the dashboard (one-time blast)

### WhatsApp Note
Lovable cannot directly integrate with WhatsApp Business API (requires external provider setup, webhook infrastructure, and Meta Business verification). What I **can** do:
- Include a WhatsApp group invite link in all outbound emails to unlicensed prospects
- Add the link to the check-in confirmation page
- The admin would need to provide the WhatsApp group link as a configurable value

---

## Batch 2: Referral Dropdown — Include All Live Agents

### Current State
The application form's "Who referred you?" dropdown calls `get-active-managers` which only returns agents with the `manager` role.

### Fix
Update `get-active-managers` edge function to **also** include agents with `onboarding_stage = 'evaluated'` (live agents), not just managers. Return them in a separate group or merged list with a label indicating whether they're a manager or agent.

**Files**: `supabase/functions/get-active-managers/index.ts`, minor label update in `src/pages/Apply.tsx`.

---

## Batch 3: "Already Contracted" Bypass Fix

### Current State
The `ContractedModal` already has an "Already Contracted" toggle. But the user says it "doesn't work" because it validates that an agent account exists by email, which fails if the person hasn't been set up yet.

### Fix
When "Already Contracted" is checked, skip the agent-existence check entirely. Instead:
1. Create the agent account via `add-agent` (same as normal flow)
2. Skip sending the CRM setup email
3. Just enroll in coursework and mark as contracted

This effectively makes "Already Contracted" mean "skip CRM link requirement" rather than "skip agent creation."

**Files**: `src/components/dashboard/ContractedModal.tsx`

---

## Batch 4: Admin Daily Summary — Who Didn't Log Numbers

### Current State
`notify-fill-numbers` already sends reminders to agents who haven't logged. But there's no admin summary.

### Fix
Add an admin summary to the 9PM reminder type in `notify-fill-numbers`:
- After identifying agents who haven't logged, compile a list
- Send admin (info@apex-financial.org) an email listing all agents who didn't submit numbers
- Also send admin an SMS via `send-sms-auto-detect` with a brief summary

**Files**: `supabase/functions/notify-fill-numbers/index.ts`

---

## Batch 5: Search Bar in Pipeline (DashboardApplicants)

Add a search input to `DashboardApplicants.tsx` (the Kanban pipeline view) that filters cards by name, email, or phone — similar to the existing search in Lead Center.

**Files**: `src/pages/DashboardApplicants.tsx`

---

## Batch 6: Aged Leads Assignment UX

### Current State
Aged leads page has status dropdowns per lead but no streamlined bulk assignment to a specific agent with a count selector.

### Fix
Add a quick-assign panel to `DashboardAgedLeads.tsx`:
- Select a manager from dropdown
- Use a number input or slider to specify how many leads to assign
- Click "Send" to assign that many unassigned leads (newest first) to the selected manager
- Sends a single consolidated "You received X new leads" email notification

**Files**: `src/pages/DashboardAgedLeads.tsx`, update `supabase/functions/notify-lead-assigned/index.ts` to support batch mode.

---

## Batch 7: Bulk Lead Distribution Fix

### Current State
`BulkLeadAssignment` only fetches `applications` where `assigned_agent_id IS NULL`. It doesn't include aged leads.

### Fix
Update `BulkLeadAssignment.tsx` to also fetch unassigned `aged_leads` and display them in the same list, with a source badge. Also send a single consolidated notification email after bulk assignment.

**Files**: `src/components/dashboard/BulkLeadAssignment.tsx`

---

## Batch 8: Lead Center UI Improvements

Improve the Lead Center stat cards and action buttons:
- Add more status filter options (Hired, Contracted, Interview)
- Improve the stat card layout with better colors and icons
- Add more inline actions per lead row

**Files**: `src/pages/LeadCenter.tsx`

---

## Technical Details

### Database Migration
```sql
-- Add new license progress values
ALTER TYPE public.license_progress ADD VALUE IF NOT EXISTS 'waiting_fingerprints';
ALTER TYPE public.license_progress ADD VALUE IF NOT EXISTS 'fingerprints_done';

-- Add help request tracking to checkins
ALTER TABLE public.applicant_checkins 
  ADD COLUMN IF NOT EXISTS needs_help boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS help_notified_at timestamptz;
```

### New Edge Functions
- `send-daily-checkin-prompt` — daily cron, emails+push check-in links to unlicensed applicants
- `send-unlicensed-process-update` — one-time blast about new process

### Modified Edge Functions
- `get-active-managers` — include live agents in referral list
- `notify-fill-numbers` — add admin summary email+SMS at 9PM

### Modified UI Files
- `src/pages/ApplicantCheckin.tsx` — revamped questionnaire flow
- `src/pages/DashboardApplicants.tsx` — add search bar
- `src/pages/DashboardAgedLeads.tsx` — quick-assign panel
- `src/components/dashboard/BulkLeadAssignment.tsx` — include aged leads
- `src/components/dashboard/ContractedModal.tsx` — fix "already contracted" flow
- `src/pages/LeadCenter.tsx` — UI improvements
- `src/pages/Apply.tsx` — show live agents in referral dropdown

