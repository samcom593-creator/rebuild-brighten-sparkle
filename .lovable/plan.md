

# Plan: Fix Loading Performance

## Root Causes Found

1. **DashboardApplicants & RecruiterDashboard use `useState`+`useEffect` instead of `useQuery`** — no cache between navigations, full refetch every time you switch tabs
2. **Dashboard fetches `SELECT *` from applications** — pulls every column when only ~6 are needed for stats
3. **CRM `fetchAgents` makes 7 sequential/parallel DB calls with no caching** — all data thrown away on navigation
4. **Auth stale token not handled gracefully** — console shows `refresh_token_not_found` error, auth hangs in loading state instead of redirecting to login
5. **framer-motion `AnimatePresence` on list items** — causes layout thrashing on large lists (CRM expanded rows, applicant cards)

## Changes

### 1. Convert DashboardApplicants to `useQuery` (biggest impact)
**File**: `src/pages/DashboardApplicants.tsx`
- Replace `useState` + `useEffect` fetch pattern with `useQuery` + query key
- Data persists in cache when navigating away and back — instant render
- Add `staleTime: 60000` so it shows cached data immediately, refetches in background
- Keep `setApplications` for optimistic local mutations (hired, terminated, etc.)

### 2. Convert DashboardCRM to `useQuery`
**File**: `src/pages/DashboardCRM.tsx`
- Extract `fetchAgents` into a standalone async function that returns data
- Wrap with `useQuery({ queryKey: ["crm-agents"], queryFn, staleTime: 60000 })`
- Show cached data instantly on tab return, background refresh

### 3. Convert RecruiterDashboard to `useQuery`
**File**: `src/pages/RecruiterDashboard.tsx`
- Same pattern: extract fetch logic, wrap with `useQuery`
- Cache key: `["recruiter-leads"]`

### 4. Slim Dashboard `SELECT *` to specific columns
**File**: `src/pages/Dashboard.tsx`
- Change `.select("*")` to `.select("id, created_at, contacted_at, closed_at, license_status, referral_source")` — only the 6 columns actually used for stats/charts

### 5. Handle stale refresh token in useAuth
**File**: `src/hooks/useAuth.ts`
- In the `onAuthStateChange` listener, catch `TOKEN_REFRESHED` failures
- Add error handling: if `getSession` returns a session but token refresh fails with `refresh_token_not_found`, call `signOut()` to clear stale localStorage and redirect cleanly instead of hanging

### 6. Remove AnimatePresence from CRM expanded rows
**File**: `src/pages/DashboardCRM.tsx`
- Replace `motion.div` with `initial/animate/exit` on `AgentExpandedRow` with a simple conditional render — eliminates layout recalculation on 50+ agent rows

## Files to Edit
1. `src/pages/DashboardApplicants.tsx` — convert to useQuery
2. `src/pages/DashboardCRM.tsx` — convert to useQuery, remove motion on expanded rows
3. `src/pages/RecruiterDashboard.tsx` — convert to useQuery
4. `src/pages/Dashboard.tsx` — slim SELECT columns
5. `src/hooks/useAuth.ts` — handle stale refresh token gracefully

## No database changes needed

