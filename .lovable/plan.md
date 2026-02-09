
# Fix Dashboard Agent Roster to Match Command Center

## Problem
The dashboard's "Your Team" section shows agents split into two collapsible sections: **Licensed Agents (7)** expanded by default, and **Unlicensed Pipeline (11)** collapsed by default. This makes it look like only 7 agents exist. The Command Center shows all 18 agents in a single view. Additionally, the dashboard roster is missing key action buttons that exist in the Command Center (delete, add to course).

## Changes

### 1. Expand both sections by default
In `ManagerTeamView.tsx`, change the initial state for `unlicensedOpen` from `false` to `true` so admins see all agents immediately without clicking.

### 2. Add missing action buttons to each agent's expanded view
Currently the expanded agent card only shows **Edit Agent** and **Send Login**. Add:
- **Add to Course** button (using the existing `AddToCourseButton` component)
- **Deactivate/Delete** button (using the existing `DeactivateAgentDialog` component)

These components already exist and work in other parts of the app -- they just need to be wired into the roster's expanded card view.

### 3. Filter out the admin's own record from the roster
The admin (Samuel James) currently appears in their own roster list. Filter out the current user's agent record so they only see their team members.

---

## Technical Details

### File: `src/components/dashboard/ManagerTeamView.tsx`

| Change | Detail |
|--------|--------|
| Default `unlicensedOpen` to `true` | Line 87: `useState(false)` becomes `useState(true)` |
| Import `AddToCourseButton` | Add import for existing component |
| Import `DeactivateAgentDialog` | Add import for existing component |
| Add state for deactivate dialog | Track which agent is being deactivated |
| Add buttons to expanded card (lines 463-485) | Add "Add to Course" and "Remove Agent" buttons alongside existing Edit/Send Login buttons |
| Filter out current user from admin view | After fetching agents, exclude the agent whose `user_id` matches `user.id` |

No new files, no database changes, no edge functions needed. This is purely a UI wiring fix using existing components.
