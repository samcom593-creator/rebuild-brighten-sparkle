
# Fix: Dashboard Stat Mismatches, Aged Leads Duplicates, and Related Bugs

## Issues Identified

### 1. CRM Dashboard: Stat Cards Don't Match Expanded Views
**Root Cause**: The stat card counts use `activeAgents` (line 638: agents where `!isDeactivated && !isInactive`), but when you tap a stat card to see the list, the expanded view (line 1523-1531) uses `filteredAgents` which additionally excludes agents with `evaluationResult === "failed"` for non-admin users (line 649). This causes the stat to say "19 In-Field Training" but only show 1 when tapped.

**Fix**: Change expanded view references from `filteredAgents` to `activeAgents` (with search/manager filters applied) so the list matches the count exactly.

**File**: `src/pages/DashboardCRM.tsx` (lines 1523-1531)
- Replace all `filteredAgents` references with `activeAgents` filtered by search + manager only (no evaluation filter)

### 2. Aged Leads: "49 Duplicates" Click Does Nothing
**Root Cause**: The duplicate banner calls `handleAutoMergeDuplicates()` which uses `window.confirm()`. On mobile browsers and some embedded webviews, `window.confirm()` can be blocked or not visible. The user taps the banner and sees no response.

**Fix**: Replace `window.confirm()` with a proper dialog component (AlertDialog from Radix) that works reliably on all devices.

**File**: `src/pages/DashboardAgedLeads.tsx`
- Add AlertDialog state for merge confirmation
- Replace `window.confirm` with AlertDialog that shows the count and confirms the action
- Ensure the merge actually processes and refreshes the list

### 3. Stat Card "In-Field Training" Shows Wrong Count
Same root cause as issue 1 -- the `stageFilter` logic and expanded view filter diverge. The fix in issue 1 resolves this.

---

## Technical Changes

### File 1: `src/pages/DashboardCRM.tsx`

**Change**: In the expanded view section (around line 1523), replace `filteredAgents` with `activeAgents` for all stat-card-triggered views so counts match:

```typescript
// Before (line 1523-1531)
const expandedAgentsUnsorted = expandedColumn === "all"
  ? filteredAgents
  : expandedColumn === "unlicensed"
  ? filteredAgents.filter(a => a.agentLicenseStatus !== "licensed")
  : expandedColumn === "course_purchased"
  ? filteredAgents.filter(a => a.hasTrainingCourse)
  : filteredAgents.filter(a => config.stages.includes(a.onboardingStage));

// After -- use activeAgents with search+manager filters only
const searchManagerFiltered = activeAgents.filter(a => {
  const matchesSearch = !searchTerm || 
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.email.toLowerCase().includes(searchTerm.toLowerCase());
  const matchesManager = managerFilter === "all" || a.managerId === managerFilter;
  return matchesSearch && matchesManager;
});

const expandedAgentsUnsorted = expandedColumn === "all"
  ? searchManagerFiltered
  : expandedColumn === "unlicensed"
  ? searchManagerFiltered.filter(a => a.agentLicenseStatus !== "licensed")
  : expandedColumn === "paid"
  ? searchManagerFiltered.filter(a => a.onboardingStage === "evaluated" && (a.standardPaid || a.premiumPaid))
  : expandedColumn === "course_purchased"
  ? searchManagerFiltered.filter(a => a.hasTrainingCourse)
  : searchManagerFiltered.filter(a => config.stages.includes(a.onboardingStage));
```

### File 2: `src/pages/DashboardAgedLeads.tsx`

**Change**: Replace `window.confirm` with a proper AlertDialog for the merge duplicates action.

- Add state: `const [showMergeConfirm, setShowMergeConfirm] = useState(false);`
- Add state: `const [mergeCount, setMergeCount] = useState(0);`
- Modify `handleAutoMergeDuplicates` to calculate `idsToDelete`, store them in state, and show the dialog instead of `window.confirm`
- Add AlertDialog component to the JSX that, on confirm, executes the delete operation
- This ensures the confirmation works on all devices including mobile

---

## Files Modified

| File | Change |
|------|--------|
| `src/pages/DashboardCRM.tsx` | Fix expanded view to use `activeAgents` with search/manager filters, matching stat card counts |
| `src/pages/DashboardAgedLeads.tsx` | Replace `window.confirm` with AlertDialog for duplicate merge; ensure merge works on mobile |

## Priority
Both fixes are critical for dashboard accuracy and usability.
