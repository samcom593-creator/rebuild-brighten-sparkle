
# Add Inline Manager Reassignment and Stage Change to Dashboard and Command Center

## What Changes

### 1. Command Center -- Add "Reassign Manager" and "Change Stage" to Dropdown Menu
The three-dot dropdown currently has Edit Profile, Promote/Demote, Email Login, Copy Login, and Reactivate/Remove. We will add two new menu items:

- **"Reassign Manager"** -- opens a sub-menu listing all available managers (same pattern as `ManagerAssignMenu` component). Tapping a manager name instantly updates `invited_by_manager_id` and refreshes the list.
- **"Change Stage"** -- opens a sub-menu with the four onboarding stages (Onboarding, Training Online, In Field Training, Evaluated). Tapping one instantly updates `onboarding_stage` and refreshes.

Both will use `DropdownMenuSub` / `DropdownMenuSubContent` for a clean nested menu experience, keeping everything one-tap accessible without opening the full profile editor.

### 2. Dashboard Roster -- Add Inline Manager Reassignment
The expanded agent card in `ManagerTeamView.tsx` already shows inline onboarding stage controls (`OnboardingTracker`), license toggle, and action buttons. We will add:

- A **Manager Reassign button** using the existing `ManagerAssignMenu` component, placed in the action buttons row alongside "Edit Agent", "Send Login", etc.
- This component already fetches managers and handles the update -- it just needs to be imported and wired up with `onAssigned={fetchTeamData}`.

## Technical Details

| File | Change |
|------|--------|
| `src/pages/DashboardCommandCenter.tsx` | Add `DropdownMenuSub` imports; fetch managers list on mount; add "Reassign Manager" sub-menu and "Change Stage" sub-menu to the dropdown |
| `src/components/dashboard/ManagerTeamView.tsx` | Import and add `ManagerAssignMenu` component in the expanded card action buttons row |

### Command Center dropdown additions
The dropdown will gain two new sections between "Edit Profile" and "Promote/Demote":

```text
Edit Profile
---
Reassign Manager >  [Sub-menu: Unassigned, Manager A, Manager B, ...]
Change Stage >      [Sub-menu: Onboarding, Training Online, In Field Training, Evaluated]
---
Promote to Manager / Remove Manager Role
...
```

Each sub-menu item will directly update the database and call `refetch()` with a success toast -- no extra dialogs or confirmation needed, keeping it one-tap as requested.

### Dashboard roster addition
The expanded card action buttons row will include the `ManagerAssignMenu` dropdown button (Users icon) next to the existing Edit/Send Login/License/Reactivate buttons, giving managers and admins quick reassignment without opening the full edit dialog.
