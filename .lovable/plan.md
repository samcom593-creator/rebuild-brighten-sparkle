

# Comprehensive Platform Overhaul — Multi-Phase Plan

This is a very large request covering CRM restructure, data accuracy fixes, application form updates, dashboard enhancements, dead space elimination, notification history, and full-site optimization. Due to scope, this plan is organized into prioritized phases that will be implemented sequentially.

---

## Phase 1: Critical Data Fixes (Highest Priority)

### 1A. Fix Lead Center Stats (Contacted / Closed / Licensed counts are wrong)

**Problem:** The Lead Center stats compute "Contacted" by checking `contactedAt` but many leads have been contacted without that field being set (contacted via email/SMS/phone buttons but `contacted_at` was never written). "Closed" only checks `status === "hired" || "contracted"` but misses `closed_at`. Licensed count may be filtering incorrectly.

**Fix in `src/pages/LeadCenter.tsx`:**
- "Contacted" stat: Count leads where `contactedAt` is set OR `status` is NOT `new` (any status beyond `new` implies contact was made)
- "Closed" stat: Count leads where `status` in (`hired`, `contracted`) OR `closed_at` is set
- "Licensed" stat: Verify it counts `license_status === "licensed"` correctly across both applications and aged_leads
- Cross-reference with `contact_history` table — if a lead has any contact_history records, mark it as contacted

### 1B. Fix Log Numbers Not Submitting

**Problem:** The daily numbers sheet "just not accepting" submissions.

**Investigation & Fix in `src/pages/LogNumbers.tsx` and `supabase/functions/log-production/index.ts`:**
- Check if the `submit` action properly handles the upsert — verify the `onConflict` constraint `"agent_id,production_date"` exists in the database
- Ensure the edge function returns proper error messages so the UI can display them
- Add better error handling and user feedback in the production submission flow

---

## Phase 2: CRM Restructure

### 2A. Restructure CRM Sections (4 sections instead of 3)

**File: `src/pages/DashboardCRM.tsx`**

Current sections: Onboarding, In-Field Training, Live
New sections:
1. **Onboarding** — agents currently in course (show mini coursework progress bar inline)
2. **In-Field Training** — agents in field training stage
3. **Live** — evaluated agents actively producing
4. **Needs Follow-Up** — ALL agents who have been added but: (a) were released and haven't sold, OR (b) went through coursework but never got going. Show these as urgent priority. Allow removing/inactivating from this section.

**Changes:**
- Add a 4th section `{ key: "needs_followup", label: "Needs Follow-Up", icon: AlertTriangle, ... }` that filters for agents with no recent production (14+ days) OR agents who completed onboarding but have zero deals
- For Onboarding section: add inline mini progress bar showing coursework completion percentage (query `agent_course_progress` or similar)
- Make the "Needs F/U" quick stat card tappable — clicking scrolls to that section
- Remove the red bar that appears on every agent row (the stale left-border indicator that appears universally — user says "I see this never bar that's red in every single person")

### 2B. Remove Unlicensed Agents from Main CRM → Create Separate Unlicensed Pipeline

**New approach:** Unlicensed agents should NOT appear in the main CRM. Create a separate view/tab for unlicensed tracking with columns:
- Course Not Purchased
- Course Purchased
- Course Finished
- Test Scheduled
- Waiting on License

This mirrors the existing `license_progress` enum. Implement as a tab within the CRM page or a collapsible section below the main CRM.

### 2C. Fix Dead Space in CRM

- Ensure table columns use full available width
- Remove excessive padding and margins
- Make agent rows denser with more information visible inline (motivation, hire date, license step)

---

## Phase 3: Dashboard Improvements

### 3A. Add Estimated Earnings Card (Admin Only)

**File: `src/pages/Dashboard.tsx`**

Add below the "Highest Closing Rate" / "Top Referrals" section:

**Calculation (same as the email):**
- Team AOP (excluding admin): `othersAOP * (9/12) * 0.50` = override earnings
- Personal AOP: `adminAOP * (9/12) * 1.20` = personal earnings
- Total = override + personal

Display as a premium glass card with the dollar amount prominently shown.

### 3B. TotalApplicationsBanner — Remove Breakdown

**File: `src/components/dashboard/TotalApplicationsBanner.tsx`**

Remove the "New Applicants" and "Aged Leads" breakdown line. Only show the total number.

### 3C. Activation Risk — Make Tappable/Navigable

Already tappable/expandable. Ensure clicking individual agents navigates to their CRM detail or expands properly.

---

## Phase 4: Application Form Fix

### 4A. Add Required Motivation Field

**File: `src/pages/Apply.tsx`**

The motivation step already exists (`showMotivationStep`, `motivationText`) but it appears AFTER submission as an optional step. Move it to be a required field within Step 4 (Goals) with minimum 25 characters.

**Changes:**
- Add `motivation` field to the zod schema: `z.string().min(25, "Please share your motivation (minimum 25 characters)")`
- Add a Textarea in Step 4 for motivation
- Make it required before submission (not a post-submission step)

### 4B. Verify Abandoned Applications Working

Check the `partial_applications` table and the `check-abandoned-applications` edge function are properly configured and the cron job is active.

---

## Phase 5: Notification Hub Enhancement

### 5A. Show Previous Blast History

**File: `src/pages/NotificationHub.tsx`**

Add a section showing previous blast campaigns with:
- How many leads were contacted in each blast
- Timestamp of each blast
- Channel used (SMS, email, push)

This helps prevent over-spamming by showing recent outreach history.

---

## Phase 6: Site-Wide Visual Optimization

### 6A. Eliminate Dead Space Across All Pages

Pages affected: Pipeline, Course Progress, Lead Center, CRM

**Approach:**
- Reduce padding on empty areas
- Add contextual information where space exists (motivation text, hire date, last activity)
- Ensure tables use full width
- Add gradient backgrounds to empty sections

### 6B. Ensure All Buttons Are Clickable/Functional

Audit all interactive elements across CRM, Pipeline, Lead Center to ensure click handlers are wired up properly.

---

## Phase 7: Performance & Email Verification

### 7A. Fix Longer Load Times

- Audit queries that may be hitting the 1000-row limit
- Ensure `staleTime: 120_000` is set on all major queries
- Add skeleton loaders where missing

### 7B. Verify All Automated Emails

Ensure cron jobs are active for:
- 8:40 PM fill numbers reminder
- 9 PM admin earnings email
- Abandoned application follow-ups
- All milestone/notification emails

---

## Technical Details

### Files to Modify
| File | Changes |
|------|---------|
| `src/pages/DashboardCRM.tsx` | Add "Needs Follow-Up" section, add unlicensed pipeline tab, add inline course progress bars, remove universal red border, fix dead space |
| `src/pages/LeadCenter.tsx` | Fix Contacted/Closed/Licensed stat calculations |
| `src/pages/Dashboard.tsx` | Add admin estimated earnings card, fix TotalApplicationsBanner reference |
| `src/components/dashboard/TotalApplicationsBanner.tsx` | Remove "New Applicants" and "Aged Leads" breakdown |
| `src/pages/Apply.tsx` | Move motivation to required field in Step 4 with 25-char minimum |
| `src/pages/LogNumbers.tsx` | Debug and fix production submission flow |
| `src/pages/NotificationHub.tsx` | Add blast history section |
| Multiple pages | Dead space reduction, visual polish |

### Database Changes
- Verify `daily_production` unique constraint on `(agent_id, production_date)` exists
- Verify cron jobs are active for all scheduled functions

### No New Dependencies Required

---

## Implementation Order
1. Fix Lead Center stats (data accuracy — most urgent)
2. Fix Log Numbers submission
3. CRM restructure (4 sections + unlicensed pipeline)
4. Dashboard estimated earnings card
5. TotalApplicationsBanner simplification
6. Application form motivation field
7. Notification blast history
8. Site-wide dead space elimination
9. Performance audit
10. Full end-to-end testing

