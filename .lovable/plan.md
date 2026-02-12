

# Comprehensive Site Optimization and Agent Experience Overhaul

This plan addresses all the issues raised: slow loading, assign button delays, forced password changes, smoother lead deletion, email automation, and overall performance and UI polish.

---

## 1. Force Password Change on First Login

When an agent logs in with the default password "123456", automatically redirect them to change it before they can access anything else.

**How it works:**
- After successful login, check if the password used was "123456"
- If so, redirect to Settings page with a `force_password_change=true` parameter
- Settings page shows a locked-down "Change Your Password" screen -- no navigation allowed until password is updated
- Once changed, mark the agent record with `portal_password_set = true` so they are never prompted again

---

## 2. Fix Assign Button Speed (All 3 Components)

There are THREE separate assign/reassign components, and two of them are extremely slow due to N+1 database queries. Each one fetches managers differently -- some call an edge function that loops through every agent individually, others do N+1 queries client-side.

**Fix:**
- **ManagerAssignMenu**: Currently calls `get-active-managers` on mount (every instance). Change to lazy-load on dropdown open with shared cache (same pattern as QuickAssignMenu)
- **LeadReassignButton**: Currently does N+1 queries (one per agent to get `user_id`). Replace with a single query joining agents + user_roles + profiles, and use the shared edge function cache
- **get-active-managers edge function**: Replace the N+1 loop (one query per agent for role check + one for profile) with batch queries using `.in()` filters -- reducing from ~50 database round-trips to 3

---

## 3. Optimize Lead Deletion

Make lead deletion instant with optimistic UI updates instead of waiting for the database round-trip and full refetch.

**How it works:**
- Remove the deleted lead from the UI immediately on click
- Run the database delete in the background
- If it fails, restore the lead and show an error
- No full-page reload needed

---

## 4. Eliminate Unnecessary Page Reloads

The site reloads when it should not. Two causes:
- **PWA service worker** in `main.tsx` calls `window.location.reload()` when a new version activates -- this triggers during development/hot-reload cycles
- **HMR (Hot Module Replacement)** can trigger during Vite dev mode

**Fix:**
- Guard the service worker reload to only fire on user-initiated navigation, not during active sessions
- Increase query cache stale times to prevent refetch storms on window focus (already set but verify all components honor it)

---

## 5. Reduce Loading Screens Across the Site

Current loading states show skeleton loaders even for cached data. Fix by:
- Only showing loading state on initial mount (first load), not on refetches
- Using `placeholderData` in React Query to show stale data while refreshing
- Removing unnecessary `setLoading(true)` calls that trigger full loading states on subsequent visits

---

## 6. Welcome Email with Contracting Link

The current welcome email already sends Portal, Discord, and Coursework links. Update it to also include:
- A prominent "Start Contracting" step with the contracting link
- The contracting link is pulled from the manager's saved contracting links or from the `crm_setup_link` field on the agent

---

## 7. Optimize get-active-managers Edge Function

Replace the current N+1 loop with batch operations:

```text
Current: 1 query for agents + N queries for roles + N queries for profiles = ~100 queries
Optimized: 1 query for agents + 1 query for roles + 1 query for profiles = 3 queries
```

---

## Technical Details

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/AgentNumbersLogin.tsx` | After login with "123456", redirect to settings with `force_password_change=true` |
| `src/pages/Login.tsx` | Same forced password change redirect |
| `src/components/dashboard/ProfileSettings.tsx` | Add forced password change mode that blocks navigation |
| `src/components/dashboard/ManagerAssignMenu.tsx` | Lazy-load managers on open, use shared cache |
| `src/components/callcenter/LeadReassignButton.tsx` | Replace N+1 queries with single batch query using edge function |
| `src/pages/LeadCenter.tsx` | Add optimistic delete, reduce loading states |
| `src/main.tsx` | Guard PWA reload to prevent mid-session refreshes |
| `supabase/functions/get-active-managers/index.ts` | Batch queries instead of N+1 loop |
| `supabase/functions/welcome-new-agent/index.ts` | Add contracting link step to welcome email |
| `supabase/functions/add-agent/index.ts` | Pass contracting link to welcome email |

### Database Changes
- None required -- uses existing `portal_password_set` column on agents table

### Edge Functions to Deploy
- `get-active-managers` (performance fix)
- `welcome-new-agent` (add contracting link)
- `add-agent` (pass contracting link through)

