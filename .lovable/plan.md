

# Fix: Newly Contracted Agents Not Appearing on Dashboard

## Root Cause

The dashboard components don't refresh after agents are created:

1. **`ManagerTeamView`** uses raw `useState` + `useEffect([user?.id, isAdmin])` — it only fetches on initial mount. If the Dashboard was already loaded, navigating back won't trigger a refetch.

2. **`OnboardingPipelineCard`** and **`RecruitingQuickView`** use `useQuery` with `staleTime: 120_000` (2 minutes), so they serve cached data when navigating between pages.

3. **`TeamOverviewDashboard`** and **`TeamSnapshotCard`** similarly cache their queries.

The agents ARE being created correctly in the database (verified). The dashboards just don't re-fetch to show them.

## Fix Plan

### 1. Convert `ManagerTeamView` to `useQuery`
- Replace the manual `useState`/`useEffect` fetch pattern with `useQuery`
- Use a query key like `["manager-team-view", user?.id]`
- Set `staleTime: 0` so it always refetches on mount/focus
- This ensures the team list is fresh every time the user navigates to the Dashboard

### 2. Set `refetchOnWindowFocus: true` on key dashboard queries
- `OnboardingPipelineCard`, `RecruitingQuickView`, `TeamSnapshotCard`, `TeamOverviewDashboard` — reduce `staleTime` to `30_000` (30s) or set `refetchOnWindowFocus: true` (TanStack default) so data refreshes when switching tabs/pages

### 3. Invalidate dashboard queries after contracting
- In `ContractedModal` `onSuccess`, invalidate the relevant query keys (`manager-team-view`, `recruiting-quick-view`, `team-overview`, etc.) so the dashboard immediately shows the new agent
- Same for `AddAgentModal`

### 4. Fix duplicate agent records (data cleanup)
- There are 2 agents with duplicate `user_id` values (non-deactivated). This can cause confusion. Add a note to the `add-agent` edge function to check for existing agent records by `user_id` before creating new ones, preventing duplicates.

## Technical Details

- `ManagerTeamView` refactor: extract the `fetchTeamData` function, wrap in `useQuery`, remove manual state management for `teamMembers`/`teamStats`
- Query invalidation in `ContractedModal`: add `useQueryClient().invalidateQueries({ queryKey: ["manager-team-view"] })` etc. after successful contract
- The `RecruitingQuickView` staleTime of `120_000` should be reduced to `30_000`

