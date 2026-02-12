

# Fix: Deleted Leads Persisting in Pipeline

## Problem

When you delete leads (from Lead Center or the Applicants pipeline), they appear to stay in place. The root cause is a **silent failure** in the deletion logic:

1. **Lead Center bulk delete**: The code saves leads to the vault first, then attempts to soft-delete by setting `terminated_at` on the application. But it **does not check for errors** on the update call (lines 435-438). If the database denies the update (due to access rules), the vault entry is created but the lead stays active -- making it look like nothing happened.

2. **Applicants pipeline terminate**: Same pattern -- the update may succeed but affect 0 rows if access rules block it, yet no error is surfaced.

3. **No optimistic UI update**: After deletion, the page waits for a full re-fetch. If the update was silently blocked, the re-fetch returns the same data.

## The Fix (2 files)

### 1. LeadCenter.tsx -- Add error handling + verify deletion

- Check the result of the `terminated_at` update call for errors
- If the update fails, roll back the vault entry and show an error toast
- Add a count check: if fewer rows were updated than expected, warn the user
- Clear selected leads only on full success

### 2. DashboardApplicants.tsx -- Verify terminate actually worked

- After calling `handleTerminate`, verify the update affected the row
- If `terminated_at` was not actually set (due to access rules), show a clear error: "Could not terminate this lead -- you may not have permission"
- Add optimistic UI removal: immediately move the lead to the terminated section before the re-fetch completes, so the UI feels responsive

## Technical Details

### LeadCenter.tsx changes (bulk delete)

```text
Current (broken):
1. Insert into deleted_leads vault  (succeeds)
2. Update applications set terminated_at  (NO error check -- fails silently)
3. fetchLeads() re-fetches  (lead is still active)

Fixed:
1. Insert into deleted_leads vault
2. Update applications set terminated_at  
3. CHECK error -- if failed, delete vault entries and show error
4. Verify count of updated rows matches expected
5. fetchLeads() only on success
```

### DashboardApplicants.tsx changes (single terminate)

- Add `.select()` to the update call to confirm the row was actually modified
- If no rows returned, show a permission error
- Optimistically update local state to remove the lead from the active list immediately

### Summary

| File | Change |
|------|--------|
| `src/pages/LeadCenter.tsx` | Add error checking on the soft-delete update; roll back vault on failure; verify row count |
| `src/pages/DashboardApplicants.tsx` | Verify terminate update actually affected the row; add optimistic UI removal; show permission error if blocked |

