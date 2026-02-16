
# Fix CRM Pipeline Dashboard -- Accurate Filtering and Clear Organization

## Problems Found

### 1. Stat Card Counts Are Wrong
The four stat cards calculate counts incorrectly:
- **"Hired (Unlicensed)"** checks `licenseProgress` (from applications table) instead of `license_status` (from agents table). Many agents have null `licenseProgress`, so they all get lumped here.
- **"Contracted (Hired)"** counts agents in `onboarding` or `training_online` stages -- this is not "contracted," it's "in course."
- **"Hired (Course Purchased)"** checks `hasTrainingCourse` which is correct but overlaps with the other cards.

### 2. Stat Card Click Filters Don't Match Labels
When you click a stat card, the expanded view filters don't correspond to what the card says:
- Clicking "Contracted (Hired)" sets `expandedColumn = "in_course"` which then filters by onboarding stages, not by contracted status.
- Clicking "Hired (Unlicensed)" sets `expandedColumn = "unlicensed"` which filters by `licenseProgress`, missing agents whose license info comes from the `agents.license_status` field.

### 3. The 3-Column Overview Is Disconnected
The bottom 3-column grid still shows "In Course / In-Field Training / Live" which is a different organizational scheme than the stat cards above. This is confusing -- the user sees one set of categories at the top and a completely different set at the bottom.

### 4. No "Last Contacted" Sorting for Follow-Up Priority
The user wants to easily see who to call next, but there's no sorting by last contacted date or visual indicator of stale leads in the pipeline.

## Solution

### Redesign the Pipeline View Around the Hiring Funnel

#### Stat Cards (top) -- fix the counts and click behavior:

| Card | Label | Count Logic | Click Filter |
|---|---|---|---|
| 1 | Total Leads | All active, non-hidden agents | Show all |
| 2 | Hired (Unlicensed) | Agents where `license_status = 'unlicensed'` (from agents table) | Filter to unlicensed agents |
| 3 | Contracted (Hired) | Agents in `onboarding` or `training_online` stage (they've been contracted and are going through the process) | Filter to onboarding/training_online stage |
| 4 | Course Purchased | Agents where `has_training_course = true` | Filter to agents with course |

#### 3-Column Overview (bottom) -- align with the pipeline:
Replace the current "In Course / In-Field Training / Live" columns with pipeline-aligned columns:
1. **Onboarding** -- agents in `onboarding` or `training_online` stages (newly contracted, getting started)
2. **In-Field Training** -- agents in `in_field_training` stage (actively training)
3. **Live** -- agents in `evaluated` stage (producing)

This is actually the same stages but with a clearer "Onboarding" label instead of "In Course."

#### Add Follow-Up Priority Indicator:
- Add a "stale" visual indicator (orange/red dot) on agent cards where `lastContactedAt` is older than 48 hours or null
- Sort agents within each column by last contacted date (oldest first) so the ones needing attention are at the top

### Files to Modify

1. **`src/pages/DashboardCRM.tsx`**:
   - Fix `hiredUnlicensed` count: use `agent.licenseProgress === 'unlicensed' || agent.licenseProgress === null` combined with checking the agent is actually unlicensed (not licensed)
   - Fix `contractedHired` to properly count agents in onboarding/training_online
   - Fix expanded view filter for "unlicensed" to match the corrected logic
   - Update COLUMNS array label from "In Course" to "Onboarding" for clarity
   - Add stale-lead indicator (orange dot for agents not contacted in 48+ hours)
   - Sort agents within columns by `lastContactedAt` (null/oldest first) for follow-up priority
   - Fix the `expandedColumn` click mapping so "Contracted (Hired)" correctly filters

No database changes needed -- this is purely a UI/logic fix using existing data.
