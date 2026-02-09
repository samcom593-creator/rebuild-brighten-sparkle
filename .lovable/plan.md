

# Fix Agent Merge, Remove Button, and Manager Promotion

## Problems

1. **Recent Invitations: Missing remove (X) button** -- The X button was removed in a prior edit. You want it back so you can remove invalid entries from the invitation tracker.

2. **Merge tool won't show all agents** -- The DuplicateMergeTool and AgentQuickEditDialog both fetch agent names via `profiles!agents_profile_id_fkey`. Agents missing `profile_id` appear as "Unknown" and get filtered out of the merge list. This is why you can't find certain agents to merge with.

3. **No "Promote to Manager" button in Dashboard** -- The promote/demote manager feature only exists in the Command Center. The Dashboard Agency Roster (ManagerTeamView) has no way to make someone a manager.

## Changes

### 1. Add X (remove) button back to InvitationTracker
**File: `src/components/dashboard/InvitationTracker.tsx`**

- Add a remove button (X icon) next to each invitation entry
- On click, mark the agent as deactivated (`is_deactivated: true, status: "terminated"`)
- Include a confirmation step to prevent accidental taps
- Import the `X` icon from lucide-react

### 2. Fix DuplicateMergeTool to show all agents (user_id fallback)
**File: `src/components/admin/DuplicateMergeTool.tsx`**

- After fetching agents via `profiles!agents_profile_id_fkey`, identify agents where the profile join returned null
- For those agents, fetch profiles by `user_id` as a fallback (same pattern used in Command Center)
- Use the fallback profile data for `fullName`, `email`, and `phone` so no agent appears as "Unknown"
- Remove the `filter(m => m.name !== "Unknown")` line so ALL agents appear in the merge list

### 3. Fix AgentQuickEditDialog merge list (same user_id fallback)
**File: `src/components/dashboard/AgentQuickEditDialog.tsx`**

- The `fetchPossibleMatches` function fetches profiles by `user_id` already, but filters out "Unknown" agents (line 217)
- Remove the `.filter(m => m.name !== "Unknown")` so all agents appear as merge targets
- For agents that still have no profile at all, show them with a label like "Agent (no profile)" so they're still selectable

### 4. Add "Promote to Manager" button in Dashboard Agency Roster
**File: `src/components/dashboard/ManagerTeamView.tsx`**

- Add a "Make Manager" / "Remove Manager" toggle button in the expanded agent card actions (next to Edit Agent, Send Login, etc.)
- The button inserts a `manager` role into `user_roles` (promote) or deletes it (demote)
- Only visible to admins
- After toggling, refresh the team data
- Add a teal "Manager" badge next to agent names who have the manager role

### Technical Details

| File | Change |
|------|--------|
| `src/components/dashboard/InvitationTracker.tsx` | Add X button with confirmation to remove/deactivate agents |
| `src/components/admin/DuplicateMergeTool.tsx` | Add user_id fallback profile lookup; remove "Unknown" filter |
| `src/components/dashboard/AgentQuickEditDialog.tsx` | Remove "Unknown" filter from merge target list |
| `src/components/dashboard/ManagerTeamView.tsx` | Add Promote/Demote Manager button; fetch and display manager roles |

