
# Full Platform Audit & Fix Plan

## Issues Found

### 1. CRM License Badge — Missing Stages & No Test Date
**File**: `DashboardCRM.tsx` lines 1008-1015

The CRM table row license badge only maps 4 states (`Licensed`, `Course`, `Passed`, `Waiting`) and falls through to `Unlicensed` for everything else. Missing stages: `finished_course`, `test_scheduled`, `fingerprints_done`. No test date shown.

Also, all non-licensed badges use the same grey color — no visual differentiation.

**Fix**:
- Add all license progress stages to the label map: `finished_course` → "Finished", `test_scheduled` → "Test Sched." (with date if available), `fingerprints_done` → "Fingerprints"
- Add per-stage colors matching the `LicenseProgressSelector` palette
- Show test date inline when `testScheduledDate` exists (e.g., "Test 3/15")

### 2. Recruiter HQ — Contracted Agents Not Showing
**File**: `RecruiterDashboard.tsx` line 935

The query filters `.is("contracted_at", null)` which excludes anyone who has been contracted (hired). Many agents who purchased a course, have a test scheduled, or are waiting on license have already been contracted — so they disappear from Recruiter HQ.

**Fix**:
- Remove the `.is("contracted_at", null)` filter so contracted-but-unlicensed agents show in the Recruiter HQ pipeline
- Keep the `.is("terminated_at", null)` filter (terminated should stay hidden)
- Also exclude `licensed` progress from the main view since they're done

### 3. Recruiter HQ — Test Date Not Shown in Table Row
**File**: `RecruiterDashboard.tsx` lines 1459-1469

The desktop table shows the `LicenseProgressSelector` button but doesn't display the test scheduled date inline. When you have 30+ leads, you need to see at-a-glance who has a test coming up.

**Fix**:
- After the `LicenseProgressSelector`, show a small date badge when `lead.test_scheduled_date` exists (e.g., "📅 Mar 15")

### 4. CRM Unlicensed Pipeline — Missing `finished_course` Column
**File**: `DashboardCRM.tsx` lines 199-205

The `UNLICENSED_COLUMNS` array groups `test_scheduled` and `passed_test` together, and `fingerprints_done` with `waiting_on_license`. But `finished_course` is lumped with `course_purchased`. Since "Finished Course" is a distinct meaningful milestone, it should have its own column.

**Fix**:
- Split `finished_course` into its own column for clearer pipeline visibility

### 5. CRM Header Says "Recruiter HQ" Instead of "Agent CRM"
**File**: `DashboardCRM.tsx` line 863

The page title says "Recruiter HQ" but this is the CRM page (`/dashboard/crm`). The actual Recruiter HQ is at `/dashboard/recruiter`. This is confusing.

**Fix**: Change to "Agent CRM"

### 6. Sidebar — Recruiter HQ Hidden from Managers
**File**: `GlobalSidebar.tsx` lines 161-164

Recruiter HQ is gated to `isAisha || isAdmin`. The user likely wants all managers to have access since the route already checks `isAdmin || isManager`.

**Fix**: Change sidebar visibility to `isAdmin || isManager` to match the route guard.

## Files to Edit
1. `src/pages/DashboardCRM.tsx` — Fix license badges (stages + colors + test date), fix CRM title, split unlicensed pipeline columns
2. `src/pages/RecruiterDashboard.tsx` — Remove `contracted_at IS NULL` filter, add test date display in table rows
3. `src/components/layout/GlobalSidebar.tsx` — Show Recruiter HQ for all managers

## No database changes needed
