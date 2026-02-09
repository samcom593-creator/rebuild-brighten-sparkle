

# Add Reactivate Button Across All Platforms

## Problem
When agents are marked as "Terminated" or "Inactive", there is no quick reactivate button in the **Command Center**. The Dashboard roster already has one, but the Command Center's three-dot menu only shows "Remove from Pipeline" with no way to undo termination. The Accounts page has a toggle but it only updates `status` without clearing the `is_deactivated` and `is_inactive` flags, which means the agent still appears terminated in other views.

## Changes

### 1. Command Center (`DashboardCommandCenter.tsx`)
- Add a **"Reactivate Agent"** menu item in the three-dot dropdown menu, shown conditionally when `agent.isDeactivated || agent.isInactive`
- The reactivate handler will update the agent record: `status = "active"`, `is_deactivated = false`, `is_inactive = false`, `deactivation_reason = null`
- Play a success sound and show a toast on completion
- Refetch agent list after reactivation
- Import `RotateCcw` icon from lucide-react for the menu item

### 2. Accounts Page (`DashboardAccounts.tsx`)
- Fix `handleToggleStatus` to also clear `is_deactivated` and `is_inactive` flags when reactivating (setting status back to "active")
- Currently it only sets `status: "active"` but leaves the deactivation flags untouched, so agents still appear terminated elsewhere

### 3. Dashboard Roster (already done)
- `ManagerTeamView.tsx` already has a working `handleReactivate` button -- no changes needed here.

## Technical Details

| File | Change |
|------|--------|
| `src/pages/DashboardCommandCenter.tsx` | Add `handleReactivate` function; add conditional "Reactivate Agent" menu item with green styling in the dropdown; import `RotateCcw` |
| `src/pages/DashboardAccounts.tsx` | Update `handleToggleStatus` to also set `is_deactivated: false, is_inactive: false, deactivation_reason: null` when reactivating |

### Reactivation query (both files)
```text
UPDATE agents SET
  status = 'active',
  is_deactivated = false,
  is_inactive = false,
  deactivation_reason = null
WHERE id = agent_id
```

### Command Center dropdown change
The three-dot menu will conditionally show either:
- **"Reactivate Agent"** (green, with RotateCcw icon) -- when agent is deactivated/inactive
- **"Remove from Pipeline"** (red, with UserX icon) -- when agent is active

This ensures terminated agents can be reactivated with one tap from any management screen.
