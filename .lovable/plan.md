
## What’s actually happening (root cause)

### 1) “Premium input turns into a Deal bubble after 1 digit”
This is coming from **`src/components/dashboard/ALPCalculator.tsx`** (used inside **`src/components/dashboard/ProductionEntry.tsx`**, which is rendered on **`src/pages/AgentPortal.tsx`**).

Right now the calculator decides what is “completed” like this:

- “Completed” deals = `deals.filter(d => parseFloat(d.amount) > 0)`
- The “current input row” = `deals.filter(d => !parseFloat(d.amount)).slice(0,1)`

So the moment the user types the first digit (e.g. “3”), `parseFloat("3") > 0` becomes true and that row immediately gets treated as “completed”, disappears from the input area, and shows up as a bubble (e.g. “#1 …”). That makes it impossible to type “30000”.

### 2) Admin portal banner “Admin View — You are viewing the Agent Portal for testing purposes”
This is hardcoded UI in **`src/pages/AgentPortal.tsx`** and is displayed when `isAdminViewing` is true.

### 3) “Powered by Apex” loading screens across the site
You have multiple “full page” loading states that still use spinners and/or non-standard copy:
- `src/components/ProtectedRoute.tsx` (full page spinner)
- `src/pages/Numbers.tsx` (full page spinner)
- `src/pages/AgentPortal.tsx` (full page loader currently shows spinning icon and other text)
- `src/components/ui/skeleton-loader.tsx` already has a branded “page” loader, but the copy is “Powered by Apex Financial” (needs to be “Powered by Apex”), and not all pages use it.

## Fix design (what we’ll change)

### A) Fix deal entry so users can type full numbers (30,000 / 20,000 etc.)
We’ll update **`ALPCalculator.tsx`** so that:
1. The **active input row stays visible while typing**, even if the amount is > 0.
2. A deal becomes a bubble **only after the user “commits” it** by:
   - pressing Enter, or
   - clicking an explicit “+ Add” button (important for mobile keyboards that don’t expose Enter clearly).
3. Submitting the overall “Submit Numbers” form will still include the currently typed value even if they forgot to press “+ Add”.
   - This is critical so people don’t lose their last typed deal.

**Implementation approach (simple, robust):**
- Keep the current `deals` array, but treat the **last deal** as the “active draft”.
- Render bubbles only for “committed” deals = `deals.slice(0, -1)` (filtering out invalid/zero).
- Keep calculations (`totalALP` + `dealCount`) including **all** deals with amount > 0 (including the active draft) so the parent form always has the correct totals.
- When the user commits (Enter or “+ Add”):
  - If the active deal has a valid amount, append a new empty deal row, making the previous active one now “committed” and eligible to display as a bubble.

**Also**: add `e.stopPropagation()` in the keydown handler so Enter doesn’t bubble to the parent `<form>` and submit the entire production form unexpectedly.

Files involved:
- `src/components/dashboard/ALPCalculator.tsx`
- (indirectly used by) `src/components/dashboard/ProductionEntry.tsx`

### B) Remove the “Admin View — … testing purposes” banner from the Agent Portal
We’ll remove that notice block from **`src/pages/AgentPortal.tsx`**.

We will keep the underlying ability for admins/managers to access the portal if you still need it operationally, but the UI copy will no longer claim it’s “for testing purposes”.

Files involved:
- `src/pages/AgentPortal.tsx`

### C) Make all full-screen loading states show “Powered by Apex” + pulsing Apex logo
We’ll standardize full-page loaders to use one branded component.

Plan:
1. Update `SkeletonLoader`’s `variant="page"` copy to exactly:
   - **“Powered by Apex”**
2. Make the “page” loader show a pulsing Apex mark (either:
   - the current Crown icon (already present), updated to match branding text, or
   - the existing `apex-icon.png` for a true logo pulse if you prefer).
3. Replace full-page `Loader2`/spinner loaders with `SkeletonLoader variant="page"` in:
   - `src/components/ProtectedRoute.tsx`
   - `src/pages/Numbers.tsx`
   - `src/pages/AgentPortal.tsx`
   - (optional sweep) any other route-level loaders found by searching for `min-h-screen` + `animate-spin`

Files involved:
- `src/components/ui/skeleton-loader.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/Numbers.tsx`
- `src/pages/AgentPortal.tsx`

## Step-by-step implementation checklist

### 1) Fix ALPCalculator deal input
- Rewrite `completedDeals` logic so it does NOT immediately include the currently edited row.
- Introduce an “active deal” concept (last item).
- Add a visible “+ Add” button that commits the current deal.
- Update Enter handling to:
  - `preventDefault()`
  - `stopPropagation()`
  - commit current deal (append empty row) if valid.
- Ensure totals (`onALPChange`, `onDealsChange`) always reflect:
  - committed deals + current active typed deal (if > 0).

### 2) Remove the admin testing banner
- Delete the “Admin Notice” section that renders:
  - “Admin View — You are viewing the Agent Portal for testing purposes”
- Ensure no other parts of the portal rely on that message for layout spacing.

### 3) Loading screen branding pass
- Update `SkeletonLoader` page variant text to “Powered by Apex”.
- Replace full-screen spinners in:
  - ProtectedRoute
  - Numbers
  - AgentPortal
- Keep button-level spinners (like “Saving…”) as-is, since those are not “loading screens” and shouldn’t be replaced with full-screen UI.

## How we’ll verify it’s fixed (manual QA)
1. Go to Agent Portal → Log Numbers → Deals:
   - Type “30000” in premium without pressing Enter.
   - Confirm the input does NOT turn into a bubble mid-entry.
   - Press “+ Add” (or Enter) and confirm it becomes a bubble afterward.
   - Add a second deal (e.g. “20000”) and confirm both appear correctly.
2. Submit Numbers:
   - Enter one deal but do NOT press “+ Add”.
   - Press “Submit Numbers”.
   - Confirm the saved ALP and deal count include that typed deal.
3. Confirm the admin testing banner no longer appears.
4. Trigger full-page loading states (hard refresh, logout/login, protected route redirect) and confirm:
   - Branded loader shows pulsing logo
   - Text reads exactly “Powered by Apex”

## Risks / notes
- This change intentionally shifts “bubble creation” from “any non-zero input” to “commit action”. That’s what prevents the 1-digit auto-bubble bug and matches your expected behavior.
- We will ensure submission still captures the last typed value even if not committed, so agents don’t lose data.
