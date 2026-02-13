
# Course Progress, Pipeline, Dashboard & Performance Fixes

## Overview
This plan addresses 5 areas the user flagged: (1) Course Progress needs better filters and visual polish, (2) Pipeline needs to show assigned manager and remove "contacted" button, (3) Dashboard needs avg deal size and avg hours called metrics, (4) AgencyGrowthCard label should say "Recruiting Stats", and (5) overall performance and flow improvements.

---

## 1. Course Progress Monitor -- Visual Overhaul & Filters

The current Course Progress page is functional but visually basic (a flat table). It needs to feel more engaging.

**Changes to `src/pages/CourseProgress.tsx`:**
- Add a "Finished" filter tab (alias for "complete") with a distinct green checkmark icon and celebratory styling
- Add animated progress rings instead of flat progress bars for each agent row
- Add gradient backgrounds to the stat filter cards (currently flat GlassCard)
- Add subtle row hover effects with left-border color coding (green = complete, amber = stalled, red = at risk, blue = in progress, gray = not started)
- Add an overall progress summary bar at the top showing a visual breakdown (colored segments for each filter category)
- Make module header cells more readable with tooltips on hover
- Add smooth AnimatePresence transitions when switching between filters (fade out old rows, fade in new ones)
- Add a "time in course" column showing how many days since the agent started the course

## 2. Pipeline (Applicants) -- Show Manager & Remove "Contacted"

**Changes to `src/pages/DashboardApplicants.tsx`:**

**Show assigned manager name on each applicant card:**
- Fetch manager names by joining `assigned_agent_id` to the `agents` table to get `invited_by_manager_id` or directly resolving the assigned agent's profile name
- Display a "Under [Manager Name]" badge on each card (using the existing pattern from CRM pipeline cards)
- If unassigned, show "Unassigned" badge in muted style

**Remove "contacted" from filters:**
- Remove the "contacted" SelectItem from the status filter dropdown (line 765)
- The `getApplicationStatus` function already returns "hired" and "contracted" correctly -- no change needed there
- Remove "contacted" from `statusColors` map (line 94) since it's no longer a primary status

**Ensure no "contacted" button exists:**
- The previous changes already replaced contacted/qualified/close buttons with Hired + Contracted buttons. Verified this is working correctly in the current code (lines 641-677). No further changes needed.

## 3. Dashboard -- Add Avg Deal Size & Avg Hours Called

**Changes to `src/components/dashboard/TeamSnapshotCard.tsx`:**
- Add two new stats to the production snapshot grid:
  - **Avg Deal Size**: `totalALP / totalDeals` (only when deals > 0)
  - **Avg Hours Called**: Sum of `hours_called` from daily_production / number of active agents with production
- Expand the grid from `grid-cols-2 md:grid-cols-4` to `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` to accommodate the two new metrics
- Add `hours_called` to the production query select (currently only fetches `aop, deals_closed, presentations, agent_id`)
- Both new stats are clickable for drilldown (like existing stats)

## 4. Dashboard -- Rename AgencyGrowthCard

**Changes to `src/components/dashboard/AgencyGrowthCard.tsx`:**
- Change the header title from "Agency Growth" to "Recruiting Stats"
- Change subtitle from "Building & recruiting stats" to "Hiring & growth metrics"

## 5. Performance / Speed Improvements

**Changes across multiple files:**
- In `DashboardApplicants.tsx`: Add `staleTime: 120_000` to avoid refetching on every mount; wrap manager name lookup in a single batch query instead of N+1
- In `CourseProgress.tsx`: Add `staleTime: 60_000` to the course progress query to prevent redundant fetches
- In `Dashboard.tsx`: The page currently uses raw `useEffect` + `useState` for data fetching instead of React Query. This is a heavier refactor, but we can at least add abort controllers and avoid duplicate fetches.

---

## Technical Summary

| File | Changes |
|------|---------|
| `src/pages/CourseProgress.tsx` | Visual overhaul: gradient stat cards, row color coding, AnimatePresence transitions, "days in course" column, progress summary bar, staleTime |
| `src/pages/DashboardApplicants.tsx` | Show manager name badge on cards, remove "contacted" filter option, batch manager name lookup, staleTime |
| `src/components/dashboard/TeamSnapshotCard.tsx` | Add Avg Deal Size and Avg Hours Called stats, expand grid, add hours_called to query |
| `src/components/dashboard/AgencyGrowthCard.tsx` | Rename "Agency Growth" to "Recruiting Stats" |
