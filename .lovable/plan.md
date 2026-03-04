

# Fix: Aged Lead Assignment Not Working

## Problem
Two issues preventing aged leads from being moved/assigned:

### Issue 1: QuickAssignMenu always updates `applications` table
`QuickAssignMenu.tsx` (line 104-107) hardcodes `supabase.from("applications").update(...)`. When used on an aged lead row in the Lead Center, it tries to update a non-existent `applications` row — silently failing because no row matches the aged lead's ID.

### Issue 2: Lead Center bulk assign works, but per-row assign doesn't
The Lead Center's bulk assign (floating bar) correctly splits by source and updates `aged_leads.assigned_manager_id` vs `applications.assigned_agent_id`. But the per-row `QuickAssignMenu` doesn't know the lead's source.

## Fix

### 1. Update `QuickAssignMenu` to accept a `source` prop
Add optional `source?: "applications" | "aged_leads"` prop. When `source === "aged_leads"`, update `aged_leads.assigned_manager_id` instead of `applications.assigned_agent_id`.

**File**: `src/components/dashboard/QuickAssignMenu.tsx`
- Add `source` to `QuickAssignMenuProps` (default: `"applications"`)
- In `handleAssign`: branch on `source` to update the correct table/column

### 2. Pass `source` from LeadCenter rows
**File**: `src/pages/LeadCenter.tsx` (line 772-776)
- Pass `lead.source` to `QuickAssignMenu` so aged leads update correctly

### 3. Add "Aged Leads" stat card to Lead Center
Add a 5th clickable stat card showing the count of aged leads, which filters the view to aged leads only when clicked. This gives the admin a quick way to see and manage aged leads from the Lead Center.

**File**: `src/pages/LeadCenter.tsx`
- Add `agedLeads` count to stats
- Add new stat card that sets `filterSource` to `"aged_leads"`

