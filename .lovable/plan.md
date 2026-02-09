

# Sync Agent Creation and Add Last Contact Timeline Across All Views

## Problem
Three issues need fixing:

1. **ContractedModal creates broken agent records**: When contracting someone from the Call Center or Applicants page, it uses `crypto.randomUUID()` as the `user_id` instead of creating a real auth account. This means the agent has no login, no `user_roles` entry, and cannot receive magic links or appear properly across all modules.

2. **Add Agent modal and ContractedModal are not using the same backend**: The "Add Agent" button uses the `add-agent` edge function (which properly creates an auth user, profile, role, and agent record), but the ContractedModal does all this inline with incomplete logic.

3. **No "Last Contact" timeline in Dashboard roster or CRM**: The `LastContactedBadge` component exists but is only used for application cards. The Dashboard team view and CRM agent cards do not show when an agent was last contacted.

## Changes

### 1. Fix ContractedModal to use the `add-agent` edge function
**File: `src/components/dashboard/ContractedModal.tsx`**

Replace the manual `crypto.randomUUID()` + profile insert + agent insert logic with a call to the `add-agent` edge function, which already handles:
- Creating a real Supabase Auth user
- Creating the profile record
- Adding the `agent` role to `user_roles`
- Creating the agent record with proper `invited_by_manager_id`
- Sending the welcome email

After calling `add-agent`, update the application with `contracted_at` and `closed_at` timestamps as before, and save the CRM link to the newly created agent record.

### 2. Update `add-agent` edge function to accept optional `crmSetupLink`
**File: `supabase/functions/add-agent/index.ts`**

Add an optional `crmSetupLink` field to the request body. If provided, set `crm_setup_link` on the new agent record. This lets the ContractedModal pass the CRM link directly during creation.

Also add an optional `licenseProgress` field so the contracting flow can carry over the license progress stage from the application.

### 3. Add "Last Contact" timestamp to Dashboard Team View
**File: `src/components/dashboard/ManagerTeamView.tsx`**

- Fetch the `last_contacted_at` field from the `applications` table for each agent's assigned applications
- Display a small "Last contact: 2d ago" badge on each agent card (similar to how the `LastContactedBadge` component works, but inline)
- If no contact history exists, show "No contact yet" in muted text

### 4. Add "Last Contact" timestamp to CRM agent cards
**File: `src/pages/DashboardCRM.tsx`**

- The CRM already fetches agent data but does not show last contact info
- Add `last_contacted_at` to the `AgentCRM` interface
- Fetch the most recent `contact_history` entry for each agent's applications
- Display the last contact timestamp on each CRM card

## Technical Details

### ContractedModal refactor (key change)
Instead of:
```text
const newUserId = crypto.randomUUID();
// manual profile insert
// manual agent insert (no auth user, no user_roles)
```

Use:
```text
const { data } = await supabase.functions.invoke("add-agent", {
  body: {
    firstName: application.first_name,
    lastName: application.last_name,
    email: application.email,
    phone: application.phone,
    managerId: agentId,
    licenseStatus: finalLicenseStatus,
    crmSetupLink: linkToUse,
  }
});
```

### add-agent edge function update
- Add `crmSetupLink?: string` to the `AddAgentRequest` interface
- After creating the agent record, if `crmSetupLink` is provided, update the agent with `crm_setup_link`

### Dashboard/CRM last contact display
- Query `applications.last_contacted_at` for agents that have assigned applications
- Show relative time ("2h ago", "3d ago") inline on agent cards
- Use the same time formatting logic already in `LastContactedBadge`

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/add-agent/index.ts` | Add `crmSetupLink` and `licenseProgress` optional fields |
| `src/components/dashboard/ContractedModal.tsx` | Replace manual agent creation with `add-agent` edge function call |
| `src/components/dashboard/ManagerTeamView.tsx` | Add last contact timestamp display on agent cards |
| `src/pages/DashboardCRM.tsx` | Add last contact timestamp display on CRM cards |

