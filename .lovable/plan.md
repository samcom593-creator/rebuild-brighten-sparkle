

# Fix Application Form + Login/Coursework Issues

## Issue 1: Application Form - State Select Still Uncontrolled (CRITICAL)

The previous fix added `value` props to the Availability and Referral Source Selects on Step 4, but **missed the State Select on Step 1** (line 650). This is likely the #1 cause of "can't apply" reports.

**What happens:**
1. User fills out Step 1, selects a State (e.g., Georgia)
2. Moves to Steps 2, 3, 4
3. On Step 4, clicks "Continue"
4. `handleSubmit` validates ALL fields across all steps
5. The `state` field is empty because the Select lost sync with sessionStorage or form state
6. Form silently fails -- the toast says "Please go back and fix: state" but users may miss it or not understand

**Fix:** Add `value={watch("state") || undefined}` to the State Select on Step 1 (same pattern as the availability/referralSource fix).

**File**: `src/pages/Apply.tsx` (line 650)

---

## Issue 2: Coursework Login - Agents Hitting Wrong Login Page

Agents trying to access coursework are likely going to `/login` (the admin/manager login page), which requires them to know their email + password. Many agents were set up without passwords (via the simple-login/magic-link flow).

**Current state:**
- `/login` -- Email + password only (for admins/managers)
- `/agent-login` -- Smart flow: identifier lookup, password setup, account creation
- Coursework at `/onboarding-course` -- Requires authentication

Agents who don't have passwords set up will fail at `/login` with "Invalid login credentials" and have no recovery path shown.

**Fix:** Add a prominent link/button on the `/login` page directing agents to the correct login page (`/agent-login`). This ensures agents who land on the wrong page can quickly get to the right flow.

**File**: `src/pages/Login.tsx`

---

## Issue 3: Coursework Access - No Agent Record = Empty Course

The `/onboarding-course` page fetches `agentId` from the `agents` table using `user_id`. If a user authenticates but has no agent record (e.g., they logged in via Google OAuth or signed up directly), `agentId` stays `null`, progress never loads, and they see a confusing "Course Coming Soon" message even though modules exist.

**Fix:** Show a clear message when the user is authenticated but has no agent record, telling them to contact their manager or admin for enrollment instead of showing "Course Coming Soon."

**File**: `src/pages/OnboardingCourse.tsx`

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/Apply.tsx` | Add `value={watch("state") \|\| undefined}` to State Select on Step 1 (line 650) |
| `src/pages/Login.tsx` | Add "Agent? Log in here" link pointing to `/agent-login` |
| `src/pages/OnboardingCourse.tsx` | Show "Contact your manager for course access" when no agent record found instead of "Course Coming Soon" |

