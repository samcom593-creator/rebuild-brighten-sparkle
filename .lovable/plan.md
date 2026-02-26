
## Goal
Make the dashboards and CRM numerically correct and internally consistent, standardize terminology to **ALP** across the UI + frontend variable names, add a premium/interactive **Estimated Earnings** experience (date picker + hourly/daily averages), make recruiting pipeline cards fully tappable to open CRM profiles, and reduce “hesitation / freeze / can’t tap” issues by tightening realtime + overlay cleanup.

---

## What I found (root causes)
### 1) Terminology mismatch (AOP vs ALP) is widespread
- The database column is `daily_production.aop`.
- The UI currently shows a mix of **AOP** and **ALP** across dozens of components.
- Some components already use `*ALP` variables (good), but still render labels as AOP (bad).
- You confirmed: **AOP → ALP everywhere**, and also “frontend variable cleanup”.

### 2) “Agents sold today” is being computed as “agents with any production row”
In several places “agent count” is derived from “distinct agents present in daily_production rows”, which can include 0-deal rows. You want: **agents who sold today** → agents with `deals_closed > 0`.

### 3) YTD numbers can be off due to role filters + inconsistent agent inclusion
`YearPerformanceCard` uses the RPC `get_agent_production_stats()` (good), but:
- Manager path filters team agents with `.eq("is_deactivated", false)` (can drop valid production).
- Some team/agency components still apply “active-only” filters while others do not.
- Result: YTD/agency totals vs other cards can disagree.

### 4) Recruiting / Onboarding pipeline widgets are not “drilldownable”
`OnboardingPipelineCard` is a static summary; it truncates names and doesn’t open CRM profiles. You want:
- Tap a stage → see the full agency list for that stage
- Tap an agent → open their CRM profile (expanded row)

### 5) Lead Center “Closed” is currently inconsistent with your actual status enum
- Your `applications.status` enum currently is: `new, reviewing, no_pickup, contracting, rejected` (confirmed from the database).
- The UI references statuses like `hired`, `approved`, `contracted` that **do not exist** in the enum, causing mismatched counts/filters.
- You chose “Status-based closed”: we need a consistent business definition that matches your current schema.

### 6) “Slow/hesitate/freeze on tap” likely comes from two things
- Many components call `useProductionRealtime(..., 300)` which is *very aggressive*; it creates frequent invalidations/re-renders under activity.
- The app already has `useNavigationGuard()` to fix stuck overlays/pointer-events, but it only runs on route change; Radix overlays can still get “stuck” mid-page without a navigation event.

---

## Clarifications you already answered (locked requirements)
- **$2,000 weekly threshold applies to averages only** (not totals, not rankings).
- Lead Center “Closed” should be **status-based** (we’ll implement using your real enum values).
- Pipeline tap should open **CRM profile**.
- AOP→ALP: **labels + frontend variable cleanup**.

---

## Design approach (how we’ll make numbers “impossible to disagree”)
### A) Create a shared “Production Aggregation” utility (single source of truth)
Introduce a small lib helper used by all production dashboards/leaderboards to:
- Aggregate rows by agent and by date
- Compute:
  - totals (sum)
  - “agents sold today” (distinct agent_id where deals_closed > 0)
  - closing rate (deals / presentations)
  - *qualified-average* agent set (weekly ALP >= 2000) for averages only

This prevents “7-day vs 30-day vs projected 30-day” from using different math.

### B) Standardize ALP wording + variables while preserving DB field name `aop`
- Keep database access as `aop` (no schema change).
- In frontend code, rename local variables to `alp` / `ALP` consistently.
- In UI text, render “ALP” everywhere.

---

## Implementation plan (by feature)

### 1) Fix YTD ALP correctness + remove “missing agent” filters
**Files**
- `src/components/dashboard/YearPerformanceCard.tsx`

**Changes**
- Keep using `supabase.rpc("get_agent_production_stats")` (good for accuracy).
- Remove the manager-only `.eq("is_deactivated", false)` restriction when building teamIds.
- Add consistent inclusion rules:
  - **Admin**: all agents returned by RPC
  - **Manager**: self + downline regardless of deactivation (for historical accuracy)
  - **Agent**: self only

**Result**
YTD ALP totals match the database aggregates (and match what you see in other production totals).

---

### 2) Fix “Agents Sold Today” + agency/team “today” numbers
**Files**
- `src/components/dashboard/TeamSnapshotCard.tsx`
- (optional, if used elsewhere) `src/pages/AgentPortal.tsx` quick stats
- `src/components/dashboard/LiveLeaderboard.tsx` (team stats label accuracy)

**Changes**
- Add a new stat: **Agents Sold Today**
  - definition: distinct agents with `production_date = todayPST` AND `deals_closed > 0`
- Ensure “Active agents” labels are not misleading:
  - If a card is showing “agents with production row today” we label it that way, otherwise switch to “Agents Sold Today”.

**Result**
If 7 agents sold today, the dashboard shows 7—no more counting “0-deal” entries.

---

### 3) Enforce “Averages only count agents >= $2,000 weekly ALP”
**Files**
- `src/components/dashboard/PersonalStatsCard.tsx` (already mostly correct)
- `src/components/dashboard/TeamSnapshotCard.tsx` (avg deal size / avg hours / avg close rate computations)
- `src/components/dashboard/TeamPerformanceBreakdown.tsx` (week close/avg display where applicable)
- Any other “Avg …” production cards we find while doing the ALP rename pass

**Changes**
- Keep **totals** unchanged.
- When computing any “Avg X” in team/agency views:
  - build per-agent weekly ALP
  - only include agents with weekly ALP >= 2000 in average denominators
- Update the small footer copy to explicitly indicate:
  - “Averages use $2K+ weekly ALP agents only”

**Result**
“Team average” stops being dragged down by new/inactive producers while totals remain complete.

---

### 4) Convert all UI + frontend variables from AOP → ALP (comprehensive sweep)
**Files (known hotspots from search)**
- `src/components/dashboard/ProductionForecast.tsx` (title “30-Day AOP Forecast” → “30-Day ALP Forecast”)
- `src/components/dashboard/TeamSnapshotCard.tsx` (“Total AOP” etc → “Total ALP”)
- `src/components/dashboard/ManagerProductionStats.tsx` (“Today AOP” → “Today ALP”, “Week AOP” → “Week ALP”)
- `src/components/dashboard/TeamPerformanceBreakdown.tsx` (“AOP” → “ALP”)
- `src/components/dashboard/MobileLeaderboardCard.tsx` (label “AOP” → “ALP”)
- `src/components/dashboard/LeaderboardTabs.tsx` (all “By AOP” labels, column header “AOP”)
- `src/pages/DashboardCRM.tsx` (week/month labels, any remaining AOP text)
- `src/components/dashboard/EstimatedEarningsCard.tsx` (AOP labels + variables)
- plus remaining matches found by repo-wide search

**Changes**
- Replace displayed strings “AOP” → “ALP”
- Rename frontend variables where it improves clarity:
  - `adminAOP` → `adminALP`
  - `othersAOP` → `teamALP`
  - `totalALP` stays `totalALP`
  - internal maps: `{ aop: ... }` can remain if it stores DB fields, but we’ll prefer `{ alp: ... }` after ingestion.

**Non-goal**
- No database schema changes; `aop` remains the stored column.

---

### 5) Estimated Earnings: make it interactive + date range picker + $/day + $/hour
**Files**
- `src/components/dashboard/EstimatedEarningsCard.tsx`
- reuse existing `src/components/ui/date-range-picker.tsx` (already in project)

**UI/UX upgrades**
- Add a compact date picker button in the header:
  - presets: This Week, This Month, Last 30, Custom
- Add an interactive breakdown section:
  - Personal ALP, Team Override ALP
  - Personal Earnings, Override Earnings, Total
- Add derived metrics:
  - **Avg / Day** = total earnings / number of days in range (inclusive)
  - **$/Hour** = total earnings / total hours_called in range (if hours_called is 0 → show “—”)
- Add subtle interactivity:
  - hover/tap reveal of formulas (“9/12 * 0.5”, “9/12 * 1.2”)
  - small animated counters for totals (optional if it matches your existing AnimatedNumber style)

**Data correctness**
- Query `daily_production` for the selected date range:
  - sum ALP for currentAgentId vs everyone else
  - also sum `hours_called` for currentAgentId (to compute $/hour meaningfully)

---

### 6) Recruiting & Growth: tap pipeline stage → full list → tap agent → open CRM profile
**Files**
- `src/components/dashboard/OnboardingPipelineCard.tsx`
- `src/pages/DashboardCRM.tsx`

**Changes**
1) Make each pipeline stage card clickable:
   - on click, open a Dialog/Sheet listing all agents in that stage (not just 3)
   - show full name (first + last), and contact freshness indicator
   - remove the “red dot when null” behavior; use:
     - null lastContactedAt → gray “New”
     - <24h green, <48h yellow, else red

2) When tapping an agent from that dialog:
   - navigate to CRM with a focus param:
     - `/dashboard/crm?focusAgentId=<agentId>`
   - In `DashboardCRM.tsx`, read the query param on load:
     - auto-expand that row
     - scroll it into view
     - briefly highlight it (ring/glow) so it feels “snapped to target”

**Result**
From the dashboard’s recruiting card you can drill down and “work the list” instantly.

---

### 7) Unlicensed applicants visibility (“not just mine” + show “under someone else”)
**Files**
- `src/components/dashboard/ManagerTeamView.tsx`
- `src/pages/DashboardCRM.tsx` (unlicensed applicants section)

**Changes**
- Ensure admin sees **all** unlicensed applicants (already close, but we’ll verify no hidden filters).
- Ensure managers can optionally view:
  - “My recruits” (current behavior)
  - “Full team” (include downline applications too)
- When an applicant belongs “under another manager”, show a badge:
  - “Under: <Manager Name>”
  - for admins only (or for managers if they have permission to see it)

---

### 8) Lead Center: make “Closed” correct and add “Avg leads/day” stat + drilldown view
**Files**
- `src/pages/LeadCenter.tsx`

**Changes**
1) Replace the current broken “closed_all” logic and any references to non-existent statuses.
   - Your real statuses are: `new, reviewing, no_pickup, contracting, rejected`.
   - Status-based “Closed” proposal (matches your schema):
     - **Closed = status IN ('contracting')** (and optionally include any additional “closed-like” status you confirm later)
   - The “Closed” stat card count and the list shown when you click it will use the *same predicate* (single source of truth).

2) Add “Avg Leads / Day” stat at the top
   - default window: last 30 days
   - based on leads created per day (applications only, or both sources—configurable; we’ll default to applications for “Lead Center” consistency)
   - show: total leads in window / 30

3) Add a “Closed leads view” experience
   - Option A: click “Closed” stat filters the table (already does) + also opens a “Closed” subheader with quick toggles:
     - Licensed / Unlicensed
   - Option B (if you want a dedicated page): route to `/dashboard/leads/closed` with those filters pre-set  
   We will implement Option A first for speed and cohesion unless you explicitly want a new route.

---

### 9) Reduce “hesitation / freeze / can’t tap” issues (stability pass)
**Files**
- Anywhere calling `useProductionRealtime(fn, 300)` (multiple dashboards)
- `src/hooks/useProductionRealtime.ts`
- `src/hooks/useNavigationGuard.ts`
- `src/pages/NotificationHub.tsx` (realtime invalidation)
- (optional) `src/components/layout/GlobalSidebar.tsx` / `SidebarLayout.tsx` if we find overlay interactions

**Changes**
1) Realtime debounce normalization
- Replace most `useProductionRealtime(..., 300)` usages with either:
  - `useProductionRealtime(fn)` (default 800ms), or
  - `useProductionRealtime(fn, 800)`
- Keep truly “live” pages (if any) at a safe minimum (e.g., 600–800ms) but not 300ms.

2) NotificationHub realtime throttle
- Instead of invalidating the query on every insert immediately, debounce invalidation (same jittered strategy) to avoid UI stalls when blasts run.

3) Interactivity watchdog (overlay cleanup beyond navigation)
- Extend `useNavigationGuard` to also run cleanup on:
  - `window.focus`
  - `visibilitychange`
  - and a short interval when it detects `body.style.pointerEvents === 'none'` for too long
This targets the “I tap and it freezes / can’t tap some things” symptom even without route changes.

4) Fix the console warning in NotificationHub (ref forwarding)
- The warning indicates a component is being given a ref incorrectly inside `BulkBlastSection`.
- We’ll locate the exact element (likely a `motion()` wrapper around a non-forwardRef component) and replace it with:
  - `motion.div` wrapping a plain `<div>` container, not the component itself.

---

## Backend / database changes
- **No schema changes required** for this pass.
- If you later want true `hired/contracted` statuses in `applications.status`, that will require a database enum migration + careful backfill, but we will *not* do that now because it’s a larger behavioral change.

---

## Verification plan (end-to-end, the “no excuses” checklist)
1) **Production truth checks (admin)**
- Compare:
  - YTD ALP card vs direct database sum (YTD)
  - Today totals vs Today leaderboard sum
  - “Agents Sold Today” equals count of distinct agents with deals_closed > 0 today

2) **Averages threshold check**
- Toggle week/month/custom and confirm the average only changes when a sub-$2k agent is present (should not affect averages).

3) **Estimated Earnings**
- Change date range presets and confirm:
  - totals change
  - $/day and $/hour update logically (hours-called edge cases handled)

4) **Recruiting pipeline drilldown**
- Tap a stage → dialog opens
- Tap an agent → CRM opens and expands that agent

5) **Lead Center**
- “Closed” count equals filtered list count
- “Avg leads/day” matches last-30-day lead total / 30
- Clicking “Closed” shows only the correct status group

6) **Performance/stability**
- Rapidly switch between Dashboard → CRM → Notifications → Agent Portal on mobile and desktop:
  - no stuck overlays
  - no “can’t tap”
  - reduced stutter during production updates / blasts

---

## Files we will touch (expected)
- `src/components/dashboard/EstimatedEarningsCard.tsx`
- `src/components/dashboard/YearPerformanceCard.tsx`
- `src/components/dashboard/TeamSnapshotCard.tsx`
- `src/components/dashboard/ProductionForecast.tsx`
- `src/components/dashboard/LeaderboardTabs.tsx`
- `src/components/dashboard/MobileLeaderboardCard.tsx`
- `src/components/dashboard/ManagerProductionStats.tsx`
- `src/components/dashboard/TeamPerformanceBreakdown.tsx`
- `src/components/dashboard/OnboardingPipelineCard.tsx`
- `src/pages/DashboardCRM.tsx`
- `src/pages/LeadCenter.tsx`
- `src/pages/NotificationHub.tsx`
- `src/hooks/useProductionRealtime.ts` (usage adjustments primarily)
- `src/hooks/useNavigationGuard.ts`
- plus remaining ALP/AOP label occurrences found in the sweep

---