

# Show Referrer Info in Call Center

## Problem
When processing leads in the Call Center, you can't see who referred each applicant. This risks accidentally reassigning or processing someone else's lead.

## Solution
Add a "Referred By" field to the Call Center lead card showing the referring agent/manager name.

### Changes

**1. `src/pages/CallCenter.tsx`** — Fetch referrer name
- For `applications`: include `assigned_agent_id` in the select, then join to get the agent's name via a second lookup or by selecting `agents!assigned_agent_id(first_name, last_name)` — but since `applications.assigned_agent_id` references `agents.id`, use a nested select: `.select("..., agents!assigned_agent_id(first_name, last_name)")`
- For `aged_leads`: include `assigned_manager_id`, do a similar join or batch-resolve manager names from the agents table
- Map the result into a new `referredBy` field on `UnifiedLead`

**2. `UnifiedLead` interface** (in both `CallCenter.tsx` and `CallCenterLeadCard.tsx`)
- Add `referredBy?: string` field

**3. `src/components/callcenter/CallCenterLeadCard.tsx`** — Display referrer
- Add a badge/row in the header area showing "Referred by: [Agent Name]" with a `User` icon
- Style it as a subtle info badge so it's immediately visible without cluttering the card

**4. `src/components/dashboard/CallModeInterface.tsx`** — Same treatment
- Add `referredBy` to the simpler `Lead` interface and display it in the lead card section

### Technical Detail
The `applications` table has `assigned_agent_id` referencing `agents.id`. Supabase PostgREST supports embedded selects:
```ts
.select("id, first_name, ..., assigned_agent_id, agents!applications_assigned_agent_id_fkey(first_name, last_name)")
```
If the FK name doesn't work cleanly, fall back to a separate batch query for agent names by collecting all unique `assigned_agent_id` values and fetching from `agents` in one call.

For `aged_leads`, similarly resolve `assigned_manager_id` → agent name.

