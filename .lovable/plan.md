
# Fix Plan: Ensure All Dashboard Numbers Are Live and Active

## Findings

After investigating the codebase, all the core "numbers" files exist:
- `/numbers` page (Numbers.tsx) - Compact login + production entry
- `/apex-daily-numbers` page (LogNumbers.tsx) - Full production logging
- Dashboard components (`TeamSnapshotCard`, `LeaderboardTabs`, `ManagerProductionStats`, etc.)

However, **two critical components are missing real-time subscriptions**:

| Component | Has Real-time? | Issue |
|-----------|---------------|-------|
| TeamSnapshotCard | Yes | Working |
| LeaderboardTabs | Yes | Working |
| ManagerProductionStats | Yes | Working |
| ClosingRateLeaderboard | Yes | Working |
| ReferralLeaderboard | Yes | Working |
| **PersonalStatsCard** | **No** | Not updating live |
| **DashboardCommandCenter** | **No** | Stats not live |

Additionally, **PersonalStatsCard uses local time** instead of PST utilities, causing potential date mismatches.

---

## Changes Required

### 1. Add Real-time Subscription to PersonalStatsCard

**File:** `src/components/dashboard/PersonalStatsCard.tsx`

Add Supabase real-time subscription to refresh stats when production changes:

```tsx
useEffect(() => {
  const channel = supabase
    .channel("personal-stats-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "daily_production" },
      () => fetchStats()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [fetchStats]);
```

Also update date calculations to use PST utilities:
```tsx
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";
import { toZonedTime } from "date-fns-tz";

// In dateRange useMemo:
const now = toZonedTime(new Date(), "America/Los_Angeles");
case "week":
  return { start: getWeekStartPST(), end: getTodayPST() };
case "month":
  return { start: getMonthStartPST(), end: getTodayPST() };
```

### 2. Add Real-time Subscription to DashboardCommandCenter

**File:** `src/pages/DashboardCommandCenter.tsx`

Add real-time subscription to the command center so stats update live:

```tsx
// After the useQuery hook, add:
useEffect(() => {
  const channel = supabase
    .channel("command-center-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "daily_production" },
      () => refetch()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [refetch]);
```

---

## Summary

| File | Change |
|------|--------|
| `src/components/dashboard/PersonalStatsCard.tsx` | Add real-time subscription + use PST date utilities |
| `src/pages/DashboardCommandCenter.tsx` | Add real-time subscription for live stats |

## Result
- All dashboard numbers will update in real-time when production is logged
- Date calculations will be consistent with leaderboard (PST timezone)
- No manual refresh needed - stats sync automatically across the platform
