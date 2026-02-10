

# Fix 2026 Agency Performance Card — Accurate Data + No Flicker

## Problem

The `YearPerformanceCard` has two issues:

1. **Loading flicker**: Every realtime production update calls `fetchYearStats` which sets `loading = true`, causing the skeleton loader to flash. This makes the card appear "not up to date" because it briefly blanks out the numbers on every update.

2. **Client-side aggregation**: The card fetches all raw `daily_production` rows and aggregates in JavaScript. There's already a server-side `get_agent_production_stats` RPC function that does this more reliably. Switching to it ensures accurate totals (currently: $298,687 ALP, 246 deals, 284 presentations for 2026).

3. **Not visible on main Dashboard**: The card only appears on the Agent Portal page (and is hidden on mobile). The main Dashboard at `/dashboard` doesn't include it at all — admins should see their YTD agency performance front and center.

## Technical Changes

### File 1: `src/components/dashboard/YearPerformanceCard.tsx`

**Fix loading flicker (line 39)**:
- Remove `setLoading(true)` from inside `fetchYearStats`. Only set loading on initial mount via the `useState(true)` default.
- This way realtime updates silently refresh the numbers without blanking the card.

**Switch to server-side RPC**:
- Replace the raw `supabase.from("daily_production").select(...)` query with `supabase.rpc("get_agent_production_stats", { start_date: yearStart, end_date: yearEnd })`.
- This returns pre-aggregated totals per agent, which we then sum — no risk of hitting the 1000-row client limit as the agency grows.
- For managers, filter the RPC results to only their team agent IDs (same logic as now, just applied post-RPC).

### File 2: `src/pages/Dashboard.tsx`

**Add YearPerformanceCard for admins**:
- Import `YearPerformanceCard` and render it below the `TeamSnapshotCard` section when `isAdmin` is true.
- This ensures the admin always sees their 2026 Agency Performance on the main dashboard.

## Summary

- No more skeleton flashes on realtime updates
- Server-side aggregation for guaranteed accuracy
- Card visible on the main Dashboard for admins
