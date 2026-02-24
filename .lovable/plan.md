

# Fix: Manager Applications Not Appearing in Pipeline

## Root Cause

The application submission is a **two-step process**:
1. **Step 4**: Application is submitted → `assigned_agent_id` is hardcoded to the admin default (`7c3c5581-...` / Samuel James) on line 910 of `submit-application`
2. **Step 5**: Applicant selects "Who referred you?" → calls `update-application-referral` to reassign to the selected manager

**The bug is in `update-application-referral` (line 91-96)**:
```
if (app.assigned_agent_id) {
  return { error: "Referral already set", status: 409 };
}
```
Since every application already has `assigned_agent_id` set to the admin by step 4, this guard **always blocks** the referral reassignment. The manager is never actually assigned.

Additionally, a database trigger (`auto_assign_unassigned_application`) also sets `assigned_agent_id` to the admin on INSERT if null, so even removing the hardcoded default in step 4 would still cause the same problem.

This means **every application stays assigned to the admin** regardless of who the applicant selects as their referrer.

## Fix

**File: `supabase/functions/update-application-referral/index.ts` (line 91-96)**

Change the guard from "reject if any agent is assigned" to "reject only if a non-admin agent is already assigned." This allows the referral step to reassign from the admin default to the selected manager:

```typescript
// Allow reassignment if current assignment is the admin default
const ADMIN_DEFAULT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";

if (app.assigned_agent_id && app.assigned_agent_id !== ADMIN_DEFAULT_ID) {
  return new Response(
    JSON.stringify({ error: "Referral already set" }),
    { status: 409, headers: { ... } }
  );
}
```

This is the only change needed. No frontend, RLS, or schema changes required.

## Why This Fully Resolves the Issue

- When an applicant selects a manager (e.g., KJ Vaughns) on step 5, the update will now succeed
- `assigned_agent_id` gets set to that manager's agent ID
- The existing RLS policy (`assigned_agent_id = get_agent_id(auth.uid())`) already grants the manager full visibility
- Applications will immediately appear in the manager's pipeline/dashboard
- The admin can still see everything via the admin RLS policy

## Validation

After deploying, any new application where the applicant selects a manager as their referrer will correctly appear in that manager's pipeline. Existing applications that were supposed to go to specific managers remain assigned to admin and would need manual reassignment if desired.

