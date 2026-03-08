

# Plan: Fix Bulk Lead Selection & Assignment

## Current Problems

1. **"Select 100" button is hidden** — it only appears after you've already manually selected at least 1 lead (line 936: `selectedIds.size > 0`), making it hard to discover
2. **"Delete Selected" only deletes 1 lead** — line 989 finds only the first selected lead and deletes just that one, ignoring the rest
3. **No confirmation on bulk assign from bottom bar** — the inline `Select` on line 952 fires immediately with no safety guard for 100+ leads
4. **Bottom action bar disappears when nothing selected** — the entire control strip is invisible until you manually check a box
5. **Two competing bulk-assign UIs** — `QuickAssignPanel` at the top (unassigned only) AND the bottom bar checkbox flow do the same thing differently, causing confusion

## Fix Plan

### File: `src/pages/DashboardAgedLeads.tsx`

**A. Always-visible bulk action bar above the table**
- Move the "Select 100 / Select All / Clear" buttons and the manager assign dropdown OUT of the conditional `selectedIds.size > 0` block
- Place them in a persistent toolbar between the filters and the table
- Show selected count badge dynamically

**B. Fix bulk delete to handle all selected leads**
- Replace single-lead delete with a loop that deletes ALL selected IDs (vault + hard delete)
- Add confirmation dialog showing count: "Delete 47 leads?"

**C. Add confirmation dialog for bulk assign from bottom bar**
- When selecting a manager from the bottom assign dropdown, show a confirmation dialog (like QuickAssignPanel does for 50+) before executing
- Include count + manager name in the dialog

**D. Remove redundant QuickAssignPanel**
- The top QuickAssignPanel duplicates the bottom bar functionality
- Keep ONE unified bulk assign flow: checkboxes + toolbar with "Select 100" preset + manager dropdown + confirm

**E. Bulk delete all selected (not just first)**
- Change line 989 from finding first selected to passing all selected IDs to a batch delete function

### Changes Summary

1 file to edit: `src/pages/DashboardAgedLeads.tsx`
- Remove `QuickAssignPanel` component usage (keep the component file, just stop rendering it)
- Create persistent bulk toolbar above table with: Select 100 / Select All / Clear / Manager dropdown / Assign button / Delete button
- Add `handleBulkDelete` function that vaults + deletes all selected IDs
- Add `handleBulkAssign` with confirmation dialog for the toolbar assign
- Wire confirmation dialogs for both bulk assign and bulk delete

