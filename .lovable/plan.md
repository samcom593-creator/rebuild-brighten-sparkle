

# Fix: Remove Hired Leads from "Retry Pickups" List

## The Problem

When you select "No Pickup (Retry)" in the Call Center, you're seeing leads you already marked as "hired." This happens because of two bugs:

1. **Applications**: The "No Pickup (Retry)" filter has no actual status filter for applications, so ALL applications show up (including hired ones).
2. **Aged Leads**: Marking an aged lead as "hired" sets its database status to "contacted" instead of "hired," so the exclusion filter never catches it.

## The Fix

Two changes in one file: `src/pages/CallCenter.tsx`

### Fix 1: Add missing "no_pickup" status filter for applications (lines 164-168)

When "No Pickup (Retry)" is selected, only show applications with status `no_pickup` -- just like aged leads already work.

### Fix 2: Set aged lead status to "hired" when hired (line 337)

Currently the status map for aged leads maps "hired" to "contacted." It should map to "hired" so these leads are properly excluded from all future lists.

```text
Before:  hired -> "contacted"
After:   hired -> "hired"
```

### Fix 3: Also exclude "reviewing" from the applications query

Applications marked as hired get status "reviewing." The applications query should exclude `reviewing` and `rejected` statuses when in "no_pickup" mode, so only actual `no_pickup` records appear.

## Immediate Data Cleanup

After deploying the code fix, any aged leads that were previously marked as "hired" but stored with status "contacted" will need a quick database update to correct their status to "hired" so they disappear from the retry list immediately.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/CallCenter.tsx` | (1) Add `else if (statusFilter === "no_pickup") { appQuery = appQuery.eq("status", "no_pickup"); }` for applications query. (2) Change aged lead hired status mapping from `"contacted"` to `"hired"`. |
| Database migration | Update any existing aged leads with status "contacted" that were actually hired, if identifiable. |

## Result

After this fix, "No Pickup (Retry)" will only show leads with actual `no_pickup` status. Hired leads will be properly excluded from all lists.
