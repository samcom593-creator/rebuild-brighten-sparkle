
Goal: Fix the screen in your screenshot (the Pipeline table at `/dashboard/applicants`, with columns Manager / Created / Actions) so phone numbers are usable from the row “end” actions area.

What I found
- The previous phone-number fix was applied to `/dashboard/crm` (different page).
- Your screenshot matches `/dashboard/applicants`.
- In this table, phone is only in the Phone column (and can be off-screen when horizontally scrolled), and there is no quick phone action in the Actions column.

Implementation plan
1. Target the correct file/page
- Update `src/pages/DashboardApplicants.tsx` only.

2. Add a phone quick-action in the row-end Actions cluster
- In each applicant table row, add a phone button alongside Notes / Record / Assign / etc.
- Behavior:
  - If phone exists: one click copies phone number to clipboard and shows success toast.
  - If phone is missing: show a clear “No phone number” toast and do nothing else.
- Keep styling consistent with existing small icon actions (`h-7 w-7`).

3. Make phone copy-friendly everywhere in this table
- Keep the existing Phone column, but make value explicitly copyable with:
  - `select-all cursor-text`
- In the Name cell (for tighter layouts), show a small phone line under email on compact widths so phone is still visible even when the dedicated Phone column is not.

4. Keep behavior consistent in card/expanded contexts
- In `renderApplicationCard`, add the same quick phone copy action in the actions row for parity with table behavior.

Technical details
- No database/backend/RLS changes needed (phone is already present in `applications` query).
- Reuse existing `toast` and current interaction patterns.
- Avoid forcing browser `tel:` behavior; prioritize manual dialing workflow (copy-first) so it works reliably on laptop + phone setups.

Validation checklist
- Desktop: while scrolled to far right (Actions visible), phone can still be copied quickly without scrolling back left.
- Compact/tablet widths: phone remains visible from row content and copyable.
- Rows with empty phone values fail gracefully with clear feedback.
- Existing actions (notes, record, assign, hire/terminate) continue to work unchanged.
