

# CRM Speed Fixes, Login Button, and Dashboard Agent Edit

## Issues Identified

### 1. CRM Checklist Toggles Are Slow (Training Course, Discord, Dialer)
**Root Cause**: Every toggle click in `AgentChecklist.tsx` calls `onUpdate()` which triggers a full `fetchAgents()` in `DashboardCRM.tsx`. This refetches ALL agents, their profiles, manager names, and production data -- a cascade of 5+ database queries just to toggle one checkbox.

**Fix**: Add optimistic local state updates in `DashboardCRM.tsx` so toggles update instantly in the UI without waiting for a full refetch.

### 2. Login Button Missing for Non-Live Agents
**Current**: The "Send Login" button only appears for agents in the `evaluated` (Live) stage (line 749 of DashboardCRM.tsx).

**Fix**: Show the Login button for ALL agents who have a `userId` (meaning they have an account). The portal login email already includes the Discord link, so this is already handled.

### 3. Dashboard Agency Roster - Cannot Click to Edit Agents
**Current**: The `ManagerTeamView` component (used in Dashboard under "Your Team") only expands to show stats and an onboarding tracker. There is no way to click on an agent to edit their info, update password, or change email.

**Fix**: Add a full-featured edit button to each agent row in `ManagerTeamView` that opens the `AgentQuickEditDialog` with admin capabilities (name, email, phone, password update, production edits).

### 4. Performance - Optimistic Updates
Replace full refetches with instant local state mutations for all toggle actions in the CRM.

---

## File Changes

### `src/components/dashboard/AgentChecklist.tsx`
- Add an `onOptimisticToggle` callback prop that passes `(agentId, field, newValue)` so the parent can update local state immediately
- Keep the database update async in the background

### `src/pages/DashboardCRM.tsx`
- Add an `handleOptimisticChecklistToggle` function that updates `agents` state directly without refetching
- Change `onUpdate={fetchAgents}` to use the optimistic handler for the checklist
- Move the "Send Login" button to show for ALL agents with a userId (not just evaluated)
- Add `AgentQuickEditDialog` import and state for opening it on agent name click

### `src/components/dashboard/ManagerTeamView.tsx`
- Add an "Edit" button to each expanded agent row
- Import and integrate `AgentQuickEditDialog` so admins can click to edit name, email, phone, and production
- Add a "Send Login" button in the expanded view

---

## Technical Details

### Optimistic Checklist Toggle (CRM Speed Fix)
```
handleOptimisticToggle(agentId, field, newValue):
  1. Immediately update local agents state (instant UI)
  2. Database update runs in background
  3. On error, revert the local state and show toast
```

### Login Button Visibility Change
Current condition: `isInFieldActive` (evaluated only)
New condition: `agent.userId` (any agent with an account)

### ManagerTeamView Agent Edit
Add `AgentQuickEditDialog` state management and render it when an agent's edit button is clicked. Pass `onUpdate={fetchTeamData}` to refresh after changes.

