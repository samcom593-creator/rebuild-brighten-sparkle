

# Fix: Auto-Provision is Fundamentally Broken — Replace with Self-Service Edge Function

## Root Cause (Two Blockers)
The current auto-provisioning in `OnboardingCourse.tsx` calls `add-agent`, which **always fails** for regular agents:

1. **Line 69**: `add-agent` requires admin/manager role → returns **403** for regular agents
2. **Line 112**: `add-agent` checks if profile already exists → returns **409** because the user already has a profile from the auth trigger

So the "auto-provision" code silently fails every time, and the user sees "Course Access Pending."

## Fix: New `self-enroll-course` Edge Function

Create a dedicated edge function that any authenticated user can call to self-provision:

1. Validates the calling user's JWT (no admin/manager requirement)
2. Checks if user already has an agent record → if yes, just sets `has_training_course = true` and returns
3. If no agent record, checks `applications` table for a matching email with `license_status = 'licensed'`
4. If found, creates the agent record using the service role key (handles existing profile via upsert)
5. Returns the new agent ID so the course page can proceed

### `supabase/functions/self-enroll-course/index.ts`
- Authenticates via JWT
- Looks up profile by `user_id` to get email
- Checks for existing agent record → updates `has_training_course` if found
- If no agent, queries `applications` for licensed match
- Creates agent record linked to the existing profile (no profile delete/recreate)
- Sets `has_training_course: true`, `onboarding_stage: training_online`

### `src/pages/OnboardingCourse.tsx`
- Replace the broken `add-agent` call with `self-enroll-course`
- Remove the "Course Access Pending" dead-end entirely
- If `self-enroll-course` succeeds → refresh and show course
- If no licensed application found → show "Your manager hasn't marked you as licensed yet"

### Also fix the 9 existing orphaned licensed applications
Run a one-time data fix via the new function or direct SQL to provision agent records for the 9 people currently stuck (Jordan McClendon, Jacob Causer, Deja Kelly, Pierre Auguste, Maddox Wilson, Tymere Mays, Terrance Brown, KJ Vaughns, etc.).

## Files
- **New**: `supabase/functions/self-enroll-course/index.ts`
- **Edit**: `src/pages/OnboardingCourse.tsx` — use new function instead of `add-agent`

