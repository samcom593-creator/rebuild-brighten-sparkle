
# Fix Coursework Login and Access -- Root Cause Analysis and Fixes

## Problems Found

### 1. Duplicate Agent Records Breaking Login
Johnivan Bush (jbbush3736@gmail.com) has TWO separate agent records pointing to the same user_id. When the course page queries for the agent with `.maybeSingle()`, this can cause unpredictable behavior -- sometimes returning one record, sometimes the other, or erroring out entirely. This is the biggest blocker.

**Fix:** Clean up duplicate agent records in the database. Merge or delete the duplicate, keeping the one with the most recent activity. Add a unique constraint on `agents.user_id` to prevent future duplicates.

### 2. Onboarding Stage Not Set Correctly
5 agents have `has_training_course = true` but their `onboarding_stage` is still `onboarding` instead of `training_online`. This means:
- The auto-redirect after login (which checks for `training_online`) never fires
- These agents land on the generic portal instead of the course

**Fix:** 
- Update all agents with `has_training_course = true` and `onboarding_stage = 'onboarding'` to `training_online`
- Change the redirect logic in `AgentNumbersLogin.tsx` to check `has_training_course` as the primary condition (not rely on exact stage matching)

### 3. Magic Link OTP Expiring Too Fast  
The auth logs show `otp_expired` errors. The flow is: verify-magic-link generates an OTP hash via `admin.generateLink()`, returns it to the browser, then the browser calls `verifyOtp()`. If there's any delay (slow network, user not clicking immediately), the OTP expires.

**Fix:** In `MagicLogin.tsx`, add retry logic -- if `verifyOtp` fails with `otp_expired`, automatically call the edge function again to get a fresh OTP hash and retry once.

### 4. Course Page Agent Lookup Too Fragile
The OnboardingCourse page uses `.maybeSingle()` to find the agent, which fails silently with duplicates. It also shows "Course Access Required" immediately if no agent is found, with no fallback.

**Fix:** Change to `.limit(1).order('created_at', { ascending: false })` to always get the most recent agent record, and add a brief retry/loading state instead of immediately showing the error.

---

## Technical Changes

### Database Cleanup (Migration)
- Delete duplicate agent records (keep newest per user_id)  
- Fix `onboarding_stage` for agents stuck at `onboarding` but with `has_training_course = true`

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/AgentNumbersLogin.tsx` | Fix redirect logic: check `has_training_course` instead of requiring exact `training_online` stage |
| `src/pages/Login.tsx` | Same redirect fix |
| `src/pages/MagicLogin.tsx` | Add OTP retry logic on `otp_expired` error; fix destination display text for course |
| `src/pages/OnboardingCourse.tsx` | Use `.limit(1)` instead of `.maybeSingle()` for agent lookup; add retry on failure |
| `src/hooks/useOnboardingCourse.ts` | No changes needed -- works correctly once agent_id is passed |

### Edge Function Changes
None needed -- the `verify-magic-link` function works correctly. The issue is on the client side consuming the OTP hash.
