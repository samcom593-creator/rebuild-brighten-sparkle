

## Comprehensive Platform Optimization Plan

### Overview

This plan addresses all the issues raised:
1. **Navigation freezes/delays** - Getting stuck on screens, can't click anything
2. **Team LP Goal** - Change from $75,000 to $400,000
3. **4-Week Production Chart** - Show agency production, not personal
4. **Mass message to agents** - Notify all agents to set their goals and text them to you
5. **Site-wide optimization** - Remove any remaining performance bottlenecks

---

### Issue 1: Navigation Freezes and UI Blocking

**Root Cause Identified:**
There are 11 files with `AnimatePresence mode="wait"` which causes Framer Motion to **block rendering** until exit animations complete. When you click a nav link, if any component is still animating, the app appears frozen.

**Affected Files:**
- `src/components/dashboard/LeaderboardTabs.tsx` (line 499)
- `src/components/dashboard/CompactLeaderboard.tsx` (line 395)
- `src/components/dashboard/CompactProductionEntry.tsx` (lines 220, 342)
- `src/components/dashboard/DeactivateAgentDialog.tsx` (line 258)
- `src/components/dashboard/PerformanceBreakdownModal.tsx` (line 295)
- `src/components/course/CourseQuiz.tsx` (line 165)
- `src/pages/Apply.tsx` (line 438)
- `src/pages/AgentNumbersLogin.tsx` (lines 326, 353)
- `src/components/landing/DealsTicker.tsx` (line 64)
- `src/components/landing/HeroSection.tsx` (line 181)
- `src/components/landing/SystemsSection.tsx` (line 195)

**Fix Strategy:**
1. Replace `mode="wait"` with `mode="sync"` or remove the mode entirely for dashboard components
2. This allows new content to render immediately without waiting for exit animations
3. Keep `mode="wait"` only on multi-step forms (Apply, AgentNumbersLogin) where it's intentional

**Files to Change:**
- `src/components/dashboard/LeaderboardTabs.tsx`
- `src/components/dashboard/CompactLeaderboard.tsx`
- `src/components/dashboard/CompactProductionEntry.tsx`
- `src/components/dashboard/DeactivateAgentDialog.tsx`
- `src/components/dashboard/PerformanceBreakdownModal.tsx`
- `src/components/course/CourseQuiz.tsx`

---

### Issue 2: Team LP Goal Update ($75K → $400K)

**Current Location:** `src/components/dashboard/TeamGoalsTracker.tsx` line 29-34

```typescript
const MONTHLY_TARGETS = {
  alp: 75000, // Currently $75k
  deals: 40,
  presentations: 150,
  referrals: 25,
};
```

**Fix:**
Change `alp: 75000` to `alp: 400000` and proportionally adjust other targets:
- ALP: $400,000 (new target)
- Deals: 200 (scaled from 40 proportionally)
- Presentations: 800 (scaled from 150)
- Referrals: 100 (scaled from 25)

---

### Issue 3: 4-Week Production Chart → Agency-Wide

**Current Behavior:** `ProductionHistoryChart.tsx` takes an `agentId` prop and shows that single agent's production.

**Required Change:** Make it show **agency-wide production** (all agents aggregated) when used by admins.

**Fix Strategy:**
1. Add an optional `showAgencyWide` prop to the component
2. When `showAgencyWide=true`, query ALL production data instead of filtering by `agent_id`
3. Update the Dashboard usage to pass this prop based on user role

**Files to Change:**
- `src/components/dashboard/ProductionHistoryChart.tsx` - Add agency-wide mode
- Where it's used (Dashboard) - Pass the prop accordingly

---

### Issue 4: Send Goal-Setting Notification to All Agents

**Implementation:** Create a new Edge Function `notify-set-goals` that:
1. Fetches all active agents with valid email addresses
2. Sends an email instructing them to:
   - Log into their portal
   - Set their income goals for the month
   - Text their goals to the owner
3. Uses the same Resend email infrastructure as existing functions

**Email Content:**
- Subject: "📊 Action Required: Set Your February Goals"
- Body: Clear instructions to set goals and text the numbers to you
- Include magic link for one-tap portal access

---

### Issue 5: Additional Site Optimization

**A. Query Optimization for TeamSnapshotCard:**
Current issue: Multiple sequential queries for agent IDs, then production data.
Fix: Combine into fewer, more efficient queries.

**B. Real-time Channel Cleanup:**
Ensure `ProductionHistoryChart.tsx` uses the shared `useProductionRealtime` hook instead of creating its own channel (line 68-81 creates a separate channel).

**C. Remove Redundant Re-renders:**
Add `useMemo` and `useCallback` where missing in heavy components.

---

### Implementation Details

#### File 1: LeaderboardTabs.tsx (Remove blocking animations)

```typescript
// Line 499: Change from
<AnimatePresence mode="wait">

// To
<AnimatePresence mode="sync">
```

#### File 2: CompactLeaderboard.tsx

```typescript
// Line 395: Change from
<AnimatePresence mode="wait">

// To
<AnimatePresence mode="sync">
```

#### File 3: CompactProductionEntry.tsx

```typescript
// Lines 220 and 342: Change from
<AnimatePresence mode="wait">

// To
<AnimatePresence mode="sync">
```

#### File 4: TeamGoalsTracker.tsx

```typescript
// Line 29-34: Update targets
const MONTHLY_TARGETS = {
  alp: 400000, // $400k team ALP for February
  deals: 200,  // 200 deals (scaled)
  presentations: 800, // 800 presentations
  referrals: 100, // 100 referrals caught
};
```

#### File 5: ProductionHistoryChart.tsx

Add agency-wide mode:

```typescript
interface ProductionHistoryChartProps {
  agentId?: string;  // Optional now
  weeks?: 4 | 8 | 12;
  showAgencyWide?: boolean;  // NEW prop
}

// In fetchHistory():
if (showAgencyWide) {
  // Fetch ALL production data without agent filter
  const { data: production } = await supabase
    .from("daily_production")
    .select("production_date, aop, deals_closed, closing_rate")
    .gte("production_date", startDate.toISOString().split("T")[0])
    .order("production_date", { ascending: true });
} else {
  // Keep existing single-agent query
}
```

Also use shared realtime hook instead of separate channel.

#### File 6: New Edge Function - notify-set-goals/index.ts

Create at `supabase/functions/notify-set-goals/index.ts`:

```typescript
// Edge function that:
// 1. Gets all active agents with emails
// 2. Generates magic portal links
// 3. Sends email with instructions to:
//    - Set their monthly income goals
//    - Text those goals to [your number]
// 4. Tracks email opens
```

---

### Summary of Changes

| Change | File | Impact |
|--------|------|--------|
| Remove `mode="wait"` blocking | 6 dashboard files | Fixes navigation freezes |
| Update monthly targets | TeamGoalsTracker.tsx | $400K ALP goal |
| Agency-wide production view | ProductionHistoryChart.tsx | Shows team totals |
| Goal notification email | notify-set-goals (NEW) | Mass agent notification |
| Use shared realtime channel | ProductionHistoryChart.tsx | Fewer connections |
| Query optimization | TeamSnapshotCard.tsx | Faster loading |

---

### Expected Results

After implementation:
1. **Navigation** - Instant page transitions, no more getting stuck
2. **Team Goals** - Shows $400,000 target with proportionally scaled sub-goals
3. **4-Week Chart** - Displays agency-wide production aggregated from all agents
4. **Agent Notification** - All active agents receive email with goal-setting instructions
5. **Performance** - Reduced realtime channel count, optimized queries

