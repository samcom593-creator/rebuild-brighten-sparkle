

## Fix Dashboard & Agent Portal Issues - Comprehensive Plan

Based on my exploration of the codebase, I've identified multiple interconnected issues affecting the dashboard and agent portal. Here's the complete fix plan:

---

### Issues Identified

| Issue | Root Cause | Location |
|-------|-----------|----------|
| Today's numbers missing in Agent Portal | The "custom" time range toggle shows "All Time" instead of loading actual custom date picker | `AgentPortal.tsx` lines 596-607 |
| Custom date filter not working | `getDateRange("custom")` returns hardcoded 30 days, no actual custom date picker shown | `AgentPortal.tsx` lines 156-161 |
| Day numbers not working in Dashboard | The `TeamSnapshotCard` has real-time subscription but date filter issues persist | `TeamSnapshotCard.tsx` |
| Highest Closing Rates not live | Missing real-time subscription to `daily_production` table updates | `ClosingRateLeaderboard.tsx` - has subscription but no visible updates |
| Top Referral not live | Similar issue - subscription exists but not triggering visual refresh | `ReferralLeaderboard.tsx` |
| Recruit Comp not live | `ManagerLeaderboard.tsx` queries `applications` table - subscription may not be catching updates | `ManagerLeaderboard.tsx` |
| Missing link for daily numbers | No direct "/numbers" link in navigation or Agent Portal | `AgentPortal.tsx` navigation menu |
| Want more options in dashboard | Need additional quick actions and stats visibility | `Dashboard.tsx` |

---

### Implementation Plan

#### 1. Add Quick Link to Daily Numbers Page

**File:** `src/pages/AgentPortal.tsx`

Add a prominent "Log Numbers" link in the navigation menu and header:
- Add to Sheet navigation menu (line 533)
- Add floating action button for mobile users
- Direct link to `/numbers` page

#### 2. Fix Custom Date Range in Agent Portal

**File:** `src/pages/AgentPortal.tsx`

Current issue: "Custom" button doesn't show a date picker - it just uses last 30 days.

Fix:
- Add state for custom date range selection
- Import and use `DateRangePicker` component when "custom" is selected
- Update `getDateRange` to use actual user-selected dates
- Show date picker UI inline when custom is selected

```typescript
// Add state
const [customRange, setCustomRange] = useState<DateRange>({ from: undefined, to: undefined });

// Update getDateRange
case "custom":
  if (customRange.from && customRange.to) {
    return {
      start: format(customRange.from, "yyyy-MM-dd"),
      end: format(customRange.to, "yyyy-MM-dd"),
    };
  }
  // Fallback to last 30 days
  ...
```

#### 3. Ensure "Today" Filter Works Correctly

**Files:** `TeamSnapshotCard.tsx`, `LeaderboardTabs.tsx`

The `useDateRange` hook correctly handles "today" but verify:
- The query uses exact date matching for today
- Production records use correct timezone (UTC vs local)

Add explicit today handling:
```typescript
if (period === "today") {
  const today = format(new Date(), "yyyy-MM-dd");
  query = query.eq("production_date", today);
}
```

#### 4. Make Leaderboards Truly Live

**Files:** `ClosingRateLeaderboard.tsx`, `ReferralLeaderboard.tsx`, `ManagerLeaderboard.tsx`

Issue: Real-time subscriptions exist but may not be triggering visual updates.

Fix:
- Add `key={Date.now()}` refresh trigger on subscription callback
- Force re-render by incrementing a refresh counter
- Add "LIVE" indicator that pulses when data updates

```typescript
const [refreshTrigger, setRefreshTrigger] = useState(0);

// In subscription callback
.on("postgres_changes", { event: "*", ... }, () => {
  setRefreshTrigger(prev => prev + 1);
  fetchLeaderboard();
})
```

#### 5. Add More Dashboard Options

**File:** `src/pages/Dashboard.tsx`

Add new sections/quick actions:
- Direct "Log Numbers" button that links to `/numbers`
- Personal daily stats card (deals today, presentations today)
- Quick links row:
  - Agent Portal
  - Log Numbers
  - My Performance
  - Team Directory (for managers)
- Today's activity feed (recent production entries)

#### 6. Enhance Dashboard with Personal Daily Stats

**File:** `src/pages/Dashboard.tsx` or new component

Add a "Your Today's Numbers" section that shows:
- Personal ALP today
- Personal deals today
- Personal presentations today
- Direct edit button to log/update numbers

#### 7. Add Numbers Link to Sidebar Navigation

**File:** `src/components/layout/GlobalSidebar.tsx`

Add entry for the Numbers page in the main navigation:
```typescript
{
  label: "Log Numbers",
  icon: <Sparkles className="h-4 w-4" />,
  href: "/numbers",
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/AgentPortal.tsx` | Add Numbers link, fix custom date picker, add floating action button |
| `src/components/dashboard/ClosingRateLeaderboard.tsx` | Add refresh trigger, enhance live indicator |
| `src/components/dashboard/ReferralLeaderboard.tsx` | Add refresh trigger, enhance live indicator |
| `src/components/dashboard/ManagerLeaderboard.tsx` | Add subscription to agents table, enhance live indicator |
| `src/pages/Dashboard.tsx` | Add quick actions row, personal today stats, Numbers link |
| `src/components/layout/GlobalSidebar.tsx` | Add Numbers link |
| `src/components/dashboard/TeamSnapshotCard.tsx` | Verify today filter correctness |

---

### Technical Details

**Custom Date Picker Fix (Agent Portal):**

```typescript
// State additions
const [customRange, setCustomRange] = useState<DateRange>({ from: undefined, to: undefined });

// In JSX, after time range buttons
{statsTimeRange === "custom" && (
  <DateRangePicker
    value={customRange}
    onChange={setCustomRange}
    simpleMode
  />
)}
```

**Live Leaderboard Enhancement:**

```typescript
// Add visible update indicator
const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

// In subscription
.on("postgres_changes", ..., () => {
  setLastUpdated(new Date());
  fetchLeaderboard();
})

// In JSX
<span className="text-[10px] text-emerald-500 animate-pulse">
  Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
</span>
```

**Quick Actions Row (Dashboard):**

```typescript
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
  <Link to="/numbers">
    <GlassCard className="p-4 hover:border-primary/50 cursor-pointer">
      <Sparkles className="h-5 w-5 text-primary mb-2" />
      <p className="font-semibold text-sm">Log Numbers</p>
    </GlassCard>
  </Link>
  <Link to="/agent-portal">
    <GlassCard className="p-4 hover:border-primary/50 cursor-pointer">
      <BarChart3 className="h-5 w-5 text-violet-500 mb-2" />
      <p className="font-semibold text-sm">Agent Portal</p>
    </GlassCard>
  </Link>
  // ...more quick actions
</div>
```

---

### Expected Results

After implementation:
- "Today" filter correctly shows only today's production data
- Custom date range picker appears when selecting "Custom Dates"
- Direct link to `/numbers` page from dashboard and sidebar
- Leaderboards visually update in real-time with pulse indicators
- ManagerLeaderboard (recruit comp) updates live when applications change
- Dashboard has quick action buttons for common tasks
- Personal daily stats visible at a glance

