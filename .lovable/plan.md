
# Automate Licensing + Course Emails on Hire & Contract Actions

## Problem
When clicking "Hired" in the Pipeline (DashboardApplicants), the system only sends a generic follow-up email. It does NOT send licensing instructions or course enrollment emails. The Call Center already does this correctly -- the Pipeline needs to match that behavior.

When clicking "Contract" (via ContractedModal), the contracted email is sent but course enrollment is not triggered automatically.

## Changes

### 1. Pipeline "Hired" Button (`src/pages/DashboardApplicants.tsx`)

Add to `handleMarkAsHired` (after the existing hire email logic, around line 309):

- **Send licensing instructions** for unlicensed/unknown applicants (same pattern as CallCenter lines 342-351):
  ```
  supabase.functions.invoke("send-licensing-instructions", { body: { email, firstName, licenseStatus } })
  ```

- **Send course enrollment email** -- since the applicant isn't an agent yet at hire time, we can't call `send-course-enrollment-email` (it needs an agentId). Instead, we send licensing info which is the appropriate action at hire stage. The course enrollment happens later when they're formally added to the course.

### 2. Contract Action (`src/components/dashboard/ContractedModal.tsx`)

Add after the contracted email is sent (around line 143), a call to automatically send course enrollment:

```
supabase.functions.invoke("send-course-enrollment-email", { body: { agentId: newAgentId } })
```

This uses the `newAgentId` already returned from the `add-agent` edge function. It sends the agent their training course magic link immediately upon contracting.

Also automatically set `has_training_course: true` on the new agent record so they show up in the Course Progress monitor. This can be done by adding it to the `add-agent` call body or updating the agent record after creation.

### 3. Update `add-agent` Edge Function (`supabase/functions/add-agent/index.ts`)

Check if the edge function already accepts and sets `has_training_course`. If not, add support for an `enrollInCourse` flag that sets `has_training_course = true` on the new agent record during creation.

## Summary of Automated Flows

**On "Hired" click:**
1. Mark application as hired (already works)
2. Send follow-up email (already works)
3. Send hire announcement (already works)
4. **NEW: Send licensing instructions** (for unlicensed applicants)

**On "Contract" click:**
1. Create agent record via add-agent (already works)
2. Mark application as contracted (already works)
3. Send contracted email with CRM link (already works)
4. Send hire announcement (already works)
5. **NEW: Send course enrollment email** with magic link
6. **NEW: Set has_training_course = true** on agent

## Files to Modify
- `src/pages/DashboardApplicants.tsx` -- add licensing instructions call in `handleMarkAsHired`
- `src/components/dashboard/ContractedModal.tsx` -- add course enrollment email + update has_training_course after contracting
