

# Dashboard Performance Optimization

After auditing the full dashboard, here are the key issues and fixes organized by impact.

---

## Issue 1: No Query Caching on Main Dashboard Data (HIGH IMPACT)

The main `Dashboard.tsx` fetches all its stats (leads, charts, source data) using a raw `useEffect` + `useState` pattern. This means:
- Data re-fetches on every mount (no caching)
- No stale-while-revalidate behavior
- No deduplication if multiple renders happen

**Fix**: Convert the `useEffect` fetch in `Dashboard.tsx` (lines 97-249) to a `useQuery` hook with the existing 120s `staleTime`. This gives instant re-renders on tab switches and prevents duplicate network requests.

---

## Issue 2: Unstable `useEffect` Dependency Causing Extra Refetches (HIGH IMPACT)

Line 249: `[user?.id, profile]` — the `profile` object gets a new reference on every auth state change, causing the entire dashboard data fetch to re-run unnecessarily.

**Fix**: Change dependency to `[user?.id, profile?.full_name]` so it only refetches when the name actually changes.

---

## Issue 3: Unused Import (LOW IMPACT, cleanup)

`DashboardLayout` is imported on line 22 but never used in the JSX (the `AuthenticatedShell` already provides the sidebar). This is dead code.

**Fix**: Remove the unused import.

---

## Issue 4: `OnboardingPipelineCard` Uses Raw useEffect Instead of useQuery (MEDIUM IMPACT)

This component fetches data with `useEffect` + manual `setLoading`, missing caching entirely. Every dashboard mount triggers a fresh query.

**Fix**: Convert to `useQuery` with a stable query key.

---

## Issue 5: Excessive Staggered Motion Animations (MEDIUM IMPACT)

The dashboard has ~10+ `motion.div` wrappers with staggered `delay` values. On every mount these run entrance animations, causing:
- Layout shifts during staggered reveals
- Extra JS work on the main thread

**Fix**: Replace most staggered `motion.div` wrappers with simple `div` elements. Keep only the welcome header animation (first impression) and remove delays from section headers and stat cards that are below the fold.

---

## Issue 6: Inline Object/Array Recreation on Every Render (LOW-MEDIUM IMPACT)

- `licenseData` (line 81-84) recreates on every render
- Quick actions array (lines 288-308) recreates on every render
- `sourceData` default value recreates on every render

**Fix**: Wrap computed values in `useMemo` where they depend on `stats`.

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Convert data fetch to `useQuery`, fix `profile` dependency, remove unused `DashboardLayout` import, wrap computed arrays in `useMemo`, reduce `motion.div` wrappers |
| `src/components/dashboard/OnboardingPipelineCard.tsx` | Convert `useEffect` fetch to `useQuery` |

---

## Technical Details

### Dashboard.tsx useQuery conversion:
- Extract fetch logic into a `queryFn` 
- Query key: `["dashboard-stats", user?.id]`
- Return a single object with `stats`, `dailyData`, `weeklyData`, `monthlyData`, `sourceData`, `userName`, `currentAgentId`
- Enable the query only when `user` exists (`enabled: !!user`)
- Leverages the global 120s `staleTime` already configured

### Motion cleanup:
- Keep: welcome header animation (lines 267-284)
- Remove: section header motion wrappers (lines 356-364, 379-389, 441-449, 457-462), quick action card stagger (lines 294-298)
- Quick action cards become plain `div` with CSS `transition` for hover only

### OnboardingPipelineCard useQuery:
- Query key: `["onboarding-pipeline", user?.id, isAdmin]`
- Removes manual `loading` state in favor of `isLoading` from useQuery

