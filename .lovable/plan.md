

# Lead Center Fixes, Auto-Merge Duplicates, Pipeline Label, and Course Progress Sort

## Issues Found

1. **Lead Center "Closed" stat card** -- When clicked, it sets `filterStatus = "hired"` but the filter logic only matches `lead.status === "hired"`. It misses leads with `status === "contracted"`. Need to filter for both hired AND contracted when "Closed" card is clicked.

2. **Lead Center "Contacted" stat card** -- The stat counts leads with `contactedAt` set, but clicking it sets `filterStatus = "contacted"`. The filter then checks `lead.status === "contacted"`, which won't match most leads because `status` stays "new" even after contact. Fix: use the same `contactedAt`-based logic as "not_contacted" does.

3. **Aged Leads duplicates** -- Duplicates are detected client-side but there's no "Auto-Merge All" button. Add a button that groups duplicates by email/phone and automatically keeps the newest record (deleting older ones) without manual selection.

4. **Aged Leads "Processed" stat card** -- User says remove "Process" but keep "Hired". The stats show "Unprocessed" and "Processed" -- rename "Processed" to something clearer or remove in favor of more useful stat.

5. **Dashboard Pipeline "Unlicensed" label** -- User wants it renamed to "In Pre-Licensing Course" to reflect agents who have been hired and are working on getting licensed. Also should count agents with `has_training_course = true` and `license_status = 'unlicensed'`.

6. **Course Progress sort order** -- Currently sorts at-risk first, complete last. User wants finished agents at the top, not-started at the bottom. Reverse the priority order.

---

## Changes

### 1. Lead Center Stat Card Filters (`src/pages/LeadCenter.tsx`)

**Fix "Closed" card click:**
- Change the onClick to set a custom filter value like `"closed_all"` instead of `"hired"`
- In the filter logic, when `filterStatus === "closed_all"`, match leads where `status === "hired" || status === "contracted"`
- Mark the card as active when `filterStatus === "closed_all"`

**Fix "Contacted" card click:**
- Change the onClick to set `filterStatus = "has_contacted"` (a custom value)
- In the filter logic, when `filterStatus === "has_contacted"`, match leads where `!!lead.contactedAt`
- This ensures clicking "Contacted" actually shows all leads that have been contacted regardless of their status field

### 2. Auto-Merge Duplicates Button (`src/pages/DashboardAgedLeads.tsx`)

Add a "Merge All Duplicates" button in the header area (visible when duplicates exist):
- Groups leads by normalized email or phone (last 10 digits)
- For each group, keeps the newest lead (by `created_at`) and deletes the older ones (hard delete from `aged_leads`)
- Shows a confirmation dialog with count before proceeding
- After merge, refreshes the lead list

### 3. Rename Stats in Aged Leads (`src/pages/DashboardAgedLeads.tsx`)

Remove "Processed" stat card. Replace with duplicate count or keep only: Total, Unprocessed, Hired, Duplicates (showing `duplicateMap.size` count).

### 4. Rename Pipeline Label (`src/components/dashboard/OnboardingPipelineCard.tsx`)

- Change "Unlicensed" label to "Pre-Licensing"
- Update the count logic to specifically count agents where `license_status = 'unlicensed'` AND `has_training_course = true` (agents actively in the licensing course process)
- Add `has_training_course` to the query select

### 5. Course Progress Sort Order (`src/pages/CourseProgress.tsx`)

Reverse the sort priority so finished agents appear first:
- Priority 0: Complete (100%)
- Priority 1: In Progress (started, not stalled)
- Priority 2: Stalled
- Priority 3: At Risk
- Priority 4: Not Started

Within each group, sort by percent descending (highest progress first).

---

## Technical Details

### File: `src/pages/LeadCenter.tsx`

**Lines 306-315 (filter logic):** Add two new special cases:
- `"closed_all"`: matches `lead.status === "hired" || lead.status === "contracted"`
- `"has_contacted"`: matches `!!lead.contactedAt`

**Lines 764-774 (Contacted card onClick):** Change `setFilterStatus("contacted")` to `setFilterStatus("has_contacted")`

**Lines 772-773 (Closed card onClick):** Change `setFilterStatus("hired")` to `setFilterStatus("closed_all")`

**Lines 765, 774 (active checks):** Update to match new filter values

### File: `src/pages/DashboardAgedLeads.tsx`

**Header area (around line 407):** Add "Merge Duplicates" button with duplicate count badge, visible only when `duplicateMap.size > 0`

**New function `handleAutoMergeDuplicates`:** Groups leads by email, keeps newest per group, deletes the rest via `supabase.from("aged_leads").delete().in("id", idsToDelete)`, then calls `fetchLeads()`

**Stats row (lines 420-446):** Replace "Processed" with "Duplicates" showing `duplicateMap.size`

### File: `src/components/dashboard/OnboardingPipelineCard.tsx`

**Line 46:** Add `has_training_course` to select
**Lines 63-73:** Change unlicensed count to only count agents where `license_status === 'unlicensed'` AND `has_training_course === true`
**Line 79:** Change label from "Unlicensed" to "Pre-Licensing"

### File: `src/pages/CourseProgress.tsx`

**Lines 275-287 (sort function):** Reverse priority order: complete = 0, in_progress = 1, stalled = 2, at_risk = 3, not_started = 4. Change secondary sort to `b.percentComplete - a.percentComplete` (descending).

