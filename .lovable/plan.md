

# Fix: Stop Full App Reload on Tab Switch

## Root Cause

When you switch tabs and come back, the authentication system fires a `TOKEN_REFRESHED` event. The current handler at line 139-143 of `useAuth.ts` does:

```typescript
if (event === "TOKEN_REFRESHED") {
  setSession(session);
  setUser(session?.user ?? null);  // <-- THIS creates a new object reference
  return;
}
```

Even though the user hasn't changed, `setUser()` creates a new React object reference. Over 20 components across the app use `user` in their `useEffect` dependency arrays (Dashboard, CallCenter, TeamDirectory, AgentPortal, etc.), so they ALL re-run their data fetches simultaneously -- causing the "everything reloads" effect.

## Fix

### File: `src/hooks/useAuth.ts` (1 change)

In the `TOKEN_REFRESHED` handler, only update the `session` state. Do NOT call `setUser()` since the user object hasn't actually changed -- only the access token inside the session has been refreshed.

```typescript
// Before (broken):
if (event === "TOKEN_REFRESHED") {
  setSession(session);
  setUser(session?.user ?? null);  // triggers 20+ component re-renders
  return;
}

// After (fixed):
if (event === "TOKEN_REFRESHED") {
  setSession(session);
  // Do NOT call setUser() -- user identity hasn't changed,
  // only the token was refreshed. Calling setUser creates a
  // new object reference that cascades re-renders across 20+ components.
  return;
}
```

### Why This Works

- `session` is only used by the auth context itself (for API calls). Updating it is fine and doesn't cascade.
- `user` is consumed by Dashboard, CallCenter, AgentPortal, TeamDirectory, and 15+ other components in their effect dependency arrays. A new reference triggers all of them to re-fetch data.
- By not updating `user` on token refresh, those effects stay dormant and the page remains perfectly stable.

## Files to Modify
- `src/hooks/useAuth.ts` -- Remove `setUser()` call from the `TOKEN_REFRESHED` handler (1 line deletion)

