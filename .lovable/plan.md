

# Full Site Audit — Findings & Fix Plan

## Issues Found

### 1. partial_applications 401 Errors (Blocks Partial Save on Apply Page)
**Severity: Medium** — The `savePartialApplication` function in `Apply.tsx` (line 234) does a client-side `supabase.from("partial_applications").upsert(...)`. Unauthenticated users (applicants aren't logged in) get **401 errors** from PostgREST. The RLS policies exist but the `anon` role likely lacks `GRANT` permissions on the table. This doesn't block the final submission (which uses the edge function with service role), but it means:
- Console is spammed with 401 errors on every step transition
- Partial application tracking (abandoned form recovery) silently fails

**Fix:** Grant `INSERT` and `UPDATE` on `partial_applications` to the `anon` role, and also grant `SELECT` for upsert to work.

### 2. React Fragment Missing Key in NotificationHub
**Severity: Low** — In `NotificationHub.tsx` line 222-271, `paged.map()` renders a bare `<>` fragment wrapping two `<TableRow>` elements. The fragment has no `key` prop, which causes React warnings and potential rendering issues.

**Fix:** Replace `<>` with `<Fragment key={log.id}>` (import `Fragment` from React).

### 3. Application Flow — Verified Working
I tested the full Apply flow on a 390x844 mobile viewport:
- Step 1 (Personal Info) ✓
- Step 2 (Experience) ✓
- Step 3 (Licensing) ✓
- Step 4 (Goals + SMS Consent) ✓
- Submission → Step 5 (Referral) ✓

The `submit-application` edge function logs confirm successful recent submissions. **The apply flow itself works correctly.** If people are saying they "can't apply," it's likely:
- They hit a duplicate check (email/phone already on file) and see the error
- They missed the SMS consent checkbox and don't scroll down to see the error
- The 401 console errors on partial save are not blocking but are noise

### 4. NotificationHub & Accounts — Code Review Pass
Both pages look solid after the recent overhaul. No runtime errors found. The Notification Hub stats, pagination, quick actions, and blast functionality are all properly wired.

### 5. ScheduleBar — Code Review Pass  
Dismiss functionality, sound effects, and pulse animation all look correct.

---

## Technical Changes

### Database Migration
```sql
-- Grant anon role access to partial_applications for unauthenticated form saves
GRANT SELECT, INSERT, UPDATE ON public.partial_applications TO anon;
```

### File: `src/pages/NotificationHub.tsx`
- Line 222: Replace bare `<>` fragment with `<Fragment key={log.id}>` 
- Add `import { Fragment }` to React imports (or use `React.Fragment`)

### Files NOT Changed (verified working)
- `src/pages/Apply.tsx` — full flow works end-to-end
- `supabase/functions/submit-application/index.ts` — confirmed successful submissions in logs
- `src/pages/DashboardAccounts.tsx` — no errors found
- `src/components/layout/ScheduleBar.tsx` — no errors found

