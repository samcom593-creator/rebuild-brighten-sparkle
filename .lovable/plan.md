
# Comprehensive Platform Performance & Accuracy Fix Plan

## Issues Identified

Based on my thorough code audit and console log analysis, I've identified the following critical issues:

### 1. **Maximum Update Depth Warning (Infinite Loop)**
**File:** `src/components/dashboard/AnimatedNumber.tsx`
**Issue:** The `AnimatedNumber` component is causing React's maximum update depth warning because of how the framer-motion `display.on("change")` subscription is setting state on every animation frame.
**Impact:** UI jank, potential freezing, performance degradation

### 2. **Timezone Issue - "Today" Uses UTC Not PST**
**Files:** Multiple leaderboard components
**Issue:** Using `new Date().toISOString().split("T")[0]` converts to UTC which is 7-8 hours ahead of PST. At 8 PM PST, the system thinks it's already the next day in UTC.
**Impact:** "Today" numbers show wrong data after ~5 PM PST, data rolls over at wrong time

### 3. **Leaderboard Tab Switching Delay**
**File:** `src/components/dashboard/LeaderboardTabs.tsx`
**Issue:** Each period change triggers a full database fetch before rendering. Missing loading state optimization.
**Impact:** Visible delay when switching between Day/Week/Month tabs

### 4. **Closing Rate & Referral Leaderboards Fetching on Every Render**
**Files:** `ClosingRateLeaderboard.tsx`, `ReferralLeaderboard.tsx`
**Issue:** `resetTracking` function in useEffect dependency array is recreated on each render, causing infinite re-fetches
**Impact:** Excessive database calls, slow performance

### 5. **ProductionEntry Select Component Ref Warning**
**File:** `src/components/dashboard/ProductionEntry.tsx`
**Issue:** Console warning about function components not accepting refs in the Select component
**Impact:** Non-functional but creates console noise

### 6. **BuildingLeaderboard Not Using PST Timezone**
**File:** `src/components/dashboard/BuildingLeaderboard.tsx`
**Issue:** Same UTC vs PST issue as main leaderboard
**Impact:** Recruiting stats show wrong "today" data

---

## Detailed Fix Plan

### Fix 1: Replace AnimatedNumber with Stable AnimatedCounter

**Problem:** `AnimatedNumber.tsx` uses framer-motion subscriptions that trigger setState on every frame, causing the infinite loop warning.

**Solution:** The codebase already has a better implementation in `AnimatedCounter.tsx` using `useAnimatedCounter` hook. Replace all uses of `AnimatedNumber` with `AnimatedCounter`.

**Files to modify:**
- Find and replace all imports of `AnimatedNumber` with `AnimatedCounter`
- Or fix `AnimatedNumber.tsx` by removing the problematic `display.on("change")` subscription

**Code change for AnimatedNumber.tsx:**
```typescript
// Remove lines 51-56 (the problematic subscription)
// Change line 67 to use the display value directly from useTransform
```

---

### Fix 2: Create PST Date Utility for Consistent Timezone Handling

**Problem:** JavaScript `new Date()` uses local time, but `.toISOString()` converts to UTC. This causes "today" to be wrong after ~5 PM PST.

**Solution:** Create a utility function that always returns dates in PST/PDT timezone.

**New file:** `src/lib/dateUtils.ts`

```typescript
import { format } from "date-fns";
import { toZonedTime, format as tzFormat } from "date-fns-tz";

const PST_TIMEZONE = "America/Los_Angeles";

/**
 * Get today's date in PST timezone as YYYY-MM-DD string
 */
export function getTodayPST(): string {
  const now = new Date();
  const pstDate = toZonedTime(now, PST_TIMEZONE);
  return format(pstDate, "yyyy-MM-dd");
}

/**
 * Get a date N days ago in PST timezone
 */
export function getDatePST(daysAgo: number = 0): string {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  const pstDate = toZonedTime(now, PST_TIMEZONE);
  return format(pstDate, "yyyy-MM-dd");
}
```

**Note:** We'll need to add `date-fns-tz` package for timezone support.

**Files to update:**
- `src/components/dashboard/LeaderboardTabs.tsx`
- `src/components/dashboard/ClosingRateLeaderboard.tsx`
- `src/components/dashboard/ReferralLeaderboard.tsx`
- `src/components/dashboard/BuildingLeaderboard.tsx`
- `src/hooks/useRankChange.ts`
- All edge functions that use `new Date().toISOString().split("T")[0]`

---

### Fix 3: Optimize Leaderboard Tab Switching with Caching

**Problem:** Every period change triggers full refetch, causing visible delay.

**Solution:** 
1. Keep previous data visible while loading new data
2. Use `useMemo` to prevent unnecessary re-renders
3. Remove `resetTracking` from useEffect dependency array (it's stable via useCallback but triggers re-renders)

**File:** `src/components/dashboard/LeaderboardTabs.tsx`

```typescript
// Line 83-99: Remove resetTracking from dependencies
useEffect(() => {
  fetchLeaderboard();
  
  const channel = supabase
    .channel("leaderboard-changes")
    .on(...)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [period, customDateRange, currentAgentId]); // Remove resetTracking
```

---

### Fix 4: Fix Infinite Re-fetch in Celebration Hooks

**Problem:** `resetTracking` is in the dependency array of useEffect, causing re-fetches.

**Files:** `ClosingRateLeaderboard.tsx`, `ReferralLeaderboard.tsx`

```typescript
// Remove resetTracking from useEffect dependency
useEffect(() => {
  // Call resetTracking once at mount
  resetTracking();
  fetchLeaderboard();
  // ... subscription code
}, [period, currentAgentId]); // Remove resetTracking from here
```

---

### Fix 5: Fix Select Ref Warning in ProductionEntry

**Problem:** Radix Select component doesn't support refs on the root component.

**File:** `src/components/dashboard/ProductionEntry.tsx`

The warning is coming from somewhere passing a ref to the Select. This is likely from the parent component or a tooltip wrapper. Need to wrap Select with forwardRef if needed or remove the ref.

---

### Fix 6: Ensure Real-time Updates Are Instant

**Problem:** Real-time subscriptions are set up but there may be rendering delays.

**Solution:** Ensure loading states don't flash and data updates smoothly:

```typescript
// In fetchLeaderboard, only setLoading(true) on initial load
const fetchLeaderboard = async (isInitialLoad = false) => {
  if (isInitialLoad) setLoading(true);
  // ... fetch logic
  setLoading(false);
};

// In subscription callback:
.on("postgres_changes", ..., () => fetchLeaderboard(false))
```

---

## Implementation Order

1. **Create date utility** (`src/lib/dateUtils.ts`) - Foundation for all date fixes
2. **Install date-fns-tz** - Required dependency
3. **Fix AnimatedNumber** - Stop infinite loop warning
4. **Update LeaderboardTabs** - PST dates + remove resetTracking dependency
5. **Update ClosingRateLeaderboard** - PST dates + fix dependencies
6. **Update ReferralLeaderboard** - PST dates + fix dependencies
7. **Update BuildingLeaderboard** - PST dates
8. **Update useRankChange** - PST dates for yesterday calculation
9. **Update edge functions** - Consistent PST handling server-side

---

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `date-fns-tz` dependency |
| `src/lib/dateUtils.ts` | NEW - PST date utilities |
| `src/components/dashboard/AnimatedNumber.tsx` | Fix infinite loop |
| `src/components/dashboard/LeaderboardTabs.tsx` | PST dates, optimize deps |
| `src/components/dashboard/ClosingRateLeaderboard.tsx` | PST dates, fix deps |
| `src/components/dashboard/ReferralLeaderboard.tsx` | PST dates, fix deps |
| `src/components/dashboard/BuildingLeaderboard.tsx` | PST dates |
| `src/hooks/useRankChange.ts` | PST dates |
| Edge functions (multiple) | Consistent timezone handling |

---

## Expected Outcomes

After implementing these fixes:

1. **No more console warnings** - AnimatedNumber loop fixed
2. **"Today" is accurate until 12 AM PST** - All components use PST
3. **Zero delay on tab switches** - Optimized loading states
4. **Real-time updates are instant** - No unnecessary refetches
5. **All leaderboards stay live** - Proper subscription handling
6. **Password login works** - (Already fixed in previous session)
7. **Recruit comparison accurate** - BuildingLeaderboard uses PST

---

## Testing Checklist

After implementation:
- [ ] Login with email/password works
- [ ] "Today" leaderboard shows today's numbers at 8 PM PST
- [ ] Switching Day/Week/Month has no visible delay
- [ ] No console warnings about maximum update depth
- [ ] Closing Rate leaderboard updates live
- [ ] Referral leaderboard updates live
- [ ] Building/Recruit comparison shows accurate data
- [ ] Production entry saves and leaderboard updates immediately
