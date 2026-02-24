
## Goals (based on your message)
1) **Calendar + “ad effects” redesign**: make the Calendar page, Notification Hub, and Recruiter HQ feel premium and visually consistent (better spacing, backgrounds, motion, hierarchy).
2) **Aged leads duplicate merge is still not working**: fix it *for real* so “49 duplicates” can always be resolved with one click (and data is merged correctly, not just randomly deleted).
3) **Notifications / blasts workflow**
   - When an SMS auto-detect delivery succeeds, **auto-save the carrier** (no manual “mark carrier” step).
   - Always offer a **Continue Previous Flow** and make it **auto-resume** if you return mid-blast.
   - Enforce **one boost at a time** (no overlapping blasts / confusing states).

---

## What I found in the codebase (why this is happening)
### A) Carrier marking is currently manual
- `src/pages/NotificationHub.tsx` has a `MarkDeliveredButton` that appears for `sms-auto` logs and makes you manually save `carrier` onto the application.
- The backend function `send-sms-auto-detect` logs the carrier guess to `notification_log.metadata`, but **does not update** the application’s `carrier` column automatically.

### B) Aged lead “merge duplicates” isn’t a real merge
- `/dashboard/aged-leads` shows a duplicates count that matches the real database number (**49 duplicate records**).
- The “merge” behavior in `src/pages/DashboardAgedLeads.tsx` mostly **deletes extras** and doesn’t reliably:
  - keep the *best* record (latest contact),
  - merge notes,
  - preserve meaningful fields/timestamps.
- There’s also duplicate tooling in `src/components/admin/DuplicateMergeTool.tsx`, but it’s frontend-driven and can be fragile.

### C) Blast resume exists, but flow isn’t strict enough
- The blast persistence + “Continue Blast” UI exists in `NotificationHub` (`apex_blast_progress` in localStorage).
- But “one boost at once” isn’t enforced across other blast actions, and auto-resume behavior isn’t implemented.

---

## Clarified rules (from your answers)
- **Carrier auto-save rule:** “Save best guess”
- **Aged lead duplicate merge default:** “Auto keep best”

So we will implement deterministic “best guess” + “auto keep best” behavior.

---

## Implementation Plan

### 1) Auto-save carrier when SMS auto-detect succeeds (no manual marking)
**Backend function to update:** `supabase/functions/send-sms-auto-detect/index.ts`

**Change:**
- Track which gateways succeeded.
- Pick a **best-guess carrier** using a priority score (major carriers weighted higher).
- If this SMS attempt was tied to an `applicationId` and that application’s `carrier` is currently null:
  - **Update `applications.carrier` automatically**.
- Also write extra metadata to the log so we can audit:
  - `carrier_selected`
  - `carrier_successes` (list)
  - `carrier_failures` (list)

**Best-guess scoring (example)**
We’ll create a priority map like:
- att=100, verizon=95, tmobile=90, sprint=80, uscellular=70, cricket=60, metro=50, boost=40  
Then pick the highest-scoring carrier among successes.

**Safety**
- Never overwrite an existing carrier automatically.
- Only set carrier if the lead is an application (aged leads don’t have a carrier column).

**Result**
- The system “just does it” when delivery succeeds; you don’t have to confirm.

---

### 2) Notification Hub: enforce “one boost at once” + auto-resume flow
**File:** `src/pages/NotificationHub.tsx`

#### 2.1 Auto-resume behavior
- On page load, if `apex_blast_progress` exists and is incomplete:
  - automatically switch to the **Bulk Blast tab**
  - show a persistent “Resuming…” banner
  - start a short countdown (e.g., 3 seconds) then auto-run `handleResume()`
  - include a **Cancel Auto-Resume** button (so you can stop it if you opened it by accident)

#### 2.2 Single-boost lock
When either:
- `blasting === true`, OR
- `savedProgress` exists (unfinished blast)

Then:
- Disable / grey out **all other “blast-like” actions**:
  - QuickActionCards send buttons
  - CarrierAssignment “Auto-Blast All”
  - Starting a new Bulk Blast
- Replace disabled buttons with a tooltip / helper text:
  - “Finish or discard the current boost first.”

This makes it impossible to create overlapping campaigns that confuse progress stats.

#### 2.3 Remove the manual carrier “Mark delivered” step from the main UX
- Since carrier will be auto-saved, we will:
  - hide `MarkDeliveredButton` by default, or
  - convert it into an “Override carrier” admin-only action (rarely needed)
- Add a small indicator in the expanded log row showing:
  - “Carrier auto-saved: Verizon” (if we saved it)
  - or “Carrier guess logged (not saved)” (if no applicationId / already had carrier)

---

### 3) Fix aged lead duplicate merging so it always works (true merge, not just delete)
We’ll make this **backend-driven** so it cannot silently fail or depend on fragile client-side loops.

#### 3.1 Create a dedicated backend function to dedupe aged leads
**New backend function:** `supabase/functions/dedupe-aged-leads/index.ts`

**Permissions:**
- Requires signed-in user + checks role is admin in the database (same pattern as `merge-agent-records`).

**What it does:**
- Pull aged leads needed fields: `id, email, phone, notes, motivation, instagram_handle, about_me, status, license_status, contacted_at, last_contacted_at, assigned_manager_id, created_at, processed_at`
- Normalize keys:
  - `email_key = lower(trim(email))` (non-empty only)
  - `phone_key = last 10 digits` (valid 10-digit only)
- Build duplicate groups:
  - group by email_key when present, otherwise by phone_key
- For each group:
  - **Keeper selection (“auto keep best”)**
    1) Latest `last_contacted_at`
    2) Fallback newest `created_at`
  - **Merge strategy**
    - `last_contacted_at` = max of group
    - `contacted_at` = earliest non-null (first time contacted)
    - `notes` = concatenate unique notes blocks (dedupe identical text)
    - `motivation/about_me/instagram_handle/assigned_manager_id` = fill missing keeper fields from duplicates
    - `status` = keep the “most advanced” status using a simple rank order (so “contacted” beats “new”, etc.)
    - `license_status` = prefer non-unknown / more advanced if present
  - Update keeper with merged fields
  - Delete the other records
- Return a summary:
  - groups merged, records deleted, keeper ids updated

This will permanently stop the “49 duplicates but can’t merge” situation.

#### 3.2 Wire the Aged Leads page to use this backend function
**File:** `src/pages/DashboardAgedLeads.tsx`

- Replace the current “Merge All Duplicates” logic with a single button that calls `dedupe-aged-leads`.
- Add proper UI states:
  - loading spinner + progress copy (e.g., “Merging duplicate groups…”)
  - success toast: “Merged 23 groups, removed 49 duplicate records”
- After success:
  - refetch leads
  - duplicates count should drop to 0

(Optional but recommended)
- Add a “Preview” section that shows the top 5 groups that would be merged (read-only) before you run it.

---

### 4) Calendar + “ad effects” redesign (Calendar page, Notification Hub, Recruiter HQ)
You selected: **Calendar page + Notification Hub + Recruiter HQ**.

We’ll implement a small shared visual system so these feel like one cohesive app.

#### 4.1 Create reusable visual helpers
**New component:** `src/components/ui/BackgroundGlow.tsx` (or similar)
- Provides consistent:
  - radial gradients
  - soft glow blobs (static, not infinite animation)
  - optional accent theme (blue / amber / pink)

This avoids ad-hoc “effects” scattered everywhere.

#### 4.2 Calendar page polish
**File:** `src/pages/CalendarPage.tsx`
- Upgrade header to a premium layout (like NotificationHub):
  - stronger title block, secondary stats, cleaner spacing
- Make interview cards more consistent:
  - unified badge sizing
  - clearer action buttons (calendar link, meeting link, no-show)
- Improve the “Schedule” dialog:
  - clearer “Find lead → Schedule” flow
  - make “Add New Applicant” form look intentional (card within dialog, helper text)
- Reduce heavy motion:
  - keep subtle enter animations only
  - avoid anything infinite

#### 4.3 Notification Hub polish (blast / resume / progress)
**File:** `src/pages/NotificationHub.tsx`
- Make the Resume/Auto-Resume banner feel like a command-center “active operation”
- Improve blast progress visuals:
  - clearer percent + ETA copy
  - cleaner stats cards
- Ensure disabled actions (single-boost lock) look intentional, not broken

#### 4.4 Recruiter HQ “ad effects” polish
**File:** `src/pages/RecruiterDashboard.tsx`
- Replace scattered gradient blobs with the shared BackgroundGlow
- Tighten spacing + typography to reduce “busy” feel
- Keep boosts badge crisp (no infinite animation); add subtle highlight only on change

---

## Files & Deliverables Checklist
### Backend functions
- **MODIFY** `supabase/functions/send-sms-auto-detect/index.ts` (auto-save carrier best guess)
- **NEW** `supabase/functions/dedupe-aged-leads/index.ts` (admin-only true merge)

### Frontend
- **MODIFY** `src/pages/NotificationHub.tsx` (auto-resume + one-boost lock + carrier UX cleanup)
- **MODIFY** `src/pages/DashboardAgedLeads.tsx` (use dedupe function; reliable merge)
- **MODIFY** `src/pages/CalendarPage.tsx` (visual redesign)
- **MODIFY** `src/pages/RecruiterDashboard.tsx` (visual redesign)
- **NEW** `src/components/ui/BackgroundGlow.tsx` (shared “ad effects” system)

---

## Acceptance tests (what you’ll be able to verify)
1) **Carrier auto-save**
   - Run an SMS auto-detect send tied to an application
   - Confirm the application now has `carrier` filled automatically (no manual step)

2) **Blast resume**
   - Start a bulk blast, refresh mid-way
   - Return to Notification Hub → it auto-resumes (with cancel option)
   - All other boost actions remain locked until finished/discarded

3) **Aged leads duplicates**
   - On Aged Leads page, duplicates show “49” initially
   - Click “Merge All Duplicates”
   - After completion: duplicates drop to 0 and notes are preserved on the keeper records

4) **Visual polish**
   - Calendar / Notification Hub / Recruiter HQ look consistent:
     - cleaner spacing
     - intentional gradients/glows
     - no laggy infinite animations
