

# Scale-Ready Platform Overhaul: Lead Center, Pipeline, Notifications, and Payment Tracker

## Overview

This is a multi-system upgrade to prepare the platform for aggressive scaling. It covers 7 key areas across Lead Center, CRM/Pipeline, Call Center, notifications, and the Payment Tracker.

---

## 1. Lead Center: Show Manager Name on Every Lead

**Current state**: The "Assigned To" column already shows manager names (line 803-811 in LeadCenter.tsx). However, aged leads assigned via `assigned_manager_id` sometimes show "Unknown" because the agent lookup only queries `status = 'active'` agents. Also, the QuickAssignMenu only renders for `applications` source leads, not aged leads.

**Fix**:
- Update the agent query in `fetchLeads` to remove the `status = 'active'` filter so that all manager names resolve correctly
- Enable `QuickAssignMenu` for aged leads too (currently only shows for applications -- line 832-838)
- After assigning an aged lead, update `assigned_manager_id` instead of `assigned_agent_id`

**File**: `src/pages/LeadCenter.tsx`

---

## 2. Lead Center: Add Licensing Instructions Button (Hat Icon)

Add the same `ResendLicensingButton` (GraduationCap icon) that exists in the Call Center to each lead row in the Lead Center, so you can send licensing instructions directly from there.

**File**: `src/pages/LeadCenter.tsx` -- import and add `ResendLicensingButton` to the Actions column

---

## 3. Pipeline (CRM): Add Last Contact, Licensing Stage, Test Date, and Licensing Button

The CRM agent cards need richer onboarding data to support proper pipeline management. Currently the cards show onboarding stage, attendance, and production stats, but are missing:

- **Last contacted** timestamp (already fetched -- `lastContactedAt` field exists but needs to be shown more prominently on the card)
- **License progress step** (e.g., "Course Purchased", "Studying", "Test Scheduled") -- need to fetch `license_progress` from the agent's application record
- **Exam scheduled date** -- need to fetch `test_scheduled_date` from applications
- **Licensing instructions button** (GraduationCap hat icon) on each pipeline card

**Changes**:
- In `fetchAgents`, also query applications by `assigned_agent_id` to get `license_progress` and `test_scheduled_date` for each agent
- Add these fields to the `AgentCRM` interface
- Display license progress badge and test date on agent cards
- Add the `ResendLicensingButton` to each card's action row
- Show "Last contact: 2h ago" badge prominently

**File**: `src/pages/DashboardCRM.tsx`

---

## 4. Payment Tracker: Show ALL Live Agents (Remove `is_inactive` Filter)

**Current state**: The Payment Tracker query at line 44 filters with `.eq("is_inactive", false)`, which excludes agents like Ashley Elder and Bryan Ross who are `is_inactive = true` but still `evaluated` and `active`.

**Fix**: Remove the `.eq("is_inactive", false)` filter from the `LeadPaymentTracker` component so every evaluated agent shows in the tracker.

**File**: `src/components/dashboard/LeadPaymentTracker.tsx`

---

## 5. Hire/Contract Notification Email to All Managers

When someone is marked as "Hired" or "Contracted" in the Call Center or Applicants module, send a brief motivational email to ALL managers saying:

> "[Manager Name] just hired [Applicant Name]!"

This motivates other managers to increase hiring. The email will be minimalist, Apex-branded, and include only this one line.

**Changes**:
- Create a new edge function `notify-hire-announcement/index.ts` that:
  - Accepts `{ hirerName, hireeName, actionType }` 
  - Fetches all managers from the database
  - Sends a short email to each manager (CC admin as per system policy)
  - Uses the verified `noreply@apex-financial.org` sender
- Wire it into `CallCenter.tsx` `executeAction` (when `actionId === "hired"`) and `ContractedModal` (on success)

**Files**: 
- `supabase/functions/notify-hire-announcement/index.ts` (new)
- `src/pages/CallCenter.tsx` (invoke after hire/contract)
- `src/components/dashboard/ContractedModal.tsx` (invoke after contract success)

---

## 6. Automated Emails at Each Pipeline Stage

Ensure the system sends appropriate follow-up emails when leads move through each pipeline stage:

- **Hired (unlicensed)**: Already sends post-call followup. Will also trigger licensing instructions automatically via `send-licensing-instructions`.
- **Hired (licensed)**: Already sends post-call followup. Confirm onboarding email fires.
- **Contracted**: Already handled by `notify-agent-contracted`. Verify it triggers correctly from the ContractedModal.
- **Course reimbursement reminder**: Already exists via `send-course-hurry-emails`. Verify it's scheduled.

**Audit and wire**:
- In `CallCenter.tsx`, when a lead is marked "Hired" AND `licenseStatus === "unlicensed"`, automatically invoke `send-licensing-instructions` in addition to the post-call followup
- Verify `ContractedModal` invokes `notify-agent-contracted`

**File**: `src/pages/CallCenter.tsx`

---

## 7. Dashboard: Pipeline Alert Summary

Add a compact pipeline alert widget to the main Dashboard showing:
- Number of unlicensed agents in pipeline (need attention)
- Number of agents with no contact in 48+ hours
- Quick-link to Pipeline/CRM

**File**: `src/pages/Dashboard.tsx` -- add a small alert card component

---

## Summary of All Files to Modify

| File | Change |
|------|--------|
| `src/pages/LeadCenter.tsx` | Show manager names for all leads, enable assign for aged leads, add licensing button |
| `src/pages/DashboardCRM.tsx` | Add license progress, test date, last contact, and licensing button to agent cards |
| `src/components/dashboard/LeadPaymentTracker.tsx` | Remove `is_inactive` filter to show ALL live agents |
| `src/pages/CallCenter.tsx` | Auto-send licensing instructions on hire (unlicensed), invoke hire announcement |
| `src/components/dashboard/ContractedModal.tsx` | Invoke hire announcement on contract |
| `supabase/functions/notify-hire-announcement/index.ts` | New edge function for manager motivation emails |
| `src/pages/Dashboard.tsx` | Add pipeline alert summary widget |

