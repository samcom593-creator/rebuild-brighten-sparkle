

# Fix: Managers Can't See Their Team's Applications

## Root Cause

The RLS policy on the `applications` table has **no manager-level SELECT policy**. Managers are treated identically to agents — they can only see applications where `assigned_agent_id` matches their own agent ID.

This means Obi (agent `136ee983`) can see applications assigned directly to him, but **cannot** see applications assigned to his sub-agents like Chukwudi (`a60e70c5`), Mitchell, or Brennan — even though those agents have `invited_by_manager_id = '136ee983'`.

The data confirms this: Obi has 3 sub-agents with applications assigned to them, but those applications are invisible to Obi because of the missing RLS policy.

Additionally, when applicants select a referral agent who is a sub-agent (not a manager), the application is correctly assigned to that sub-agent. But there's no RLS path for the manager above them to see it.

## Fix

### 1. Add Manager SELECT Policy on `applications`

Add a new RLS policy that lets managers see all applications assigned to:
- Themselves (their own agent ID)
- Any agent in their team (`invited_by_manager_id = their agent ID`)

```sql
CREATE POLICY "Managers can view team applications"
ON public.applications
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents 
      WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);
```

### 2. Add Manager UPDATE Policy on `applications`

Managers also need to update their team's applications (mark as contacted, hired, etc.):

```sql
CREATE POLICY "Managers can update team applications"
ON public.applications
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents 
      WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents 
      WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);
```

### Summary

| Change | Detail |
|--------|--------|
| Database migration | Add 2 RLS policies (SELECT + UPDATE) for managers on `applications` table |
| No code changes needed | The dashboard query already does `select *` for managers — the RLS was the only blocker |

This is a pure RLS fix. Once deployed, Obi and all managers will immediately see their full team's applications without any frontend changes.

