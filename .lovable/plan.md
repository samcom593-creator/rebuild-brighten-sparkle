
# Fix CRM Stage Click Reload and Dashboard Metric Accuracy

## Problem 1: Stage Click Causes Page Reload

When you click a stage bubble in the CRM to move an agent (e.g., to "Live"), the entire page reloads because the `onStageUpdate` callback calls `fetchAgents`, which sets `loading = true` and re-fetches all data from the database. This forces you to scroll back, find the agent again, and click the next stage.

### Fix

Replace the full `fetchAgents` refetch with an **optimistic local state update**. When a stage is clicked:
- Immediately update the agent's stage in the local `agents` array (no loading spinner, no scroll reset)
- The page stays exactly where it is
- The database is already updated by the OnboardingTracker itself

**File**: `src/pages/DashboardCRM.tsx`
- Create a new `handleOptimisticStageUpdate` function that takes `agentId` and updates the agent's `onboardingStage` in the local state using `setAgents(prev => prev.map(...))`
- Replace `onStageUpdate={fetchAgents}` with `onStageUpdate={() => handleOptimisticStageUpdate(agent.id)}`
- The function will re-read the agent's current stage from the database (a single lightweight query) and update just that one agent in state -- no full reload

## Problem 2: Dashboard Metrics Show Wrong Numbers

The CRM stat cards (In Course, In Training, Live, etc.) count agents using `agents.filter(a => !a.isDeactivated)`, but this still includes agents marked as `isInactive`. Inactive agents should not count toward any active metric.

### Fix

Update the `activeAgents` calculation to also exclude inactive agents:

**File**: `src/pages/DashboardCRM.tsx`
- Change `const activeAgents = agents.filter(a => !a.isDeactivated);` to `const activeAgents = agents.filter(a => !a.isDeactivated && !a.isInactive);`
- This ensures all stat cards (In Course, In Training, Live, Meeting Eligible, Paid Agents) only count truly active agents

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/DashboardCRM.tsx` | Replace full refetch with optimistic update on stage change; fix activeAgents filter to exclude inactive |
