

# Fix: Stop All Reloading on Tab Switch

## Root Cause Found

There are **two problems** working together:

### Problem 1: `handleSession` always creates a new `user` reference
When you switch tabs, the authentication system can fire multiple events. Even though `TOKEN_REFRESHED` is now handled correctly, other events (like `SIGNED_IN`) still go through the `handleSession` function which **always** calls `setUser()` at line 99 -- creating a brand new object reference even when nothing changed.

The deduplication logic on line 103 only prevents re-fetching profile/roles. It does NOT prevent the `user` object from changing, which is what triggers all the reloads.

### Problem 2: 17 components use `user` in effect dependencies
Components across the app (Dashboard, CallCenter, TeamDirectory, Applicants, CRM, etc.) all watch `user` in their `useEffect` dependency arrays. When the `user` object reference changes, every single one re-runs its data fetching.

## The Fix (two parts)

### Part 1: Stabilize `user` reference in `useAuth.ts`
- Store the current user ID in a ref
- In `handleSession`, only call `setUser()` if the user ID actually changed (not just a new object)
- This single change prevents the cascade to all 17 components

### Part 2: Harden component dependencies (safety net)
Change `user` to `user?.id` in the dependency arrays of all affected components so even if something slips through, they only re-run when the actual user identity changes:

- `src/pages/Dashboard.tsx`
- `src/pages/DashboardApplicants.tsx`
- `src/pages/DashboardAgedLeads.tsx`
- `src/pages/DashboardCRM.tsx`
- `src/pages/AgentPortal.tsx`
- `src/pages/TeamDirectory.tsx`
- `src/components/dashboard/DownlineStatsCard.tsx`
- `src/components/dashboard/OnboardingPipelineCard.tsx`
- `src/components/dashboard/QuickInviteLink.tsx`
- `src/components/dashboard/ManagerTeamView.tsx`
- `src/components/dashboard/TeamHierarchyManager.tsx`
- `src/components/dashboard/TeamSnapshotCard.tsx`
- `src/components/dashboard/MiniLeaderboard.tsx`
- `src/components/dashboard/TeamPerformanceBreakdown.tsx`

## Technical Details

### `useAuth.ts` change:
```typescript
// Add a ref to track current user ID
const currentUserIdRef = useRef<string | null>(null);

// In handleSession, only setUser if ID actually changed:
const newUserId = newSession?.user?.id ?? null;

setSession(newSession);

// Only update user state if the identity actually changed
if (newUserId !== currentUserIdRef.current) {
  currentUserIdRef.current = newUserId;
  setUser(newSession?.user ?? null);
}
```

### Component dependency changes (example):
```typescript
// Before (triggers on every user object change):
}, [user, isAdmin]);

// After (only triggers when actual user identity changes):
}, [user?.id, isAdmin]);
```

## Files to Modify
- `src/hooks/useAuth.ts` -- Stabilize user reference
- 14 component/page files -- Change `user` to `user?.id` in effect dependencies

