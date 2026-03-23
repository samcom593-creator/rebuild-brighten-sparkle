

# Allow Multiple Applications from the Same Person

## Problem
The `submit-application` edge function blocks duplicate submissions by checking for existing applications with the same email or phone number (lines ~858-899). The `Apply.tsx` page also shows a "duplicate error" banner when a 409 response is received.

## Changes

### 1. `supabase/functions/submit-application/index.ts`
Remove the duplicate-check logic that returns 409 errors:
- Remove the email duplicate check (lines ~860-878)
- Remove the phone duplicate check (lines ~881-903)
- Allow the insert to proceed regardless of existing applications

### 2. `src/pages/Apply.tsx`
- Remove the `duplicateError` state and the duplicate error banner UI (lines ~105, 436-447, 571-576)
- Remove the 409-specific error handling — treat all errors uniformly

### Files Modified
- `supabase/functions/submit-application/index.ts` — Remove duplicate checks
- `src/pages/Apply.tsx` — Remove duplicate error UI/handling

