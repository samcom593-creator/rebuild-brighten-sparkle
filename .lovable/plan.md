

# Simplify Production Entry Fields + Update Closing Rate Thresholds

## Changes

### 1. Remove "Booked In-Home" field from both production entry components

**CompactProductionEntry.tsx** (used on /numbers page):
- Remove `booked_inhome_referrals` from the `statFields` array (line 239)
- Keep it in `formData` state as `0` so the upsert doesn't break, but don't show it in the UI
- Final fields shown: Presentations, Pitched Price, Hours Called, Referrals, Ref. Pres. (5 fields in a 2-column grid)

**ProductionEntry.tsx** (used on Agent Portal / Dashboard):
- Remove `booked_inhome_referrals` from the `activityFields` array (line 368)
- Keep it in `formData` state as `0` for database compatibility
- Final fields shown: Presentations, Pitched Price, Hours Called, Referrals Caught, Referral Pres. (5 fields in 2-col / 3-col grid)

### 2. Update closing rate color thresholds

**`src/lib/closingRateColors.ts`**:
- Change thresholds from `<40 red, 40-55 yellow, >55 green` to:
  - 0-40 = Red (unchanged)
  - 40-60 = Yellow (was 40-55)
  - 60-100 = Green (was >55)
- Update the boundary check from `rate <= 55` to `rate < 60`

This single file change automatically updates all 7 components that use `getClosingRateColor`: LiveLeaderboard, ClosingRateLeaderboard, PersonalStatsCard, TeamPerformanceBreakdown, YearPerformanceCard, DashboardCommandCenter.

### 3. Verify deal entry flow is intact

The CompactProductionEntry already loads existing data on mount (added in prior fix). The BubbleDealEntry handles deal input with the ultra-simple type-first interface. No changes needed here -- the prior fix addressed the "zeros" bug.

## Files to Modify
- `src/components/dashboard/CompactProductionEntry.tsx` -- remove 1 stat field
- `src/components/dashboard/ProductionEntry.tsx` -- remove 1 stat field
- `src/lib/closingRateColors.ts` -- update yellow/green threshold from 55 to 60

