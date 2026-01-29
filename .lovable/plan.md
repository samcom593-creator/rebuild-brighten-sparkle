
## What’s actually broken (based on the code)

### 1) “Dashboard puts everything to the side” on mobile
This is caused by **SidebarLayout.tsx** always applying a `margin-left` that’s meant for the desktop sidebar:

- Desktop sidebar is hidden on mobile (`hidden lg:block`)
- But `<main style={{ marginLeft: `${sidebarWidth}px` }}>` still runs on mobile/tablet
- Result: the whole page gets shoved right by ~256px (or 64px), which looks like “everything moved to the side”

This will also feel “glitchy” when the sidebar state changes (open/collapsed/fullscreen), because the layout reflows horizontally.

### 2) “People don’t have access to the Agent Portal”
**AgentPortal.tsx** currently blocks normal agents unless:
- they are logged in AND
- they have an `agents` record AND
- `agent.onboarding_stage === "evaluated"`

But your **agent-signup** backend function creates agents with:
- `status: "active"`
- `onboarding_stage: "onboarding"` (not evaluated)

So those new agents will be told they “don’t have access” even though they’re active and should be allowed in.

### 3) Post-submit layout shifts (Agent Portal + Dashboard)
Even after reducing confetti, **canvas-confetti** can still cause layout thrash on mobile browsers because it injects a canvas into the DOM and resizes it. We mitigated iOS Safari, but:
- iOS “Chrome/Firefox” are still WebKit and can behave similarly
- The safest fix is to ensure confetti uses a **fixed-position canvas we own**, so it never affects layout and never injects into the document in an uncontrolled way.

### 4) Merge “fails”
Two likely causes:
- **Self-merge (same agent ID)** isn’t blocked (user selects “Obi” that’s actually the same record), which should return a clean “you selected the same agent” message.
- The merge backend is currently **public** (`verify_jwt = false`) and uses a privileged key, but it does **no permission validation** and has incomplete merge logic for potential unique collisions (e.g., daily_production date conflicts). Even if it “should work”, it’s brittle and also a security risk.

---

## Implementation plan (what I will change)

### A) Fix mobile dashboard “shifted right” immediately
**File:** `src/components/layout/SidebarLayout.tsx`

1. Add a desktop breakpoint detector (>= 1024px, matching Tailwind `lg`)
2. Apply `marginLeft` **only on desktop**
   - On mobile/tablet: `marginLeft = 0`
3. Only animate the margin on desktop:
   - Use `lg:transition-[margin-left]` instead of always transitioning

**Expected result:** Mobile dashboard no longer gets pushed right; no more “everything to the side”.

---

### B) Make confetti 100% non-disruptive to layout on mobile
**File:** `src/components/dashboard/ConfettiCelebration.tsx`

1. Replace the default `confetti()` call with `confetti.create(canvas, { resize: true })`
2. Render a dedicated `<canvas>` that is:
   - `position: fixed; inset: 0; pointer-events: none;`
   - high z-index
3. Disable confetti on **all iOS browsers** (not just Safari) if we still see instability:
   - iPhone/iPad UA OR iPadOS detection (`MacIntel` + touch points)

**Expected result:** Confetti can never “push” layout; it’s an overlay only.

---

### C) Fix Agent Portal access logic (stop blocking active agents)
**File:** `src/pages/AgentPortal.tsx`

1. Stop hard-redirecting unauthenticated users to `/login`
   - Instead show a clean “Please log in” screen with buttons:
     - “Instant Login” → `/install`
     - “Admin Login” → `/login`
2. Fetch agent record with fields needed for access:
   - `id, status, onboarding_stage, is_deactivated, is_inactive`
   - Use `.maybeSingle()` (not `.single()`) to avoid throwing when missing
3. Replace the current “must be evaluated” gate with status-based rules:
   - Allow portal if `status === "active"` AND not deactivated/inactive
   - If `status === "pending"`: route to `/pending-approval` (or show inline state)
   - If terminated/inactive/deactivated: show a clear “Account inactive” message (no loops)

**Expected result:** New agents created via signup won’t get blocked anymore.

---

### D) Make merging “anyone with anyone” reliable and safe
**Files:**
- `src/components/dashboard/AgentQuickEditDialog.tsx`
- `supabase/functions/merge-agent-records/index.ts`

**UI fixes (AgentQuickEditDialog.tsx):**
1. Prevent selecting the current agent as the merge target:
   - Disable that option in the list
   - If somehow selected, show: “You can’t merge an agent into itself.”
2. Add a confirmation step (merge is destructive)

**Backend fixes (merge-agent-records function):**
1. Require authentication even though `verify_jwt = false`
   - If no `Authorization` header: return 401
2. Enforce admin role in code by checking `user_roles`
   - If not admin: return 403
3. Handle merge collisions safely (especially `daily_production` unique date conflicts):
   - For each duplicate daily_production row:
     - If primary already has same date: merge/sum fields into primary, then delete duplicate row
     - Else: reassign agent_id
4. Move all agent-linked data we currently clean up in “hard delete” flows:
   - applications assignments, notes, goals, metrics, awards, onboarding progress, etc.
5. Return clear response messages so the UI can show exactly what happened

**Expected result:** Merge stops “failing” silently and becomes consistent, and it’s no longer a public privileged endpoint.

---

## How we’ll verify (Published + Mobile)

1. **Mobile Dashboard:** open `/dashboard` and confirm:
   - no left blank margin
   - no horizontal shove when opening/closing menus
2. **Agent Portal access:** open `/agent-portal`:
   - logged out: see login screen (no redirect loop)
   - logged in active agent: portal loads
   - pending agent: goes to pending approval state
3. **Submit numbers:** submit a deal on mobile:
   - no layout shift during/after confetti
4. **Merge:** attempt merge from leaderboard:
   - cannot merge a record into itself
   - merging two different “Obi” records succeeds and reports what moved

---

## Notes / rollout
Because your app uses a PWA service worker, after we ship these fixes we should still do a quick end-to-end verification on the **published** link (and if anything looks “stuck on old code”, we’ll also harden the update behavior so users reliably get the newest build).

If you want, I can include a small “Update available → Refresh” banner for the PWA so users stop getting trapped on stale bundles.

---

## What you can expect after this is implemented
- Mobile dashboard will stop shifting right entirely (root-cause fixed)
- Agent Portal will stop denying active agents created through signup
- Confetti will never cause layout reflow on mobile
- Merge will be reliable and protected (admin-only, no public privilege hole)
