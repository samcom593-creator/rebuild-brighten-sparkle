

# Polish: Fix Infinite Animation + Ensure Dashboard Flows Are Smooth

## Current State

All previously planned features are already implemented and live:

- **TotalApplicationsBanner** -- animated counter, gradient GlassCard, today/this-week badges, whoosh sound -- placed after welcome message on Dashboard
- **ActivationRiskBanner** -- has Inactive + Reactivate + Settings + Dismiss buttons with sound effects
- **QuickFilters** -- has Producers, Needs Attention, Zero Production, Inactive, All
- **DashboardCommandCenter** -- inactive filter logic, sound effects on filter changes and agent actions
- **DashboardCRM** -- LicenseProgressSelector integrated on agent cards, onboarding stage management, attendance, evaluation, bulk actions
- **Dashboard.tsx** -- useSoundEffects on quick action clicks

## Issue Found: Prohibited Infinite Animation

The `TotalApplicationsBanner` (line 92-98) has a `repeat: Infinity` animation on the fire emoji. This violates the platform standard that prohibits decorative infinite animations to prevent browser lag and battery drain.

## Changes Needed

### 1. Fix Infinite Animation in TotalApplicationsBanner

**File: `src/components/dashboard/TotalApplicationsBanner.tsx`** (lines 92-98)

Replace the infinite pulsing fire emoji with a single-play entrance animation that settles into a static state. The emoji will scale up once on mount, then stay still.

### 2. Add Locale Formatting to AnimatedNumber Counter

The `AnimatedNumber` component currently shows raw numbers (e.g., `1023`). For the FOMO banner to look polished with 1,000+ applications, the display should use `toLocaleString()` formatting so it renders as `1,023`.

**File: `src/components/dashboard/AnimatedNumber.tsx`** (line 46)

Change `current.toFixed(decimals)` to use locale formatting when decimals is 0.

### 3. Verify No Other Issues

All dashboards already have:
- CRM: LicenseProgressSelector for updating pre-licensing course stages (unlicensed > course purchased > finished course > test scheduled > passed test > fingerprints > waiting on license > licensed)
- CRM: Onboarding stage management (onboarding, training_online, in_field_training, evaluated)
- CRM: Attendance, ratings, evaluation buttons, notes, bulk stage actions
- Command Center: Filter by producers/needs attention/zero/inactive/all, reassign managers, change stages, promote/demote, reactivate
- Dashboard: Team snapshot, activation risk banner, agency growth, performance breakdown, leaderboards

No additional code changes are required beyond the two fixes above.

---

## Technical Details

| File | Change |
|------|--------|
| `src/components/dashboard/TotalApplicationsBanner.tsx` | Replace `repeat: Infinity` animation with single-play scale entrance |
| `src/components/dashboard/AnimatedNumber.tsx` | Add `toLocaleString()` formatting for whole numbers |

Both changes are two-line edits. No database changes, no new components, no edge functions.

