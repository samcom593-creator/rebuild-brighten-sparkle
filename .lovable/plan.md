

# Fix Lead Visibility and Agent Onboarding Defaults

## Problem 1: Everyone Can See All Leads

Currently, the database access rule for the applications (leads) table includes a clause that lets ALL managers see unassigned leads (`assigned_agent_id IS NULL`). This means every manager on your team can view leads they shouldn't have access to.

**Fix:** 
- Remove the `OR (assigned_agent_id IS NULL)` clause from the manager viewing policy, so managers only see leads assigned to them or their downline
- Update the application submission flow to automatically assign all new leads to you (the admin) by default, so they never sit in an "unassigned" state visible to everyone
- This means you'll own every lead by default, and only leads you explicitly reassign will be visible to other managers

## Problem 2: New Agents Start as "Live" Instead of Step 1

When agents are created from the leaderboard (the "Create Agent from Leaderboard" function), they're being set to `onboarding_stage: "evaluated"` (which is the final "Live" stage) and `status: "active"`. They should start at the first step ("Onboarding") like every other agent.

**Fix:**
- Change the leaderboard agent creation function to set `onboarding_stage: "onboarding"` instead of `"evaluated"`
- This ensures every new agent starts at Step 1 regardless of how they're added, and you can manually advance them through Onboarding, In Course, Field Training, and Live

## Technical Details

### Database Migration (RLS Policy Update)

Update the "Managers can view their team applications" policy to remove the unassigned leads clause:

```sql
-- Drop and recreate the manager view policy without the NULL clause
DROP POLICY "Managers can view their team applications" ON applications;
CREATE POLICY "Managers can view their team applications"
ON applications FOR SELECT
USING (
  has_role(auth.uid(), 'manager') AND (
    assigned_agent_id = get_agent_id(auth.uid()) 
    OR assigned_agent_id IN (
      SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);
```

### Edge Function: submit-application

Auto-assign the admin's agent_id to new applications so leads are always owned by you.

### Edge Function: create-agent-from-leaderboard

Change line 138 from:
- `onboarding_stage: "evaluated"` to `onboarding_stage: "onboarding"`

### Files to Modify

| File | Change |
|------|--------|
| Database migration | Remove `assigned_agent_id IS NULL` from manager SELECT policy on applications |
| `supabase/functions/create-agent-from-leaderboard/index.ts` | Change onboarding_stage from "evaluated" to "onboarding" |
| `supabase/functions/submit-application/index.ts` | Auto-assign admin agent_id to new applications |

