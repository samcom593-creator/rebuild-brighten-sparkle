
# Agent Portal Enhancements: Navigation, Dual Leaderboard & Manager Team Stats

## Overview

This plan addresses three key enhancements:
1. **Dashboard Access from Agent Portal** - Add navigation to access the main dashboard/sidebar
2. **Dual Leaderboard with Flip Animation** - Add a "Production" / "Building" toggle with a flip animation to show both sales and recruiting leaderboards
3. **Manager/Admin Team Stats** - Show aggregated team totals instead of personal stats for managers and admins

---

## Feature 1: Dashboard Access from Agent Portal

### Current Problem
When on the Agent Portal (`/agent-portal`), users are "locked in" and can't access the main dashboard sidebar navigation.

### Solution
Add a menu button in the Agent Portal header that opens a slide-out navigation drawer (or links to the dashboard).

### Technical Changes

**File: `src/pages/AgentPortal.tsx`**

Add a menu button and navigation options in the header:

```tsx
// Add imports
import { Menu, LayoutDashboard, Settings, Users } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

// In the header section (around line 281), add a menu button:
<div className="flex items-center gap-2">
  {/* New Dashboard Access Menu */}
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="ghost" size="icon">
        <Menu className="h-4 w-4" />
      </Button>
    </SheetTrigger>
    <SheetContent side="left" className="w-64">
      <nav className="space-y-2 mt-8">
        <Link to="/dashboard" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted">
          <LayoutDashboard className="h-5 w-5" />
          <span>Dashboard</span>
        </Link>
        <Link to="/dashboard/team" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted">
          <Users className="h-5 w-5" />
          <span>My Team</span>
        </Link>
        <Link to="/dashboard/settings" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted">
          <Settings className="h-5 w-5" />
          <span>Settings</span>
        </Link>
      </nav>
    </SheetContent>
  </Sheet>
  
  <ThemeToggle />
  <Button variant="ghost" size="icon" onClick={handleLogout}>
    <LogOut className="h-4 w-4" />
  </Button>
</div>
```

---

## Feature 2: Dual Leaderboard with Flip Animation

### Current Design
The leaderboard shows only production (sales) data - ALP, deals, presentations, etc.

### New Design
Add a gold/black toggle button that:
- Says "Production" by default (gold gradient, subtle bounce animation on hover)
- When clicked, the leaderboard "flips" to show "Building" (recruiting) data
- Building leaderboard shows: applicants, referrals, people in course, response time

### Technical Changes

**File: `src/components/dashboard/LeaderboardTabs.tsx`**

1. Add state for the leaderboard mode:
```tsx
const [leaderboardMode, setLeaderboardMode] = useState<"production" | "building">("production");
```

2. Add the flip toggle button in the header:
```tsx
// After the Trophy icon and "Leaderboard" text, add the toggle button:
<motion.button
  onClick={() => setLeaderboardMode(mode => mode === "production" ? "building" : "production")}
  className={cn(
    "relative px-4 py-1.5 rounded-full text-xs font-bold transition-all",
    "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600",
    "text-black shadow-lg shadow-amber-500/20",
    "hover:shadow-amber-500/40 hover:scale-105",
    "border border-amber-300/50"
  )}
  whileHover={{ 
    y: [0, -3, 0],
    transition: { repeat: Infinity, duration: 0.6 }
  }}
  whileTap={{ scale: 0.95 }}
>
  <motion.span
    key={leaderboardMode}
    initial={{ rotateY: 90, opacity: 0 }}
    animate={{ rotateY: 0, opacity: 1 }}
    exit={{ rotateY: -90, opacity: 0 }}
    transition={{ duration: 0.3 }}
  >
    {leaderboardMode === "production" ? "Production" : "Building"}
  </motion.span>
</motion.button>
```

3. Create a new `BuildingLeaderboard` component or section that shows recruiting metrics:

**New File: `src/components/dashboard/BuildingLeaderboard.tsx`**

```tsx
// Key metrics to display:
// - Total applicants recruited
// - Referrals caught
// - People currently in course (onboarding_stage = 'onboarding')
// - Licensed recruits
// - Closed recruits

interface BuildingEntry {
  rank: number;
  agentId: string;
  name: string;
  totalApplicants: number;
  referrals: number;
  inCourse: number;
  licensed: number;
  isCurrentUser: boolean;
}

// Fetch logic:
// 1. Get all managers (from user_roles with role = 'manager')
// 2. Count applications per assigned_agent_id
// 3. Count agents per invited_by_manager_id with onboarding_stage != 'evaluated' (in course)
// 4. Show all this in a similar grid layout to the production leaderboard
```

4. Conditionally render based on `leaderboardMode`:
```tsx
<AnimatePresence mode="wait">
  {leaderboardMode === "production" ? (
    <motion.div
      key="production"
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      exit={{ rotateY: -90, opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Existing production leaderboard rows */}
    </motion.div>
  ) : (
    <motion.div
      key="building"
      initial={{ rotateY: -90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      exit={{ rotateY: 90, opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <BuildingLeaderboard currentAgentId={currentAgentId} period={period} />
    </motion.div>
  )}
</AnimatePresence>
```

---

## Feature 3: Manager/Admin Team Stats in Quick Stats

### Current Design
The Quick Stats section (Today's ALP, Deals Today, Presentations, Close Rate) shows **personal** stats for everyone.

### New Design
For **managers and admins**, show **aggregated team totals** instead of personal stats:
- Today's ALP → Team's Total ALP for today
- Deals Today → Team's Total Deals for today
- Presentations → Team's Total Presentations for today
- Close Rate → Team's Average Close Rate for today

### Technical Changes

**File: `src/pages/AgentPortal.tsx`**

1. Add state to track team vs personal stats:
```tsx
const [teamTodayStats, setTeamTodayStats] = useState({
  totalALP: 0,
  totalDeals: 0,
  totalPresentations: 0,
  avgCloseRate: 0,
});
```

2. Update `fetchAgentData` to also fetch team stats for managers/admins:
```tsx
// After the existing agent data fetch, add:
if (isAdmin || isManager) {
  // Fetch all team agents
  let agentIds: string[] = [];
  
  if (isAdmin) {
    // Admin sees ALL agents
    const { data: allAgents } = await supabase
      .from("agents")
      .select("id")
      .eq("is_deactivated", false);
    agentIds = allAgents?.map(a => a.id) || [];
  } else if (agent) {
    // Manager sees their direct reports + themselves
    const { data: teamAgents } = await supabase
      .from("agents")
      .select("id")
      .eq("invited_by_manager_id", agent.id)
      .eq("is_deactivated", false);
    agentIds = [agent.id, ...(teamAgents?.map(a => a.id) || [])];
  }
  
  // Fetch today's production for all team members
  const today = new Date().toISOString().split("T")[0];
  const { data: teamProduction } = await supabase
    .from("daily_production")
    .select("aop, deals_closed, presentations, closing_rate")
    .in("agent_id", agentIds)
    .eq("production_date", today);
  
  if (teamProduction && teamProduction.length > 0) {
    const totalALP = teamProduction.reduce((sum, p) => sum + Number(p.aop || 0), 0);
    const totalDeals = teamProduction.reduce((sum, p) => sum + (p.deals_closed || 0), 0);
    const totalPresentations = teamProduction.reduce((sum, p) => sum + (p.presentations || 0), 0);
    const avgCloseRate = totalPresentations > 0 
      ? Math.round((totalDeals / totalPresentations) * 100) 
      : 0;
    
    setTeamTodayStats({ totalALP, totalDeals, totalPresentations, avgCloseRate });
  }
}
```

3. Update the Quick Stats grid to show team stats for managers/admins:
```tsx
// In the Quick Stats Grid section:
const showTeamStats = (isAdmin || isManager) && teamTodayStats.totalALP > 0;
const statsLabel = showTeamStats ? "Team's" : "Today's";

<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
  <QuickStat
    icon={DollarSign}
    label={`${statsLabel} ALP`}
    value={`$${(showTeamStats ? teamTodayStats.totalALP : todayALP).toLocaleString()}`}
    color="primary"
    delay={0.1}
  />
  <QuickStat
    icon={Trophy}
    label={showTeamStats ? "Team Deals" : "Deals Today"}
    value={showTeamStats ? teamTodayStats.totalDeals : todayDeals}
    color="amber"
    delay={0.15}
  />
  <QuickStat
    icon={Target}
    label={showTeamStats ? "Team Presentations" : "Presentations"}
    value={showTeamStats ? teamTodayStats.totalPresentations : todayPresentations}
    color="violet"
    delay={0.2}
  />
  <QuickStat
    icon={BarChart3}
    label={showTeamStats ? "Team Close %" : "Close Rate"}
    value={`${showTeamStats ? teamTodayStats.avgCloseRate : todayCloseRate}%`}
    color="emerald"
    delay={0.25}
  />
</div>
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/AgentPortal.tsx` | Modify | Add menu navigation, team stats logic |
| `src/components/dashboard/LeaderboardTabs.tsx` | Modify | Add flip toggle button and building mode |
| `src/components/dashboard/BuildingLeaderboard.tsx` | Create | New component for recruiting leaderboard |

---

## UI Behavior Summary

1. **Navigation**: Tap the menu icon in the Agent Portal header → slide-out drawer with links to Dashboard, Team, Settings

2. **Leaderboard Toggle**:
   - Gold gradient button with "Production" text centered above the leaderboard
   - Bounces up and down on hover (Framer Motion `whileHover`)
   - Click triggers a 3D flip animation transitioning to "Building" mode
   - Building mode shows recruiting stats: applicants, referrals, in-course agents

3. **Team Stats for Managers/Admins**:
   - Quick stats grid shows team aggregates instead of personal stats
   - Labels change from "Today's ALP" to "Team's ALP"
   - Real-time updates via Supabase subscriptions (already in place for production data)

---

## Visual Preview

```
┌─────────────────────────────────────────────────────────┐
│  [☰]  Agent Name  #3           [🌙] [→]                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  │ Team's ALP  │ │ Team Deals  │ │ Team Pres   │ │ Team Close% │
│  │   $5,432    │ │     12      │ │     45      │ │    27%      │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
│                                                         │
│  ┌─────────────────────────────────────────────────────┐
│  │  🏆 Leaderboard   [⚡Production⚡]  Live   Sort ▼  │
│  │                      ↑ Gold button, bounces on hover │
│  ├─────────────────────────────────────────────────────┤
│  │  #  Agent    Hours  Pres  Closes  Refs  Close%  ALP │
│  │  ...                                                 │
│  └─────────────────────────────────────────────────────┘
```
