

# Fix Dashboard Numbers to Match Leaderboard

## Problem

Dashboard numbers (Total ALP, Week ALP, Deals, etc.) are not matching the Leaderboard because the components use **different date calculation methods**:

| Component | Date Calculation | Issue |
|-----------|------------------|-------|
| **LeaderboardTabs** | Uses PST utilities (`getWeekStartPST()`, `getTodayPST()`) | Correct - PST timezone |
| **TeamSnapshotCard** | Uses `useDateRange` hook with `startOfWeek(new Date())` | Uses **local system time**, not PST |
| **ManagerProductionStats** | Uses `getDateDaysAgoPST(7)` for "week" | Uses "7 days ago" instead of **week start (Sunday)** |

This causes data mismatch when:
1. User is in a different timezone than PST
2. "Week" is interpreted as "last 7 days" vs "Sunday to Saturday"

Additionally, `ManagerProductionStats` has **no real-time subscription** so it doesn't update live.

---

## Solution

Align all dashboard components to use the same PST-based date utilities that the leaderboard uses.

### Files to Modify

#### 1. `src/components/ui/date-range-picker.tsx` (useDateRange hook)

**Problem:** Uses `new Date()` and `startOfWeek()` from date-fns with local time.

**Fix:** Import and use PST utilities for date calculations:

```tsx
import { getNowPST, getTodayPST, getWeekStartPST, getMonthStartPST, getDateDaysAgoPST } from "@/lib/dateUtils";
import { format, endOfWeek, endOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";

// In useDateRange hook:
export function useDateRange(initialPeriod: DateRangePeriod = "week") {
  const today = getNowPST(); // PST time instead of local
  
  const getInitialRange = (): DateRange => {
    switch (initialPeriod) {
      case "today":
        return { from: today, to: today };
      case "week":
        return {
          from: toZonedTime(new Date(getWeekStartPST()), "America/Los_Angeles"),
          to: endOfWeek(today, { weekStartsOn: 0 }),
        };
      case "month":
        return {
          from: toZonedTime(new Date(getMonthStartPST()), "America/Los_Angeles"),
          to: endOfMonth(today),
        };
      default:
        return { from: subDays(today, 30), to: today };
    }
  };
  // ...
}
```

Also update `handlePresetClick` to use PST times for consistency.

#### 2. `src/components/dashboard/ManagerProductionStats.tsx`

**Problem:** 
- Uses `getDateDaysAgoPST(7)` for week which is "7 days ago", not "start of week"
- No real-time subscription for live updates

**Fix:**
```tsx
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";

// Change from:
const weekStart = getDateDaysAgoPST(7);
const monthStart = getDateDaysAgoPST(30);

// To:
const weekStart = getWeekStartPST();
const monthStart = getMonthStartPST();

// Add real-time subscription:
useEffect(() => {
  const channel = supabase
    .channel("manager-production-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "daily_production" },
      () => fetchTeamStats()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [managerId]);
```

#### 3. `src/lib/dateUtils.ts` - Add missing utility

Add `getWeekEndPST()` helper for consistency:

```tsx
/**
 * Get the end of current week in PST (Saturday end) as YYYY-MM-DD string
 */
export function getWeekEndPST(): string {
  const pstNow = getNowPST();
  return format(endOfWeek(pstNow, { weekStartsOn: 0 }), "yyyy-MM-dd");
}

/**
 * Get the end of current month in PST as YYYY-MM-DD string
 */
export function getMonthEndPST(): string {
  const pstNow = getNowPST();
  return format(endOfMonth(pstNow), "yyyy-MM-dd");
}
```

---

## Summary

| File | Change |
|------|--------|
| `src/lib/dateUtils.ts` | Add `getWeekEndPST()` and `getMonthEndPST()` utilities |
| `src/components/ui/date-range-picker.tsx` | Update `useDateRange` hook to use PST utilities |
| `src/components/dashboard/ManagerProductionStats.tsx` | Use `getWeekStartPST()` instead of `getDateDaysAgoPST(7)`, add real-time subscription |

---

## Result

- Dashboard "Total ALP", "Deals", "Week ALP" will match Leaderboard exactly
- All components use consistent PST timezone and "Sunday-Saturday" week definition
- ManagerProductionStats updates in real-time when production is logged

