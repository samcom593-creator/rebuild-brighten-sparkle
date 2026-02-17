
# Fix: Samuel James Can't Log Production Numbers

## Root Cause

Samuel James (info@kingofsales.net) is marked as **deactivated** in the database with `is_deactivated: true` and `deactivation_reason: "inactive"`. The search in the `log-production` edge function filters these agents out with `.eq("is_deactivated", false)`, making Samuel James invisible when searching.

## Two Options

### Option A: Reactivate Samuel James (Quick Fix)
If Samuel James should still be active and logging numbers, we reactivate the agent record in the database by setting `is_deactivated = false` and `is_inactive = false`.

### Option B: Allow Deactivated Agents to Log Numbers (Code Fix)
If agents who are "inactive" should still be able to log production, we update the `log-production` edge function to include inactive/deactivated agents in search results.

## Recommended Approach: Both

1. **Reactivate Samuel James** -- Set `is_deactivated = false` and `is_inactive = false` so the agent can be found immediately
2. **Update edge function** -- Remove the `is_deactivated` filter from search so that ALL agents (including temporarily inactive ones) can log production. Production logging should never be blocked -- if someone is closing deals, they should be able to record them regardless of their admin status

## Technical Changes

### Database Fix
Run SQL to reactivate Samuel James:
```sql
UPDATE agents 
SET is_deactivated = false, is_inactive = false 
WHERE id = '7c3c5581-3544-437f-bfe2-91391afb217d';
```

### Edge Function Update: `supabase/functions/log-production/index.ts`

Remove the `.eq("is_deactivated", false)` filter from the search action so all agents can be found:

```typescript
// Before
const { data: agents, error } = await supabaseAdmin
  .from("agents")
  .select(...)
  .eq("is_deactivated", false);

// After - allow all agents to log production
const { data: agents, error } = await supabaseAdmin
  .from("agents")
  .select(...);
```

Optionally, sort deactivated agents lower in results so active agents appear first.

## Files Modified
1. Database migration -- reactivate Samuel James
2. `supabase/functions/log-production/index.ts` -- remove deactivated filter from search
