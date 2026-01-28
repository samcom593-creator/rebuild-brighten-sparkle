
# APEX Financial Platform - Complete Rebuild Plan

## Executive Summary
After thorough audit, I've identified the core issues preventing the dashboard from showing metrics correctly and all remaining gaps. This plan addresses every item in the master prompt with no compromises.

---

## Critical Issue #1: Dashboard Not Loading Metrics

### Root Cause Analysis
The `TeamSnapshotCard` component fetches data correctly, but there may be:
1. **Agent record mismatch** - User may not have an agent record linked
2. **Role detection timing** - `isAdmin`, `isManager` flags may not be set when query runs
3. **Date range query issues** - The date format or range may not match production data

### Fix Strategy
```text
1. Add explicit loading states with skeleton loaders
2. Add fallback for when agent record doesn't exist
3. Ensure role flags are loaded BEFORE data queries execute
4. Add console logging for debugging query results
5. Fix any null/undefined edge cases in stats calculation
```

---

## Phase 1: Dashboard Data Accuracy (CRITICAL)

### 1.1 Fix TeamSnapshotCard Query Logic
- Add null checks for agent ID
- Ensure `startDate` and `endDate` are valid before query
- Add error handling with user feedback
- Show actual data or explicit "no data" message

### 1.2 Fix Role-Based Scoping
- **Agents**: Show ONLY personal stats (Total ALP, Deals, Close Rate, Presentations)
- **Managers**: Show team totals + personal stats
- **Admin (Sam)**: Show entire agency metrics with comparison tools

### 1.3 Date Range Everywhere
Replace ALL "All-Time" occurrences with Custom Date Range picker:
- LeaderboardTabs.tsx (line 453 still has "all" tab)
- DownlineStatsCard.tsx
- CompactLeaderboard.tsx  
- BuildingLeaderboard.tsx
- PerformanceBreakdownModal.tsx

---

## Phase 2: Dashboard Layout Restructure

### Priority Order (Admin View - Top to Bottom)
```text
1. Agency Production Summary (TeamSnapshotCard)
   - Animated count-up on load ✓ (already implemented)
   - Custom date range ✓ (already implemented)
   
2. Mini Leaderboard (immediately under production)
   - Top 5 producers
   - Sorted highest → lowest
   
3. Recruiting Stats (Right side panel)
   - Total recruits
   - Total licensed
   - Manager comparison
   
4. Top Referral Producer
5. Broker Lights / Lead Sources
6. Invite Manager + Invite Team links

REMOVE COMPLETELY:
- AI Performance Coach
- AI Suggestions  
- Personal Stats section (for admin only - agency is primary)
```

### Files to Modify
- `src/pages/Dashboard.tsx` - Complete restructure

---

## Phase 3: Navigation Smoothness

### Current Issues
- Sidebar glitches when switching sections
- Double renders on route change
- Delayed permission checks causing flicker

### Fixes
```text
1. SidebarLayout.tsx:
   - AnimatePresence with mode="wait" ✓ (already added)
   - Ensure key prop matches route exactly
   - Add prefetch for role data

2. GlobalSidebar.tsx:
   - Memoize navigation items
   - Prevent re-render on every route change
   - Use React.memo for nav link components

3. useAuth.ts:
   - Cache role data to prevent refetch
   - Add loading skeleton instead of blank state
```

---

## Phase 4: Production Entry System

### Deal Entry Redesign
Replace manual ALP input with deal-by-deal entry:

```text
Button: "Add Deal"
  → Modal opens
  → Input: Monthly Premium (required)
  → System calculates: ALP = Monthly Premium × 12
  → Deal appears as animated "bubble" chip
  → Multiple deals supported per day
  
Each deal bubble:
  - Shows premium amount
  - Has edit button
  - Has delete (X) button
  - Animates in with scale effect
```

### Backdating Support
```text
- Calendar picker next to "Log Today's Numbers" header
- Allow selection of past 30 days
- Update production_date in database accordingly
```

### Files to Modify
- `src/components/dashboard/ProductionEntry.tsx` - Major rewrite
- `src/components/dashboard/ALPCalculator.tsx` - Already exists, integrate fully

---

## Phase 5: Command Center Improvements

### "Needs Attention" Logic Update
```text
Current: closingRate < 15%
New: LIVE agents under $5,000 weekly ALP
     + From Thursday onward: highlight zero production strongly
```

### Course Progress Tracking
```text
When new agent created:
1. Auto-generate portal login
2. Auto-grant coursework access
3. Track: Percent complete, Last activity, Stage

On completion:
- Trigger email to admin + assigned manager
- Unlock field training stage
- Record progression event in CRM
```

### Custom Date Range
Replace "All Time" tab with Custom picker (already partially done)

---

## Phase 6: Applicant/Pipeline Improvements

### Privacy Fix (CRITICAL)
When applicant is hired, notify ONLY:
- Admin
- Assigned manager (if exists)

DO NOT notify all agents (prevents poaching)

### Email Preview System
When clicking email template:
```text
1. Show modal with full email preview
2. Allow editing subject and body
3. User sees exactly what will be sent
4. Then click "Send" to dispatch
```

### Contracted Button
- Push applicant to CRM automatically
- Update status to "contracted"
- Send notification to admin + manager only

---

## Phase 7: Theme & Visual Excellence

### Light Mode Refinement
```css
/* Current - Too bright */
--background: 40 18% 96%;

/* New - Softer, eye-friendly */
--background: 40 12% 94%;
--card: 40 10% 97%;
--muted: 35 8% 90%;
```

### Animation Standards
```text
- Dashboard numbers: Count up from 0 (2 second duration)
- Page transitions: 150ms fade with slight Y translate
- Hover effects: Scale 1.02 with smooth easing
- Success states: Green checkmark with bounce
- Loading: Skeleton loaders (never blank states)
```

### Branding Consistency
- "Powered by Apex Financial" in all footers
- Apex crown logo with subtle glow animation
- Carrier banner rotation with dissolve effect

---

## Phase 8: Team Management

### Sorting & Controls
```text
Team roster sorted by:
- Production (highest → lowest) [default]
- Name A-Z
- Status

Clicking person opens profile actions:
- Edit any field (admin has full control)
- Assign/reassign manager
- Terminate/Archive
- Merge duplicates
```

### Invite Team Link
```text
Creates:
1. Agent portal magic login link
2. CRM record automatically
3. Sets agent status to LIVE
4. Sends welcome email with link
```

---

## Phase 9: Mobile Optimization

### Hard Requirements
```text
- ZERO horizontal scrolling
- Tables → stacked cards on mobile
- Sidebar collapses with smooth animation
- Thumb-optimized tap targets (minimum 44px)
- Forms single-screen where possible
- Numeric inputs trigger numeric keypad
```

---

## Phase 10: Lead Counter Automation

### Current State
Counter at 85, increments via edge function

### Automation
```text
Cron job runs daily at 6 AM:
- Increment by random 1-3
- Consistent growth for returning visitors
```

Already created: `supabase/functions/increment-lead-counter/index.ts`
Need: Schedule cron job in Supabase

---

## Implementation Order

| Priority | Task | Files | Complexity |
|----------|------|-------|------------|
| P0 | Fix dashboard not loading metrics | TeamSnapshotCard.tsx, Dashboard.tsx | High |
| P0 | Fix role detection timing | useAuth.ts | Medium |
| P1 | Dashboard layout restructure | Dashboard.tsx | High |
| P1 | Navigation smoothness | SidebarLayout.tsx, GlobalSidebar.tsx | Medium |
| P2 | Production entry with deal bubbles | ProductionEntry.tsx | High |
| P2 | Email preview modal integration | QuickEmailMenu.tsx | Medium |
| P3 | Theme brightness fix | index.css | Low |
| P3 | Needs Attention logic update | DashboardCommandCenter.tsx | Low |
| P4 | Mobile responsive fixes | Multiple files | Medium |
| P4 | Lead counter cron job | Database migration | Low |

---

## Files to Create/Modify

### New Files
- None needed (all components exist)

### Major Modifications
1. `src/pages/Dashboard.tsx` - Layout restructure
2. `src/components/dashboard/TeamSnapshotCard.tsx` - Fix data loading
3. `src/components/dashboard/ProductionEntry.tsx` - Deal entry system
4. `src/components/layout/SidebarLayout.tsx` - Navigation smoothness
5. `src/components/dashboard/LeaderboardTabs.tsx` - Remove "all" tab
6. `src/index.css` - Theme refinement

### Minor Updates
- `src/hooks/useAuth.ts` - Improve role caching
- `src/pages/DashboardCommandCenter.tsx` - Needs Attention logic
- `src/components/dashboard/QuickEmailMenu.tsx` - Preview integration

---

## Success Criteria

1. Dashboard loads metrics immediately (Total ALP, Deals, Agents, Close Rate)
2. No horizontal scroll on mobile
3. Navigation switches instantly with no glitches
4. All date ranges use Custom picker (no "All Time")
5. Deal entry uses Monthly Premium → auto-calculates ALP
6. Emails show editable preview before sending
7. Light mode is soft and eye-friendly
8. "Powered by Apex Financial" visible everywhere
9. Counter increments daily automatically
10. Platform feels "expensive and intentional" on first load
