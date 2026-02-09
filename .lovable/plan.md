

# Fix Licensed View, Manager Assignment, and Verify Coursework

## Issues Identified

1. **"Licensed Agents" section tap may not respond** -- The Collapsible component works in code, but the user reports tapping "License" does nothing. This is likely because the button area is too small or click events are being swallowed. The section headers need better tap targets.

2. **ManagerAssignMenu only shows some managers** -- The component queries `user_roles` for managers, then joins with `agents` table filtering `is_deactivated = false`. There are 5 manager roles but only 4 have agent records, so at most 4 appear. The real problem is the RLS policy on `user_roles`: non-admin users can only see their own role or manager roles if they're a manager. This works for admins but may fail for managers viewing the list. The fix is to use the `get-active-managers` edge function (which uses the service role key and bypasses RLS) instead of client-side queries.

3. **Cannot assign multiple managers at once** -- Currently the menu assigns ONE manager per click. The user wants to select an agent and assign it to multiple managers (or more likely: select multiple agents and bulk-assign them to a manager). This needs a bulk selection + assign flow.

4. **Coursework / Add to Course** -- The `AddToCourseButton` is already present in the expanded agent card. It enrolls the agent, sets stage to `training_online`, creates progress, and sends a login email. This should work as-is. Will verify the module table exists and has data.

5. **Mark as Licensed / Unlicensed** -- Already implemented via `handleToggleLicense` in ManagerTeamView. The button toggles between "Mark Licensed" and "Mark Unlicensed" in the expanded card actions.

## Changes

### 1. Fix ManagerAssignMenu to show ALL managers reliably
**File: `src/components/dashboard/ManagerAssignMenu.tsx`**

Replace the client-side `user_roles` + `agents` + `profiles` queries with a single call to the existing `get-active-managers` edge function. This function uses the service role key and already returns all active managers with names. This guarantees all managers appear regardless of RLS restrictions.

### 2. Make ManagerAssignMenu a proper labeled button (not just an icon)
**File: `src/components/dashboard/ManagerTeamView.tsx`**

Change the ManagerAssignMenu trigger from a tiny icon-only button to a labeled "Assign Manager" button matching the style of the other action buttons (Edit Agent, Send Login, etc.). This improves discoverability and tap targets.

### 3. Pass `currentManagerId` correctly to ManagerAssignMenu
**File: `src/components/dashboard/ManagerTeamView.tsx`**

Currently `currentManagerId={null}` is hardcoded. Fix it to pass the actual `invited_by_manager_id` from the agent's data so the checkmark shows correctly next to the currently assigned manager.

To do this, add `invitedByManagerId` to the `TeamMember` interface and populate it from `agent.invited_by_manager_id` during `fetchTeamData`.

### 4. Improve Licensed/Unlicensed section tap targets
**File: `src/components/dashboard/ManagerTeamView.tsx`**

The Collapsible trigger buttons are already full-width. Add `type="button"` explicitly and ensure `onClick` propagation is not blocked. Add a slight min-height for better mobile tapping.

### 5. Verify coursework modules exist
Run a query to confirm `onboarding_modules` has active modules so the "Add to Course" button will find them.

## Technical Details

| File | Change |
|------|--------|
| `src/components/dashboard/ManagerAssignMenu.tsx` | Switch from client-side RLS queries to `get-active-managers` edge function; change trigger to labeled button |
| `src/components/dashboard/ManagerTeamView.tsx` | Pass real `invitedByManagerId` to ManagerAssignMenu; add `invitedByManagerId` to TeamMember interface; improve tap targets on collapsible headers |

