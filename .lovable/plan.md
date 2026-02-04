
## Goals
1. On the **Purchase Leads** page, when a user taps **Venmo** or **Cash App**, clearly instruct them to type **“leads”** in the payment **note field** (so payments are easy to match).
2. Make navigation/load screens feel **way faster**, especially around the sidebar and route changes.
3. Keep lead-count editing locked to **you only** (admin), both in UI and enforced by backend rules.

---

## What I found (root causes of slowness)
### 1) `useAuth()` is being instantiated dozens of times
- `useAuth()` is used across many components (GlobalSidebar + lots of dashboard widgets/pages).
- The current `useAuth()` implementation sets up:
  - `supabase.auth.onAuthStateChange(...)` subscription
  - `supabase.auth.getSession()`
  - profile + roles queries
- Because it’s a plain hook (not a shared provider), those listeners/queries happen **per component mount**, which can create:
  - repeated loading states
  - extra re-renders
  - event subscription overhead
  - “load screen” flashes in `ProtectedRoute` (since it shows a skeleton while `isLoading` is true)

### 2) The sidebar re-renders more than it should
- Many pages wrap their content in `<DashboardLayout>` which mounts the sidebar from inside the page component.
- Any frequent state update inside a page (timers, realtime refetches, animations) can cause the layout + sidebar to re-render more often than necessary.
- Example: `PurchaseLeads` has a 1-second countdown tick, which will re-render the page frequently.

### 3) Blocking Framer Motion transitions
- `AnimatePresence mode="wait"` exists in `Apply.tsx` and `AgentNumbersLogin.tsx`.
- `mode="wait"` can make transitions feel “stuck” because it waits for exit animations before entering the next view.

---

## Changes I will implement

### A) Purchase Leads: “Type leads in the note” instruction on tap
**File:** `src/pages/PurchaseLeads.tsx`

1. Add a small, clear instruction in the UI near the payment buttons:
   - “Important: In the payment note field, type: **leads**”
2. When the user taps **Venmo** or **Cash App**, open a lightweight confirmation dialog (instead of immediately opening the link):
   - Shows:
     - Package name + weekly price
     - Instruction: “In the note field, type: leads”
   - Includes buttons:
     - “Copy ‘leads’” (copies to clipboard)
     - “Continue to Venmo/Cash App” (then opens the external link)
3. Keep current links exactly as provided:
   - Venmo QR link
   - Cash App `$ApexFinancial`

Why: This guarantees users see the instruction at the exact moment they’re about to pay.

---

### B) Ensure only you can edit lead count (extra hardening)
**File:** `src/pages/PurchaseLeads.tsx`

1. Add an explicit guard in `handleSaveCount()`:
   - If `!isAdmin`, block immediately and show a toast (“Only admins can edit the lead count.”).
2. Keep relying on backend rules as the real enforcement (UI is just the convenience).

Why: Even though the edit icon is hidden for non-admins, this prevents any accidental/edge UI invocation.

---

### C) Major performance fix: make auth state a singleton (AuthProvider)
**Files:**
- `src/hooks/useAuth.ts` (refactor)
- `src/App.tsx` (wrap the app with provider)

1. Convert auth into a single shared provider (one subscription, one session fetch):
   - Create an `AuthContext` and `AuthProvider` (implemented in the same file to avoid changing imports everywhere).
   - `AuthProvider` does:
     - initial session fetch once
     - a single `onAuthStateChange` subscription once
     - fetch profile + roles once per session change
2. Update exported `useAuth()` to simply read from context.
3. Wrap the application in `<AuthProvider>` once at the top level (in `App.tsx`).

Expected result:
- No more duplicated auth listeners across the app
- Dramatically reduced “loading” flashes during navigation
- Sidebar and pages stop fighting over auth initialization work

---

### D) Make navigation feel instant: move the sidebar layout to a route shell (so it doesn’t re-render constantly)
**Files:**
- `src/App.tsx` (route structure update)
- Multiple pages currently wrapping themselves with `DashboardLayout`:
  - `src/pages/Dashboard*.tsx`, `AgentPortal.tsx`, `Numbers.tsx`, `OnboardingCourse.tsx`, `PurchaseLeads.tsx`, `CourseProgress.tsx`, etc.

1. Create a single “authenticated shell route” that renders:
   - `SidebarLayout` (the sidebar + mobile header)
   - an `<Outlet />` for page content
2. Apply `ProtectedRoute` at the shell level (so it doesn’t remount repeatedly for every child route).
3. Update each dashboard/authenticated page to render **only the page body**, not the layout wrapper.

Expected result:
- Sidebar stays mounted and stable
- Page-level timers/realtime updates won’t cause sidebar/layout rerenders
- Route transitions feel much faster because the app frame persists

---

### E) Remove blocking animations (`mode="wait"`)
**Files:**
- `src/pages/Apply.tsx`
- `src/pages/AgentNumbersLogin.tsx`

1. Replace `AnimatePresence mode="wait"` with:
   - `mode="popLayout"` (preferred for snappy feel), or
   - remove `mode` entirely (defaults to non-blocking behavior)
2. Keep animations but avoid “exit must finish first” behavior.

Expected result:
- Steps/pages feel responsive instead of “hanging” between transitions

---

## Validation / Testing checklist (what you’ll verify)
1. Purchase Leads:
   - Tap Venmo/Cash App → dialog appears → instruction is obvious → “Copy ‘leads’” works → Continue opens correct link.
2. Lead count editing:
   - Non-admin cannot see edit icon
   - Non-admin cannot save even if attempting (toast + no update)
   - Admin can update successfully
3. Navigation speed:
   - Clicking sidebar items no longer shows long full-page skeleton delays
   - Sidebar stays responsive while pages load
4. Auth stability:
   - No repeated loading flicker when navigating
   - No “multiple listeners” behavior during long sessions
5. Mobile:
   - Mobile menu still opens/closes quickly, overlay doesn’t get stuck

---

## Technical notes (for completeness)
- This plan focuses on reducing unnecessary work on navigation:
  - Singleton auth subscription
  - Stable layout shell
  - Non-blocking transitions
- These are the highest-impact changes for the “side navigation slow + load screens slow” symptoms you described.

