

# CRM Improvements: Direct Stage Jump, Paid Agents Drill-Down, and Auto-Mark Sold

## Changes

### 1. OnboardingTracker -- Allow jumping to ANY stage directly (not step-by-step)

Currently, the `OnboardingTracker` component only allows clicking the adjacent stage (line 182: `if (Math.abs(targetIndex - currentIndex) !== 1) return;`). This forces you to click through each stage one by one.

**Fix**: Remove the adjacency restriction so clicking ANY stage circle jumps directly to it. The `handleStageClick` function will be updated to call the database with the target stage directly, skipping intermediate stages. Confetti and notifications will still fire for forward jumps.

**File**: `src/components/dashboard/OnboardingTracker.tsx`
- Remove the `Math.abs(...) !== 1` guard
- Update `handleStageClick` to directly set any target stage (not route through `handleStageChange` which only does +1/-1)
- All circles become clickable (not just adjacent ones)
- Keep the confirmation celebrations for forward moves

### 2. LicenseProgressSelector -- Already allows direct jump (no change needed)

The `LicenseProgressSelector` dropdown already lets you click any value from the menu and it updates directly (line 132: `onClick={() => handleUpdateProgress(step.value)}`). No restriction exists. This one is already working correctly.

### 3. Paid Agents stat card -- Make it clickable with drill-down

Currently the "Paid Agents" card (lines 1123-1133) is a static display with no click handler. 

**Fix**: Make it clickable like the other stat cards. When tapped, expand to show a filtered list of exactly which agents have paid this week, showing their name, payment tier ($250 Standard or $1K Premium), and badge.

**File**: `src/pages/DashboardCRM.tsx`
- Add `"paid"` to the expandedColumn options
- Make the Paid Agents GlassCard clickable with `onClick={() => setExpandedColumn("paid")}`
- Add a "paid" case to the expanded view renderer that shows only agents where `standardPaid` or `premiumPaid` is true
- Each paid agent renders using the existing `renderAgentCard` function

### 4. Auto-mark "Sold" when a deal is submitted

Currently, the "Sold" attendance row (`daily_sale` type) in the CRM is manual. When an agent submits production with `deals_closed > 0`, the system should automatically mark that day's `daily_sale` attendance as "present".

**Fix**: After the production upsert succeeds in both `CompactProductionEntry` and `ProductionEntry`, if `deals_closed > 0`, automatically upsert an `agent_attendance` record for that date with `attendance_type = 'daily_sale'` and `status = 'present'`.

**Files**: 
- `src/components/dashboard/CompactProductionEntry.tsx` -- Add auto-mark after successful upsert
- `src/components/dashboard/ProductionEntry.tsx` -- Add auto-mark after successful upsert

The upsert will use `onConflict: "agent_id,attendance_date,attendance_type"` so it won't create duplicates if the admin already marked it manually.

## Summary of Files to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/OnboardingTracker.tsx` | Remove adjacency restriction, allow direct jump to any stage |
| `src/pages/DashboardCRM.tsx` | Make Paid Agents card clickable with drill-down list |
| `src/components/dashboard/CompactProductionEntry.tsx` | Auto-mark daily_sale attendance when deals > 0 |
| `src/components/dashboard/ProductionEntry.tsx` | Auto-mark daily_sale attendance when deals > 0 |

