
# Fix Daily Numbers Input + Code Optimization

## Critical Issue: LogNumbers Search Too Restrictive

**File**: `src/pages/LogNumbers.tsx`, line 163

The search on `/apex-daily-numbers` filters agents by `onboarding_stage: "evaluated"`. Only **14 of 36** active agents have this status. The other 22 agents (in `training_online`, `in_field_training`, `onboarding`) are invisible to the search. If you're looking up an agent who isn't "evaluated" yet, they won't appear and you'll be prompted to create them as a new agent instead.

**Fix**: Remove the `onboarding_stage` filter. Allow searching ALL active, non-deactivated agents:
```typescript
// Before (line 163)
.eq("onboarding_stage", "evaluated")
.eq("is_deactivated", false);

// After
.eq("is_deactivated", false);
```

Also update the leaderboard query (line 321) to match, removing `.eq("onboarding_stage", "evaluated")`.

---

## Issue 2: Numbers Page Login Loop

**File**: `src/pages/Numbers.tsx`

The `/numbers` route is inside `AuthenticatedShell`, which already handles authentication and redirects to `/agent-login` if not logged in. But the `Numbers` component also has its own independent auth check and login UI. This creates a race condition:

1. User logs in via `/agent-login`
2. Gets redirected back to `/numbers`
3. `AuthenticatedShell` confirms auth (user exists)
4. `Numbers` component starts its OWN auth check (loading = true)
5. If the agent record lookup fails or is slow, the user sees a login form **inside the authenticated shell**

**Fix**: Since the route is already protected by `AuthenticatedShell`, remove the redundant login UI from Numbers.tsx. Instead, use the `useAuth()` hook (same pattern as Dashboard.tsx) to get the current user, then look up their agent ID. If no agent record exists, show a "No agent record found" message instead of another login form.

---

## Issue 3: LogNumbers Leaderboard Profile Access

**File**: `src/pages/LogNumbers.tsx`, line 317

The leaderboard fetch joins `profiles` directly. For regular agents, RLS only allows viewing their own profile. Manager/admin access is fine, but if a regular agent somehow reaches this page, all other agents would show as "Unknown" in the leaderboard.

**Fix**: Use the existing `get_leaderboard_profiles()` database function (which is `SECURITY DEFINER` and bypasses RLS) instead of the direct profile join:
```typescript
// Fetch leaderboard names via the security definer function
const { data: profilesData } = await supabase.rpc("get_leaderboard_profiles");
```

---

## Issue 4: LogNumbers Creates Agents with Random user_id

**File**: `src/pages/LogNumbers.tsx`, lines 218-246

When creating a new agent from LogNumbers, the code generates `const userId = crypto.randomUUID()` and inserts it into the `profiles` and `agents` tables. This creates an orphaned auth record -- the `user_id` doesn't correspond to any real Supabase Auth user. This means:
- The agent can never log in
- The profile is unreachable via normal RLS policies
- It pollutes the database with ghost records

**Fix**: Use the existing `create-new-agent-account` edge function (which properly creates a Supabase Auth user) or use `create-agent-from-leaderboard` edge function instead of client-side direct inserts.

---

## Optimization 1: Redundant DashboardLayout in LogNumbers

**File**: `src/pages/LogNumbers.tsx`, line 390

`LogNumbers` wraps itself in `<DashboardLayout>` which renders `<SidebarLayout>`. But the route is already inside `<AuthenticatedShell>` which also renders `<SidebarLayout>`. This double-wraps the sidebar, potentially causing layout issues or double renders.

**Fix**: Remove the `<DashboardLayout>` wrapper from LogNumbers since `AuthenticatedShell` already provides the sidebar layout.

---

## Optimization 2: Redundant DashboardLayout in Numbers

**File**: `src/pages/Numbers.tsx`

Same issue -- the Numbers component doesn't use DashboardLayout in its authenticated view, but it's wrapped by AuthenticatedShell. The unauthenticated view at the bottom uses `min-h-screen` styling that would conflict with the sidebar layout. Since the route is protected, the unauthenticated view is unreachable anyway.

**Fix**: Remove the dead unauthenticated login UI code.

---

## Summary of File Changes

### `src/pages/LogNumbers.tsx`
- Remove `onboarding_stage: "evaluated"` filter from agent search (line 163)
- Remove `onboarding_stage: "evaluated"` filter from leaderboard fetch (line 321)
- Remove `<DashboardLayout>` wrapper (already provided by AuthenticatedShell)
- Replace direct agent creation with edge function call
- Use `get_leaderboard_profiles()` RPC for leaderboard names

### `src/pages/Numbers.tsx`
- Remove redundant auth/login flow (the page is protected by AuthenticatedShell)
- Use `useAuth()` hook instead of manual auth state management
- Remove dead unauthenticated UI code
- Show meaningful error state if user has no agent record

### No database changes required
