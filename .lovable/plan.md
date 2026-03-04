
## Fix Plan: Make aged lead distribution actually work in both Lead Center and Bulk Leads

### What is broken right now (root causes I confirmed)
1. **Lead Center bulk assign is parsing IDs incorrectly**  
   In `src/pages/LeadCenter.tsx`, selected keys are built like `source-id` and later split with `split("-")`.  
   Because IDs are UUIDs (contain `-`), this truncates IDs and causes bulk assignment failures.

2. **“Bulk Lead Assignment” panel is effectively empty for your real workflow**  
   `src/components/dashboard/BulkLeadAssignment.tsx` currently only loads **unassigned applications** from `applications`.  
   With your auto-assignment setup, there are usually no unassigned apps, and it does **not** include `aged_leads`, so you can’t scroll/select old leads there.

3. **Managers can be blocked from seeing assigned aged leads**  
   Route `/dashboard/aged-leads` is admin-protected in `src/App.tsx`, even though the page itself has manager logic.  
   That makes “send aged leads to managers’ accounts” fail in practice for manager visibility.

---

## Implementation changes

### 1) Repair Lead Center bulk assignment reliability
**File:** `src/pages/LeadCenter.tsx`

- Replace fragile key format/parsing with safe helpers:
  - `encodeLeadKey(source, id)` and `decodeLeadKey(key)` using a safe separator or structured encoding.
- Update all selection paths to use those helpers:
  - `toggleSelectAll`
  - `handleBulkAssign`
  - any selected-row filtering/removal logic.
- Add defensive validation after updates:
  - confirm selected IDs are valid UUID strings before update.
  - return clearer toast if 0 rows were updated.

Result: selecting multiple aged leads or applications in Lead Center will assign correctly every time.

---

### 2) Upgrade “Bulk Lead Assignment” to include aged leads and reassignment
**File:** `src/components/dashboard/BulkLeadAssignment.tsx`

- Expand data model to include source:
  - `source: "applications" | "aged_leads"`
  - current assignee fields.
- Fetch leads from both tables (not just unassigned applications), with practical filters:
  - source filter (All / Applications / Aged Leads)
  - assignee filter (All / Unassigned / specific manager)
  - search box (name/email/phone).
- Keep scroll + checkbox selection UX and bulk confirm dialog.
- In bulk assign handler, split selected IDs by source and update correct columns:
  - `applications.assigned_agent_id`
  - `aged_leads.assigned_manager_id`
- Keep notification as a single summary notification to reduce spam.

Result: in “Bulk Leads,” you can scroll, select old/aged leads, and send them to a manager.

---

### 3) Ensure managers can access aged leads assigned to them
**Files:** `src/App.tsx`, `src/pages/DashboardAgedLeads.tsx`

- Change `/dashboard/aged-leads` route to allow authenticated manager/admin access.
- Add explicit role guard inside `DashboardAgedLeads`:
  - admin/manager allowed
  - others see access-required state.
- Keep existing query filter for managers (`assigned_manager_id = manager agent id`).

Result: once assigned, aged leads actually show up in manager-accessible workflow.

---

## Technical details
- **No database schema migration needed.** This is UI/query logic and route-access correction.
- Main correctness fix is eliminating UUID truncation from `split("-")`.
- Assignment updates stay source-specific:
  - applications → `assigned_agent_id`
  - aged leads → `assigned_manager_id`
- Existing RLS remains compatible with this approach.

---

## End-to-end verification checklist (before publishing)
1. In **Lead Center**:
   - select 3+ aged leads
   - assign to Manager A
   - confirm assignee updates immediately and after refresh.
2. In **Bulk Lead Assignment**:
   - filter to aged leads
   - select multiple rows from list
   - assign to Manager B
   - confirm success + persisted updates.
3. Log in as target manager:
   - confirm assigned aged leads are visible in manager-facing aged leads workflow.
4. Regression:
   - assign applications in same bulk tool still works.
   - single-row quick assign still works in Lead Center.

---

## Go-live steps after implementation
1. Verify in preview with the checklist above.
2. Click **Publish → Update**.
3. Wait for the build to complete, then hard-refresh published site once.
4. Re-test one bulk assignment on published URL to confirm propagation.
