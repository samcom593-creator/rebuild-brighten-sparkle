

# Fix: Can't Add Agents to Course

## Root Cause

The `onboarding_progress` table's INSERT RLS policy only allows agents to insert their **own** progress:

```sql
CREATE POLICY "Agents can insert own progress"
ON public.onboarding_progress FOR INSERT
WITH CHECK (agent_id = current_agent_id());
```

The "Admins can manage all progress" ALL policy covers admins, but there is **no INSERT policy for managers**. When a manager clicks "Add to Course" and tries to insert a progress record for another agent, RLS blocks it silently.

Additionally, the `AddAgentToCourseDialog` enrollment mutation only updates the agent's stage and sends a portal login email — it **doesn't create an initial `onboarding_progress` record**, so the agent won't appear in the course even if the stage update succeeds.

## Fix Plan

### 1. Add missing RLS policy for manager INSERT on `onboarding_progress`
Create a migration that allows managers to insert progress records for their team members:

```sql
CREATE POLICY "Managers can insert team progress"
ON public.onboarding_progress FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);
```

Also add manager UPDATE policy if missing (needed when re-enrolling).

### 2. Fix `AddAgentToCourseDialog` enrollment mutation
The bulk dialog currently only updates the agent's `onboarding_stage` and sends a portal login email. It needs to also:
- Create an initial `onboarding_progress` record (like `AddToCourseButton` does)
- Send the course enrollment email instead of the generic portal login email

### 3. Fix `AddToCourseButton` error handling
Add better error logging so silent RLS failures are surfaced to the user with actionable messages.

## Technical Details

- Migration: Add INSERT + UPDATE policies for managers on `onboarding_progress`
- `AddAgentToCourseDialog.tsx`: Add progress record creation (fetch first active module, insert progress row) before sending email; switch from `send-agent-portal-login` to `send-course-enrollment-email`
- Both components: Add explicit error checks on all Supabase calls and surface them via toast

