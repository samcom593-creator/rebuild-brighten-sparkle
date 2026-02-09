
# Fix Agent Consistency Across All Modules

## Problem
Agents added via the "Add Agent" flow or ContractedModal appear in the Dashboard and CRM but are invisible in the Command Center. The root cause: the `add-agent` edge function never sets `profile_id` on the agent record. The Command Center joins profiles via `profile_id` (`profiles!agents_profile_id_fkey`), so agents without it show as "Unknown" and get filtered out by the name validation rule.

Currently 5 out of 17 active agents are missing `profile_id` and are invisible in the Command Center.

## Changes

### 1. Fix the `add-agent` edge function to set `profile_id`
**File: `supabase/functions/add-agent/index.ts`**

After inserting the profile record, fetch its `id` and include `profile_id` in the agent insert. This ensures every newly created agent is immediately visible across all modules.

### 2. Backfill existing agents missing `profile_id`
**Database migration**

Run a one-time UPDATE to set `profile_id` for agents that have a `user_id` matching a profile but are missing the `profile_id` link:

```sql
UPDATE agents SET profile_id = p.id
FROM profiles p
WHERE agents.user_id = p.user_id
AND agents.profile_id IS NULL;
```

### 3. Ensure Command Center fallback for user_id join
**File: `src/pages/DashboardCommandCenter.tsx`**

Update the agent query to also join profiles by `user_id` as a fallback when `profile_id` is null, so even if a future edge case causes a missing `profile_id`, the agent still appears with the correct name.

## Technical Details

| File | Change |
|------|--------|
| `supabase/functions/add-agent/index.ts` | After profile insert, query profile `id` and set `profile_id` on agent record |
| `src/pages/DashboardCommandCenter.tsx` | Add fallback profile lookup via `user_id` when `profile_id` join returns null |
| Database migration | Backfill `profile_id` for 5 existing agents |

This ensures that every agent created from any entry point (Add Agent modal, ContractedModal, signup flow) is immediately and consistently visible across Dashboard, CRM, Command Center, and Agent Portal.
