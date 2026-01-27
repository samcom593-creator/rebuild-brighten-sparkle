
# Leaderboard Visibility, Rank Notifications & Personal Ranking Graph

## Issues Identified

### 1. Visibility Problem (RLS Issue)
**Current State**: The `daily_production` table RLS policy restricts regular agents to only see their own data:
```sql
Agents can view their own production: (agent_id = current_agent_id()) OR (admin/manager check)
```

**Impact**: Regular agents can't see each other on the leaderboard - they only see themselves!

**Solution**: Add a new RLS policy allowing all authenticated agents to view basic production data for leaderboard purposes.

### 2. Missing Rank-Passed Notifications
**Current State**: The `notify-rank-passed` edge function exists and is well-implemented, but it's **never being called** when production is submitted. The `ProductionEntry.tsx` calls `notify-deal-alert` and `notify-streak-alert` but not `notify-rank-passed`.

**Solution**: Add a call to `notify-rank-passed` when production is saved.

### 3. Personal Ranking Visualization
**Current State**: No visual chart showing where an agent ranks compared to everyone else.

**Solution**: Create a "My Rank" button that opens a popup/drawer with:
- A horizontal bar chart showing all agents' ALP
- The current user highlighted with a special color
- Visual indicators for where they rank (top 10%, bottom 25%, etc.)

---

## Technical Implementation

### Database Change: New RLS Policy

Add a new SELECT policy on `daily_production`:

```sql
CREATE POLICY "Authenticated agents can view all production for leaderboard"
ON public.daily_production
FOR SELECT
USING (auth.uid() IS NOT NULL);
```

This allows any authenticated user to view production data for leaderboard purposes.

### File 1: `src/components/dashboard/ProductionEntry.tsx`

Add the rank-passed notification after saving production (around line 298):

```tsx
// After the streak alert call, add:

// 📊 Check if we passed anyone on the leaderboard
try {
  await supabase.functions.invoke("notify-rank-passed", {
    body: {
      submittingAgentId: selectedAgentId,
      productionDate: today,
    },
  });
} catch (rankError) {
  console.error("Failed to check rank changes:", rankError);
}

// Also trigger comeback alert for big moves
await supabase.functions.invoke("notify-comeback-alert", {
  body: {
    agentId: selectedAgentId,
    agentName: selectedAgentName,
    previousRank: 0, // Will be calculated in the function
    newRank: 0,
  },
});
```

### File 2: `src/components/dashboard/CompactProductionEntry.tsx`

Same change - add rank notifications after production save.

### File 3: New Component - `src/components/dashboard/MyRankingChart.tsx`

Create a popup component that shows a visual ranking chart:

```tsx
// Key features:
// - Button that says "📊 My Rank" with a subtle bounce animation
// - Opens a Drawer/Sheet when clicked
// - Shows a horizontal bar chart with all agents
// - Current user's bar is highlighted in primary color
// - Shows percentile position (e.g., "Top 15%")
// - Shows gap to next rank and gap to #1
```

**Visual Design:**
```
┌─────────────────────────────────────────────────────────┐
│  📊 Where You Stand                            [Close X] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  You are #4 out of 12 agents (Top 33%)                 │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 1. Samuel ██████████████████████████████ $8,500  │   │
│  │ 2. KJ     ████████████████████████████ $7,200    │   │
│  │ 3. OB     ████████████████████████ $5,800        │   │
│  │ 4. YOU ⭐  █████████████████████ $4,300          │   │ (highlighted)
│  │ 5. Lisa   ███████████████████ $3,900             │   │
│  │ 6. Mike   █████████████████ $3,400               │   │
│  │ ...                                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  📈 $1,500 to overtake OB (#3)                         │
│  🏆 $4,200 to reach #1                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### File 4: `src/components/dashboard/LeaderboardTabs.tsx`

Add the "My Rank" button in the leaderboard header (around line 378):

```tsx
// Add a "My Rank" button next to the sort/filter controls
<Button
  variant="outline"
  size="sm"
  onClick={() => setShowRankingChart(true)}
  className="gap-1 text-xs border-primary/30 hover:bg-primary/10"
>
  <BarChart3 className="h-3.5 w-3.5" />
  My Rank
</Button>

// Add drawer for the chart
<MyRankingDrawer 
  open={showRankingChart}
  onOpenChange={setShowRankingChart}
  currentAgentId={currentAgentId}
  entries={entries}
/>
```

---

## Summary of Changes

| File | Change |
|------|--------|
| **Database Migration** | Add RLS policy allowing all authenticated users to view `daily_production` |
| `ProductionEntry.tsx` | Add `notify-rank-passed` and `notify-comeback-alert` calls |
| `CompactProductionEntry.tsx` | Add same rank notification calls |
| `MyRankingChart.tsx` | **New** - Visual ranking drawer/popup component |
| `LeaderboardTabs.tsx` | Add "My Rank" button that opens the ranking chart |

---

## User Experience After Changes

1. **All Agents See Each Other**: Every agent can now see everyone on the leaderboard, creating true competition

2. **Rank Notifications**: When you submit your numbers and pass someone:
   - The person you passed gets an email: "🏃 [You] just passed you on the leaderboard!"
   - If you jump from outside top 5 into top 3, the whole team gets a "⚡ COMEBACK ALERT!"

3. **Visual Ranking**: Tap "My Rank" button to see:
   - A bar chart of everyone's ALP
   - Your position highlighted
   - How much you need to overtake the next person
   - How much you need to reach #1
