
# Interactive Filter Cards for Agency Roster

## What Changes

The 4 stat cards at the top of the "Your Team" / "Agency Roster" section currently just display numbers. They will become clickable filters that instantly filter the agent list below. A 5th card will be added for agents in training.

### Filter Cards (clickable, with active highlight):

| Card | Filter Logic |
|------|-------------|
| **Team Members** | Shows ALL active agents (reset/default) |
| **Licensed** | Shows only `licenseStatus === "licensed"` agents |
| **Unlicensed** | Shows only `licenseStatus !== "licensed"` agents |
| **In Training** | Shows agents with `onboardingStage` of `training_online` OR `in_field_training` |
| **Avg Close Rate** | Stays as display-only (no filter) |

### Behavior
- Clicking a card highlights it with a colored ring/border to show it's active
- The collapsible sections (Licensed Agents, Unlicensed Pipeline) below are replaced with a single flat list when a filter is active
- Clicking the same card again (or clicking "Team Members") resets to the default grouped view
- The count on each card updates in real-time based on actual data

## Technical Changes

### File: `src/components/dashboard/ManagerTeamView.tsx`

1. **Add state**: `activeFilter` with type `"all" | "licensed" | "unlicensed" | "training"`

2. **Add `trainingMembers` memo**: Filter `activeMembers` where `onboardingStage` is `training_online` or `in_field_training`

3. **Add `trainingCount` to `teamStats`**: Count agents in training stages

4. **Update stat cards grid** (lines 765-810):
   - Change from `grid-cols-2 md:grid-cols-4` to `grid-cols-2 md:grid-cols-5` to fit the new card
   - Wrap each card in a clickable div with `onClick` to set the filter
   - Add active state styling: ring highlight + slightly elevated shadow when selected
   - Add the "In Training" card with a violet/purple theme (matching the existing `in_field_training` badge color)
   - Keep "Avg Close Rate" as non-clickable (no cursor-pointer, no filter action)

5. **Update the roster list** (lines 835-918):
   - When `activeFilter !== "all"`, render a single flat list of the filtered members instead of the collapsible Licensed/Unlicensed/Terminated sections
   - When `activeFilter === "all"`, keep the current collapsible behavior (Licensed, Unlicensed Pipeline, Terminated sections)

6. **Add `filteredMembers` memo**: Based on `activeFilter`, return the appropriate subset from `sortedMembers` (excluding terminated unless filter is "all")
