
## What’s actually broken (based on the code I inspected)

### A) “Numbers” freezes the whole screen
You currently have **two** “numbers” experiences:
- `/numbers` → `src/pages/Numbers.tsx` (dashboard quick action links here)
- `/apex-daily-numbers` → `src/pages/LogNumbers.tsx`

In `Numbers.tsx`, you subscribe to `supabase.auth.onAuthStateChange(...)` and inside that callback you immediately call `loadAgentData()` which performs multiple database calls. This pattern is a known cause of **Supabase auth deadlocks/freezes** (UI appears stuck because auth state + DB calls happen in the same tick).

That is the most likely cause of the “click numbers → freeze entire screen”.

### B) Loading is still slow (esp. Command Center/admin)
`/dashboard/command` (`DashboardCommandCenter.tsx`) currently loads:
1) all agents
2) all production in the date range (not scoped to only those agents)
Then it aggregates client-side.
This can be heavy and will feel slow on real data.

Also, `ProtectedRoute.tsx` re-checks session + roles + agent status with extra queries on mount. This increases “admin access delay” and adds repeated load screens.

### C) Invitation Tracker needs “Full screen” + “X to mark seen”
`InvitationTracker.tsx` has no full-screen route and there is **no database state** for “seen/dismissed”. So adding an X requires a small table to remember which invites you’ve acknowledged.

### D) Contracting link workflow isn’t what you described
`InviteTeamModal.tsx` technically supports saving links, but it:
- doesn’t prompt for a link the first time for “licensed agent”
- doesn’t let you select a saved link for the specific invite
- doesn’t attach the chosen link to the invite email/link output

### E) Google + Phone sign-in
There is currently **no Google sign-in code** in the app (I found no `signInWithOAuth` or Lovable Cloud auth helper usage).
Phone sign-in (SMS/OTP) is also not implemented in the UI.

### F) “Agency Production” hover/tap drilldowns
`TeamSnapshotCard.tsx` shows stats but doesn’t provide click/hover drilldowns. Command Center has a `StatCardPopup`, but the dashboard doesn’t use it.

### G) Sidebar hover labels
Tooltips exist in `GlobalSidebar.tsx`, but they only show when the sidebar is collapsed. You want “hover to know what it is” on desktop without guessing.

---

## Implementation Plan (what I will change)

### 1) Fix the “Numbers” freeze (highest priority)
**Goal:** Clicking “Log Numbers” should never freeze.

**Files**
- `src/pages/Numbers.tsx`

**Changes**
- Remove any “DB work” from `onAuthStateChange` callback.
- Make the auth callback do only synchronous state updates (set user/session flags).
- Trigger `loadAgentData()` from a separate `useEffect` that runs after session is set (or defer with `setTimeout(0)`).
- Add an “isMounted” guard + cancel stale requests to avoid race conditions when route changes quickly.
- Remove noisy `console.log(...)` in production paths (keeps UI snappy).

**Outcome**
- `/numbers` becomes stable.
- No full-page freeze/deadlock.

---

### 2) Reduce global loading screens + speed up admin access
**Files**
- `src/components/ProtectedRoute.tsx`
- `src/hooks/useAuth.ts` (verify it remains the single source of truth)
- `src/pages/DashboardCommandCenter.tsx`

**Changes**
- Refactor `ProtectedRoute` to rely on `useAuth()` (already caches roles + profile) instead of running its own queries every mount.
- Ensure `ProtectedRoute` uses a fast “session-known” path and avoids extra DB calls during route transitions.
- In `DashboardCommandCenter`:
  - Fetch agent IDs first (active/live only), then query production **scoped to those agent IDs** (`in('agent_id', agentIds)`), not “all production for the whole agency”.
  - Filter out deactivated/inactive/incorrect statuses at the query level whenever possible.
  - Keep current caching (`staleTime`, `gcTime`) but remove unnecessary expensive re-computation.

**Outcome**
- Command Center feels immediate.
- Admin “delay” is dramatically reduced.
- Fewer “loading page” flashes.

---

### 3) Invitation Tracker: Full-screen view + “X = mark as seen”
**Backend addition (small table)**
Create a table (name suggestion): `invitation_seen`
- columns: `id`, `viewer_user_id`, `agent_id`, `seen_at`
- unique constraint: `(viewer_user_id, agent_id)`
- RLS:
  - Admin/manager can insert/select rows where `viewer_user_id = auth.uid()`

**Files**
- `src/components/dashboard/InvitationTracker.tsx`
- `src/pages/Dashboard.tsx`
- `src/App.tsx`
- New page: `src/pages/Invitations.tsx` (full-screen recent invites)

**Changes**
- Add a “Full screen” button on the card → route `/dashboard/invitations` (or `/invitations`).
- Add an “X” button per invite:
  - inserts (or upserts) into `invitation_seen`
  - immediately removes it from the “recent” list (or moves it into a “Seen” section).
- Full-screen page shows most recent (e.g., 50–200) with filters:
  - Pending / Accepted
  - Seen / Unseen

**Outcome**
- Recent Invites becomes a true “inbox” with acknowledgment.
- You can clear the list cleanly.

---

### 4) Contracting link workflow exactly as requested
**Files**
- `src/components/dashboard/InviteTeamModal.tsx`
- `supabase/functions/send-agent-portal-login/index.ts` (if we need the email to include selected link)
- (optional) `supabase/functions/generate-magic-link/index.ts` if link needs to be embedded in magic flow

**Changes**
- When inviting a **licensed** agent:
  - If no saved links exist → automatically open the “Contracting Links” section and require user to add one (name + url).
  - If saved links exist → show a “Choose saved link” dropdown + “Add new link” option.
- Persist the saved link name + URL.
- Attach the chosen contracting link to:
  - the success screen “copy link” area, and/or
  - the email that gets sent to the new agent (best experience).
- Keep it optional for unlicensed agents if you want (but we’ll still allow it).

**Outcome**
- First time forces setup (for licensed).
- Second time reuses saved link cleanly, with names.

---

### 5) Reminders at 4pm, 7pm, 9pm CST (increasing urgency)
I checked the cron jobs in the database: there are existing `notify-fill-numbers` schedules, but they’re not aligned with your requested times and the payload format may not match the function signature.

**Files**
- `supabase/functions/notify-fill-numbers/index.ts`

**Backend**
- Update cron schedules (data operation) to:
  - 4pm CST
  - 7pm CST
  - 9pm CST
- Ensure the request payload matches what the function expects (standardize on `reminderType` like `4pm|7pm|9pm`, or map current `first/second` values cleanly).
- Ensure the “increasing urgency” copy is driven by reminder type.

**Outcome**
- Consistent daily reminder cadence exactly as specified.

---

### 6) Google sign-in + Phone number sign-in
**Google**
- Enable Google sign-in in Lovable Cloud auth settings (managed Google is fine).
- Add “Continue with Google” button to:
  - `src/pages/Login.tsx`
  - `src/pages/AgentNumbersLogin.tsx` (if you want agents to use it too)

**Phone**
- Add “Sign in with phone” option:
  - phone input → send code (OTP)
  - code input → verify and create session
- Confirm phone provider is enabled in backend auth settings.

**Important note**
- “Remember me”: your auth client already persists sessions in localStorage, so if you’re getting logged out, the fix is likely eliminating freezes/deadlocks and avoiding route-level auth re-check loops (handled in steps 1–2). The checkbox currently doesn’t change behavior; we can either:
  - remove it (since it’s redundant), or
  - make it meaningful by toggling whether we call signOut on “logout” vs just leaving session.

---

### 7) Agency Production drilldowns (hover + tap)
**Files**
- `src/components/dashboard/TeamSnapshotCard.tsx`
- Reuse/adapt `src/components/dashboard/StatCardPopup.tsx`

**Changes**
- Make each stat tile clickable:
  - Total ALP → list agents contributing + their ALP/deals for the selected date range
  - Deals → list agents + deals count
  - Active Agents → list names
  - Close Rate → list agents sorted by close rate (with minimum presentation threshold so it’s meaningful)
- Use the same date range already inside `TeamSnapshotCard` (`useDateRange`).

**Outcome**
- “Agency Production” becomes interactive and actionable, not just display.

---

### 8) Sidebar hover labels (desktop)
**Files**
- `src/components/layout/GlobalSidebar.tsx`

**Changes**
- Expand tooltips behavior so you can always hover icons and see the label quickly on desktop.
  - If expanded: tooltip can still appear on hover of the icon area (optional).
  - If collapsed: keep current behavior (already good).

**Outcome**
- No memorizing navigation.

---

## QA / “Tell me it’s done” checklist (what we will verify after implementation)
1) Click “Log Numbers” from dashboard 10 times quickly → never freezes.
2) Open `/dashboard/command` → no multi-second blank “loading”, and interactions remain smooth.
3) InvitationTracker:
   - Full screen button opens full list
   - X marks as seen and removes item immediately
4) Invite Team (licensed):
   - First time prompts for link
   - Second time shows saved link + naming + choose existing
5) Confirm cron fires at 4/7/9 CST (we’ll verify job schedules + trigger test runs)
6) Google login works end-to-end
7) Phone OTP login works end-to-end
8) Agency Production tiles open drilldowns and show correct filtered data
9) Sidebar hover labels work on desktop

---

## Work sequencing (fastest path to immediate impact)
1) Fix `/numbers` freeze (Numbers.tsx)  
2) Refactor `ProtectedRoute` + Command Center query scoping  
3) Invitations full-screen + seen/dismiss  
4) Contracting link workflow + email inclusion  
5) Reminder cron alignment  
6) Google + phone sign-in  
7) Agency Production drilldowns + sidebar hover polish
