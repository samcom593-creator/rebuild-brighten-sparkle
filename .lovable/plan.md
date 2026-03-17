

# Fix Course "Access Denied" Issue

## Root Cause

The `current_agent_id()` database function (used in all `onboarding_progress` RLS policies) does `SELECT id FROM agents WHERE user_id = auth.uid() LIMIT 1` with **no ORDER BY**. Meanwhile, the OnboardingCourse page fetches the agent ID with `ORDER BY created_at DESC` (newest first).

When an agent has duplicate records (common from legacy data), these two queries can return **different agent IDs**. The page uses one ID, but RLS checks against a different one — silently blocking all SELECT, INSERT, and UPDATE operations on `onboarding_progress`. The agent sees modules but has zero progress and can't save anything, or sees "Course Access Required" if the agents query itself returns nothing.

Additionally, the magic link tokens from course enrollment emails expire or get marked as "already used" (visible in edge function logs), so agents clicking the email link a second time see an error page they interpret as "access denied."

## Fix Plan

### 1. Database Migration — Fix `current_agent_id()` ordering
Update the function to use `ORDER BY created_at DESC` so it consistently returns the newest agent record, matching the frontend logic.

```sql
CREATE OR REPLACE FUNCTION public.current_agent_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = public
  SET row_security = 'off'
AS $$
  SELECT id
  FROM public.agents
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;
$$;
```

Also fix `get_agent_id()` and `current_manager_agent_id()` with the same ordering for consistency.

### 2. OnboardingCourse.tsx — Better error handling
- When `agentNotFound` is true, show a "Sign in manually" button linking to `/agent-login` instead of just telling them to contact their manager
- Add a direct login link so agents who land on an error can recover

### 3. MagicLogin.tsx — Improve expired token UX  
The magic link error page already has a "Sign In Manually" button, which is good. No changes needed here.

### Files to modify
- **DB migration**: Fix `current_agent_id()`, `get_agent_id()`, and `current_manager_agent_id()` ordering
- **`src/pages/OnboardingCourse.tsx`**: Add fallback sign-in button on the "Course Access Required" screen

