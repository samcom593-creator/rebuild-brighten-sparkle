
# Dashboard Enhancement: Perfect Team Overview

## Understanding Your Request

You want the **Dashboard** (separate from Command Center) to provide a balanced, comprehensive view of your team that combines:
1. **Team Production** - Sales metrics (ALP, deals, close rates)
2. **Team Growth** - Recruitment and onboarding pipeline
3. **Overall Team Overview** - Aggregated stats and team member status

The Command Center is for admin-only deep control. The Dashboard should be your daily "pulse check" on your entire team.

---

## Current Dashboard Issues

| Section | Current State | Problem |
|---------|---------------|---------|
| Sales Performance | Shows YOUR leads/contacted/closed | Only personal CRM stats, not production metrics |
| DownlineStatsCard | Shows team ALP/Deals | Only this week, no toggle |
| Growth Section | Shows YOUR licensed/unlicensed leads | Not actual recruiting pipeline |
| ManagerTeamView | Shows team members | Lacks production integration |
| Team Goals | Shows monthly targets | Good, but buried at bottom |

**Core Issue**: The Dashboard mixes personal CRM lead stats with team production, creating confusion. It doesn't give you a clear "team production vs team growth" snapshot.

---

## Proposed Dashboard Redesign

### New Layout Structure

```text
+----------------------------------------------------------+
|  DASHBOARD                                                |
|----------------------------------------------------------|
|                                                           |
|  [TEAM SNAPSHOT - Hero Section]                          |
|  +-------------------------------------------------------+
|  | Week/Month Toggle     [Total ALP] [Deals] [Agents]    |
|  | $182K   |   105   |   15 active                       |
|  +-------------------------------------------------------+
|                                                           |
|  [TWO-COLUMN LAYOUT]                                     |
|  +------------------------+  +-------------------------+ |
|  | PRODUCTION METRICS     |  | GROWTH METRICS          | |
|  | - LeaderboardTabs      |  | - ManagerLeaderboard    | |
|  | - ClosingRate LB       |  | - Onboarding Pipeline   | |
|  | - Referral LB          |  | - Licensed vs Unlicensed| |
|  +------------------------+  +-------------------------+ |
|                                                           |
|  [TEAM GOALS TRACKER - Full Width]                       |
|  Progress toward monthly ALP, Deals, Presentations goals |
|                                                           |
|  [YOUR TEAM - Expandable Cards]                          |
|  Each agent: Name | Week ALP | Month ALP | Stage         |
|                                                           |
+----------------------------------------------------------+
```

---

## Implementation Details

### 1. New Team Snapshot Hero Card

**File**: `src/components/dashboard/TeamSnapshotCard.tsx` (NEW)

A prominent hero section at the top showing:
- Time toggle (Week / Month / All)
- Total Team ALP
- Total Deals Closed
- Active Agent Count
- Average Close Rate

This replaces the current personal stats row for managers/admins.

### 2. Split Layout: Production vs Growth

**Modify**: `src/pages/Dashboard.tsx`

Create a clear two-column split:

**LEFT COLUMN - Production (Sales)**:
- LeaderboardTabs (already exists)
- ClosingRateLeaderboard (already exists)
- ReferralLeaderboard (already exists)

**RIGHT COLUMN - Growth (Recruiting)**:
- ManagerLeaderboard (already exists)
- New: Onboarding Pipeline Summary
- New: Licensed vs Unlicensed breakdown

### 3. Enhanced DownlineStatsCard

**Modify**: `src/components/dashboard/DownlineStatsCard.tsx`

Add a time toggle (Week / Month / All) so you can see:
- This Week's production
- This Month's production
- All-Time production

### 4. Onboarding Pipeline Widget

**File**: `src/components/dashboard/OnboardingPipelineCard.tsx` (NEW)

Show a mini version of the CRM pipeline stages:
- Onboarding: X agents
- Training Online: X agents
- In-Field Training: X agents
- Evaluated: X agents

### 5. Team Goals Tracker Promotion

Move `TeamGoalsTracker` higher in the layout (after the snapshot) so monthly goals are immediately visible.

### 6. Enhanced ManagerTeamView

**Modify**: `src/components/dashboard/ManagerTeamView.tsx`

Add production columns to each team member row:
- Week ALP
- Month ALP
- Deals This Month
- Onboarding Stage badge

---

## Technical Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/dashboard/TeamSnapshotCard.tsx` | Hero stats with time toggle |
| `src/components/dashboard/OnboardingPipelineCard.tsx` | Stage summary widget |

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/Dashboard.tsx` | New layout structure with Production/Growth split |
| `src/components/dashboard/DownlineStatsCard.tsx` | Add Week/Month/All toggle |
| `src/components/dashboard/ManagerTeamView.tsx` | Add ALP columns per agent |

---

## Dashboard Data Flow

```text
Dashboard.tsx
    │
    ├── TeamSnapshotCard (NEW)
    │   └── Fetches all agent production for time period
    │
    ├── [Production Column]
    │   ├── LeaderboardTabs (existing)
    │   ├── ClosingRateLeaderboard (existing)
    │   └── ReferralLeaderboard (existing)
    │
    ├── [Growth Column]
    │   ├── ManagerLeaderboard (existing)
    │   ├── OnboardingPipelineCard (NEW)
    │   └── Licensed/Unlicensed pie chart (existing)
    │
    ├── TeamGoalsTracker (existing, moved up)
    │
    └── ManagerTeamView (enhanced with ALP)
```

---

## Visual Hierarchy

1. **Hero** - Team Snapshot (production + growth combined quick stats)
2. **Side-by-Side** - Production leaderboards | Growth leaderboards
3. **Full Width** - Team Goals progress bars
4. **Full Width** - Team members list with production data

---

## Key Queries

### Team Snapshot Query
```sql
SELECT 
  SUM(aop) as total_alp,
  SUM(deals_closed) as total_deals,
  COUNT(DISTINCT agent_id) as active_agents
FROM daily_production
WHERE production_date >= [start] AND production_date <= [end]
  AND agent_id IN (
    SELECT id FROM agents 
    WHERE invited_by_manager_id = [current_user_agent_id]
      OR (is_admin AND is_deactivated = false)
  )
```

### Onboarding Pipeline Query
```sql
SELECT onboarding_stage, COUNT(*) as count
FROM agents
WHERE invited_by_manager_id = [current_user_agent_id]
  AND is_deactivated = false
GROUP BY onboarding_stage
```

---

## Outcome

After this enhancement, the Dashboard will show:

- **At a Glance**: Total team ALP, deals, and agent count with time toggle
- **Production Side**: Who's selling, close rates, referrals caught
- **Growth Side**: Who's recruiting, pipeline stages, license status
- **Goals**: Monthly targets and progress
- **Team Roster**: Each agent with their production numbers

This gives you the "perfect mixture" of production, growth, and team overview in one cohesive view.
