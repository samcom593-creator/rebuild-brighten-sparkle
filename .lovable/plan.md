

# Fix Call Center: Reassignment Persistence, Lead Skipping, and Filtering

## Problems Identified

1. **Reassigned leads come back after refresh** -- When you reassign a lead, it gets removed from your screen temporarily (local state), but when you refresh or restart the Call Center, it reappears. This happens because the reassignment updates the database correctly, but the lead-fetching query does not consistently filter out leads that belong to other managers. Specifically, if your agent ID lookup fails or is delayed, the filter is skipped entirely.

2. **Cannot skip through leads freely** -- The current "Skip" button only moves forward one lead at a time and stops at the end. There is no way to go backwards or freely navigate the queue.

3. **Filter between new and old leads** -- The Sort Order filter exists (oldest first / newest first), but it only controls sort direction. There is no dedicated "New Leads" vs "Old Leads" split that lets you call only recent opt-ins or only aged/older leads.

---

## Fixes

### 1. Reassignment Persistence (Critical Fix)

**Root cause**: The `agentId` state starts as `null` and loads asynchronously. If the lead fetch runs before `agentId` resolves, no assignment filter is applied, returning ALL leads regardless of who they belong to.

**Fix in `CallCenter.tsx`**:
- Block the "Start Calling" button until `agentId` has loaded (show a loading state)
- Require `agentId` to be non-null before executing the fetch query
- If `agentId` is null when fetching, return empty results instead of unfiltered results
- This ensures the database queries always include the `assigned_manager_id = agentId` / `assigned_agent_id = agentId` filter

### 2. Lead Navigation (Skip Forward and Back)

**Fix in `CallCenter.tsx`**:
- Add a "Previous" button alongside the existing "Skip" (Next) button
- Allow navigating backwards through already-viewed leads
- Show current position indicator (e.g., "Lead 3 of 45")

**Fix in `CallCenterActions.tsx`**:
- Add an `onPrevious` callback prop
- Add a back/previous button to the action bar

### 3. Ensure Filters Work Correctly

The existing filters already handle source (aged leads vs applications), license status, lead status, and sort order. No structural changes needed -- the real issue was that the agentId race condition made it look like filters were broken.

---

## Technical Details

### File: `src/pages/CallCenter.tsx`

1. Guard the fetch: if `agentId` is falsy, skip the fetch entirely and set leads to empty
2. Disable the "Start Calling" button while `agentId` is loading
3. Add `handlePrevious` function that decrements `currentIndex` (min 0)
4. Pass `onPrevious` to `CallCenterActions`
5. Add lead position display ("Lead X of Y")

### File: `src/components/callcenter/CallCenterActions.tsx`

1. Add `onPrevious` prop
2. Add a "Previous" / back button to the UI

### File: `src/components/callcenter/CallCenterFilters.tsx`

No changes needed -- the filters already cover source, license, status, progress, and sort order.

