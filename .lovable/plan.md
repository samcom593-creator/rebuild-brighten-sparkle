
# Comprehensive Performance & Functionality Overhaul Plan

## Summary of Issues to Fix

Based on my analysis, here are the critical issues identified:

1. **Navigation freeze after multiple sidebar clicks** - React refs and `AnimatePresence mode="wait"` causing mount conflicts
2. **Command Center slow loading** - Missing query optimizations and unnecessary re-renders
3. **Pipeline navigation glitch** - Transition animations blocking smooth navigation
4. **Log Numbers page glitch** - `AnimatePresence mode="wait"` causing full remounts
5. **Course Progress missing course content view** - No way to view actual course modules/questions
6. **No bulk delete functionality** - Need checkbox selection for batch operations
7. **Delete requires admin approval even for admins** - Remove email approval flow for admins
8. **CRM/Team Directory slow loading** - Sequential queries instead of parallel
9. **Remove "My Team" navigation entirely** - User request due to slow load and redundancy
10. **Dashboard cleanup** - Remove License Status chart and redundant team stats card
11. **Stat card popups** - Add clickable popups for Total AOP, Active Agents, Producers, Needs Attention
12. **Account management** - Add password reset, forgot password capabilities for admins

---

## Technical Fixes

### 1. Fix Navigation Freeze Bug

**Root Cause:** Multiple `AnimatePresence mode="wait"` instances throughout the app are causing React to wait for exit animations before mounting new content. When sidebar is clicked rapidly, this queues animations and creates a backlog.

**Files to modify:**
- `src/components/layout/SidebarLayout.tsx` - Remove page animation or simplify
- `src/pages/LogNumbers.tsx` - Change `AnimatePresence mode="wait"` to just `AnimatePresence`
- `src/pages/DashboardCRM.tsx` - Same fix

**Fix approach:**
```tsx
// Instead of:
<AnimatePresence mode="wait">
  <motion.div key={page} ...>

// Use:
<AnimatePresence initial={false}>
  <motion.div key={page} ...>
```

This allows parallel animations without blocking and prevents the queue buildup.

### 2. Fix Command Center Loading Speed

**File:** `src/pages/DashboardCommandCenter.tsx`

**Issues found:**
- The query structure is fine but there are no optimizations for initial render
- Components like TeamHierarchyManager fetch their own data causing waterfalls

**Fixes:**
- Add `gcTime` (garbage collection time) to prevent refetching 
- Use `suspense: false` to prevent blocking
- Defer non-critical sections with `lazy` loading
- Remove animation delays completely (already done, verify)

```tsx
const { data: agentsData } = useQuery({
  queryKey: ["command-center-agents", dateRange],
  staleTime: 60000, // 60 seconds
  gcTime: 300000,   // 5 minutes cache
  queryFn: async () => { ... }
});
```

### 3. Add Course Content Viewer for Admins/Managers

**New Component:** `src/components/admin/CourseContentViewer.tsx`

**Features:**
- Display all modules with their video URLs
- Show all quiz questions with answers (admin view)
- Integrated into Course Progress page with a "View Course Content" button

**File to modify:** `src/pages/CourseProgress.tsx`
- Add a button/tab to toggle between progress monitoring and course content view

### 4. Add Bulk Selection & Delete to Team Hierarchy

**File:** `src/components/dashboard/TeamHierarchyManager.tsx`

**Changes:**
- Add checkbox column
- Add "Select All" header checkbox
- Add floating action bar with "Delete Selected" button
- Bulk delete skips approval for admins
- Show count of selected items

```tsx
// Add state
const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());

// Add checkbox column to table
<TableHead className="w-10">
  <Checkbox
    checked={selectedAgents.size === filteredAgents.length}
    onCheckedChange={handleSelectAll}
  />
</TableHead>

// Add bulk action bar
{selectedAgents.size > 0 && (
  <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-card border rounded-lg shadow-lg p-3 flex items-center gap-3">
    <span>{selectedAgents.size} selected</span>
    <Button variant="destructive" onClick={handleBulkDelete}>
      <Trash2 className="h-4 w-4 mr-2" />
      Delete Selected
    </Button>
  </div>
)}
```

### 5. Fix Admin Delete Without Approval

**File:** `src/components/dashboard/DeactivateAgentDialog.tsx`

**Current behavior:** Even admins go through email approval for "Remove from System"

**Fix:** Check if user is admin and if so, directly delete without email confirmation:

```tsx
// Line ~153: Add admin bypass
} else if (action === "remove_from_system") {
  if (isAdmin) {
    // Direct delete for admins - no approval needed
    await performDirectDelete(agentId);
    toast.success(`${agentName} removed from system`);
  } else {
    // Non-admins need email approval
    await supabase.functions.invoke("confirm-agent-removal", { ... });
    toast.success("Removal request sent - awaiting admin approval");
  }
}
```

Add a new function to handle permanent deletion:
```tsx
const performDirectDelete = async (agentId: string) => {
  // Delete from all related tables in order
  const tables = [
    'agent_notes', 'agent_attendance', 'agent_goals', 'agent_ratings',
    'onboarding_progress', 'agent_onboarding', 'daily_production',
    'agent_achievements', 'plaque_awards', 'contact_history'
  ];
  
  for (const table of tables) {
    await supabase.from(table).delete().eq('agent_id', agentId);
  }
  
  // Finally delete agent
  await supabase.from('agents').delete().eq('id', agentId);
};
```

### 6. Remove "My Team" from Navigation

**File:** `src/components/layout/GlobalSidebar.tsx`

**Change:** Remove the "My Team" nav item (line 123-128):
```tsx
// REMOVE this entire block:
items.push({ 
  icon: UsersRound, 
  label: "My Team", 
  href: "/dashboard/team",
  roles: ["admin", "manager", "agent"]
});
```

**Also update:** `src/pages/Dashboard.tsx` - Remove the "My Team" quick action card

### 7. Dashboard Cleanup

**File:** `src/pages/Dashboard.tsx`

**Changes:**
1. Remove the "License Status" pie chart (lines 375-380)
2. Remove the redundant team stats above "Your Team" (the ManagerTeamView already shows this)
3. Keep Lead Sources chart

```tsx
// REMOVE License Status chart (lines 375-380):
<AnalyticsPieChart
  title="License Status"
  icon={<Award className="h-4 w-4 text-primary" />}
  data={licenseData}
/>

// Keep only Lead Sources
<AnalyticsPieChart
  title="Lead Sources"
  icon={<MapPin className="h-4 w-4 text-primary" />}
  data={sourceData}
/>
```

### 8. Add Clickable Stat Card Popups

**New Component:** `src/components/dashboard/StatCardPopup.tsx`

**Features:**
- Reusable popup dialog showing breakdown data
- Different content based on stat type (AOP, Producers, Active Agents, Needs Attention)

**Implementation in Command Center:**
```tsx
// Make stat cards clickable
<Card 
  className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
  onClick={() => openPopup("totalAlp")}
>
  {/* existing content */}
</Card>

// Popup content by type:
// totalAlp: List of agents with their AOP contribution
// producers: List of agents who sold, with deals and AOP
// activeAgents: List of all active agent names
// needsAttention: List of agents below threshold with their current AOP
```

**Needs Attention Logic Update:**
- Week filter: Show agents with < $5,000
- Month filter: Show agents with < $20,000

### 9. Optimize CRM and Page Loading

**File:** `src/pages/DashboardCRM.tsx`

**Issues:**
- Multiple sequential queries
- Heavy `AnimatePresence mode="wait"` usage

**Fixes:**
1. Use `Promise.all` for parallel data fetching
2. Change `AnimatePresence mode="wait"` to `AnimatePresence` throughout
3. Add `staleTime` to all queries

### 10. Add Password Management to Accounts

**File:** `src/pages/DashboardAccounts.tsx`

**Enhancements:**
1. Add "Send Password Reset" button in dropdown menu
2. Add "Send Login Link" option

```tsx
// In DropdownMenuContent
<DropdownMenuItem onClick={() => handleSendPasswordReset(account)}>
  <Key className="h-4 w-4 mr-2" />
  Send Password Reset
</DropdownMenuItem>
<DropdownMenuItem onClick={() => handleSendLoginLink(account)}>
  <Mail className="h-4 w-4 mr-2" />
  Send Magic Login Link
</DropdownMenuItem>
```

These will use existing edge functions:
- `supabase.auth.resetPasswordForEmail()` for password reset
- `generate-magic-link` edge function for login links

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `src/components/layout/GlobalSidebar.tsx` | Remove "My Team" nav item |
| `src/components/layout/SidebarLayout.tsx` | Simplify page transitions, remove `AnimatePresence` or set `initial={false}` |
| `src/pages/DashboardCommandCenter.tsx` | Add stat card popups, optimize queries, update Needs Attention thresholds |
| `src/pages/Dashboard.tsx` | Remove License Status chart, remove redundant team stats, remove My Team quick action |
| `src/pages/CourseProgress.tsx` | Add Course Content Viewer tab for admins/managers |
| `src/pages/LogNumbers.tsx` | Fix `AnimatePresence mode="wait"` causing glitches |
| `src/pages/DashboardCRM.tsx` | Optimize queries, fix AnimatePresence |
| `src/pages/DashboardAccounts.tsx` | Add password reset and magic login options |
| `src/components/dashboard/TeamHierarchyManager.tsx` | Add bulk selection and delete functionality |
| `src/components/dashboard/DeactivateAgentDialog.tsx` | Admin bypass for delete approval |

## New Files to Create

| File | Purpose |
|------|---------|
| `src/components/dashboard/StatCardPopup.tsx` | Reusable popup for stat card breakdowns |
| `src/components/admin/CourseContentViewer.tsx` | Admin view of course modules and quiz questions |

---

## Expected Results

1. **No more navigation freezes** - Removed blocking animations
2. **Instant Command Center** - Optimized queries with caching
3. **No Pipeline glitch** - Smooth parallel transitions
4. **Log Numbers works smoothly** - Fixed animation blocking
5. **Full course visibility** - Admins/managers can see all content and questions
6. **Bulk operations** - Select multiple agents and delete at once
7. **Admin direct delete** - No more approval emails for admins
8. **Faster CRM/pages** - Parallel queries and cached data
9. **Cleaner sidebar** - Removed redundant "My Team" link
10. **Cleaner dashboard** - No duplicate data, focused layout
11. **Interactive stats** - Click to see who contributed what
12. **Account control** - Password resets and login links from admin panel
