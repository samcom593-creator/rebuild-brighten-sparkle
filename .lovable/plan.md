

# Fix Building Leaderboard & Add Agency Growth Stats

## Problems Identified

1. **Building Leaderboard not working well** -- It filters applications by `created_at >= startDate`, so apps created before the current period but contracted/hired during it don't appear. For example, an app created Jan 25 but contracted Feb 6 won't show in the "week" view. The fix: also include applications where `contracted_at` falls within the period, regardless of when they were created.

2. **Dashboard is too sales-focused** -- The admin dashboard shows a "2026 Agency Performance" card (YearPerformanceCard) that duplicates the Agency Production snapshot above it. The user wants **building/recruiting stats** instead: licensed producers hired, total team growth, onboarding pipeline velocity, etc.

---

## Changes

### 1. Fix Building Leaderboard (`src/components/dashboard/BuildingLeaderboard.tsx`)

**Problem:** Line 128 filters `currentQuery.gte("created_at", currentStartDate)` which misses apps created earlier but hired/contracted in the current period.

**Fix:** Change the query to use an OR filter -- include applications where EITHER `created_at >= startDate` OR `contracted_at >= startDate`. This ensures all recruiting activity for the period is captured.

Also fix the previous period query similarly (use `contracted_at` range for growth comparison instead of `created_at`).

### 2. Replace YearPerformanceCard with AgencyGrowthCard (`src/pages/Dashboard.tsx`)

Remove the `YearPerformanceCard` component from the admin dashboard section (lines 316-319).

Replace it with a new **AgencyGrowthCard** component that shows:

- **Licensed Producers** -- Count of active agents where `license_status = 'licensed'`
- **New Hires (period)** -- Agents created/contracted within the selected period (day/week/month toggle)
- **In Onboarding** -- Agents currently in onboarding stages (not yet evaluated)
- **Growth Rate** -- Percentage change in total active agents vs previous period
- **Avg Time to Licensed** -- Average days from agent creation to licensed status (aspirational metric)

The card will have day/week/month toggles matching the existing pattern, with a live indicator and realtime updates.

### 3. Create AgencyGrowthCard Component (`src/components/dashboard/AgencyGrowthCard.tsx`)

New component with the following layout:
- Header: "Agency Growth" with a Building2 icon
- Period selector (day/week/month)
- Stat grid (2x2 or 4-col):
  - Licensed Producers (total active licensed)
  - New Hires This [Period] (agents with `created_at` in range or `contracted_at` in range)
  - In Pipeline (agents in onboarding/training stages)
  - Growth % (change vs previous period)
- Data source: `agents` table + `applications` table with `contracted_at`

---

## Technical Details

### File: `src/components/dashboard/BuildingLeaderboard.tsx`

- Lines 123-131: Change the current period query to use an OR condition: fetch applications where `created_at >= startDate` OR `contracted_at >= startDate`
- Lines 134-140: Similarly fix previous period query to use `contracted_at` range for accurate growth comparison
- The counting logic (lines 159-167) for `status === "approved" || contracted_at` remains correct

### File: `src/components/dashboard/AgencyGrowthCard.tsx` (NEW)

- Queries `agents` table for licensed count, onboarding pipeline counts, and total active count
- Queries `applications` table for new hires (contracted_at within period)
- Subscribes to realtime updates on both tables
- Shows day/week/month toggle for period filtering
- Displays growth percentage comparing current vs previous period

### File: `src/pages/Dashboard.tsx`

- Line 40: Remove `YearPerformanceCard` import
- Lines 316-319: Remove the YearPerformanceCard section
- Add import for new `AgencyGrowthCard`
- Insert AgencyGrowthCard in the same location (after TeamSnapshotCard, before TeamPerformanceBreakdown)
- Show for admin AND manager roles (both benefit from building stats)
