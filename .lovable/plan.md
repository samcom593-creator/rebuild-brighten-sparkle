

# Fix Delete/Ban Persistence and Add Per-Row Delete Option

## Problems Found

1. **No per-row Delete button** -- In both Lead Center and Aged Leads, there is only a "Ban" button per row. The "Delete" action only exists in the bulk floating bar. Users expect a choice between Delete and Ban on each individual lead.

2. **Deletes not persisting** -- Two root causes:
   - In the bulk delete flow, if the vault insert fails (e.g., duplicate `original_id` from a previous delete attempt), the entire operation throws before the actual delete/terminate happens, so the lead stays in the database.
   - The `banned_prospects` table is cast as `as any` in the code because the TypeScript types haven't been regenerated. While this works at runtime, it makes error handling fragile.

3. **No individual delete handler** -- The per-row action only has Ban. A single-lead delete handler (vault + terminate/delete) is missing entirely.

4. **Test users lingering** -- 1 test application is still active (not terminated). The rest (9) are terminated but still in the database.

## Changes

### 1. Lead Center (`src/pages/LeadCenter.tsx`)

- Add a per-row dropdown menu (three-dot icon) replacing the standalone Ban button in the Actions column
- The dropdown will have two destructive options: "Delete" (moves to vault) and "Ban" (blocks permanently)
- Add a `handleSingleDelete` function that:
  - Inserts the lead into the `deleted_leads` vault
  - For applications: sets `terminated_at` and `termination_reason`
  - For aged leads: hard deletes the row
  - If the vault insert fails with a duplicate, still proceeds with the delete (the lead was already vaulted before)
  - Removes from local state on success
- Add a confirmation dialog that lets the user pick between "Delete" (soft, recoverable from vault) or "Ban" (permanent block)
- Fix the bulk delete handler to not abort if vault insert fails due to duplicates

### 2. Aged Leads (`src/pages/DashboardAgedLeads.tsx`)

- Add a "Delete" option in the existing dropdown menu alongside the existing "Ban" option
- Add a `handleDeleteLead` function that:
  - Inserts into `deleted_leads` vault
  - Hard deletes the aged lead row
  - Handles duplicate vault entries gracefully
  - Removes from local state
- Add a delete confirmation dialog

### 3. Clean Up Test Users

- Terminate the 1 remaining active test application via a data operation
- Permanently delete all 10 test application records from the database so they stop appearing

### 4. Fix Type Cast Issue

- Update the `banned_prospects` references to work without `as any` by ensuring the types are properly recognized (the types file auto-regenerates, so this will resolve after the migration runs)

## Technical Details

### Delete Flow (per-row)

```
User clicks three-dot menu -> "Delete" or "Ban"
  If Delete:
    -> Confirmation dialog
    -> INSERT into deleted_leads (ignore duplicate errors)
    -> For applications: UPDATE terminated_at
    -> For aged_leads: DELETE row
    -> Remove from local state
    -> Toast: "Lead deleted"
  If Ban:
    -> Existing ban confirmation dialog
    -> INSERT into banned_prospects
    -> DELETE/terminate the lead
    -> Remove from local state
    -> Toast: "Prospect banned"
```

### Files to Modify

1. `src/pages/LeadCenter.tsx` -- Add per-row delete/ban dropdown, single-delete handler, fix bulk delete error handling
2. `src/pages/DashboardAgedLeads.tsx` -- Add delete option in dropdown, delete handler with confirmation
3. Database cleanup -- Remove test user records

