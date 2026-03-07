
Root cause found:
- The right-side “Actions” bunching is real in Pipeline (`/dashboard/applicants`): `QuickAssignMenu` is rendered without `displayMode="icon"` in table rows, so it shows “Assign” text inside a tiny icon slot.
- Manager dropdowns show “everyone” because `get-active-managers` currently returns managers + evaluated live agents by design.
- Similar compact-action regressions exist in other dense table/card action bars (not just one page).

Implementation plan

1) Fix manager list source globally (so every reassignment menu is correct)
- Update `supabase/functions/get-active-managers/index.ts` to return only active users with manager role.
- Remove the “live non-manager agents” branch.
- Keep response shape as `{ managers: [...] }` so existing callers continue to work.
- Result: all menus using this function (Pipeline assign, Command Center reassign, Team reassign, importer, add-agent manager picker, etc.) stop showing non-managers.

2) Fix Pipeline action-column overlap and keep reassignment usable
- File: `src/pages/DashboardApplicants.tsx`
- In table row actions:
  - Set `QuickAssignMenu` to `displayMode="icon"` (critical fix for “Assig” overlap).
  - Normalize action buttons to fixed icon sizing and no shrink collisions.
  - Add wrapping/spacing safety in the actions container (`flex-wrap` + `shrink-0` icons).
- Table layout hardening:
  - Keep horizontal scroll behavior but enforce a minimum table width so action controls don’t collapse into contact cells.
- Keep reassignment in the Pipeline actions cluster and make it visually consistent with other icons.

3) Add/standardize reassignment in the “report” table action area
- File: `src/pages/RecruiterDashboard.tsx`
- In desktop table row actions (right-most column):
  - Add reassign control (`QuickAssignMenu`) so leads can be reassigned from that report too.
  - Ensure it targets the correct source table (`applications` vs `aged_leads`).
  - Set all compact quick actions (including `QuickEmailMenu`) to icon mode to prevent text collision in narrow action cells.
  - Widen action column slightly if needed to prevent compression at common desktop widths.

4) Remove compact-action regressions in other dense dashboards
- File: `src/components/callcenter/CallCenterLeadCard.tsx`
  - Force `QuickEmailMenu` icon mode in compact action rows.
- File: `src/components/callcenter/LeadReassignButton.tsx`
  - Add icon-only display variant for tight action groups (keep existing full button variant where space allows).

5) Ensure “manager-only reassignment” is consistent in non-shared reassignment UI
- File: `src/components/dashboard/LeadReassignment.tsx`
- Replace current “all active agents” fetch logic with manager-only sourcing (aligned with the same manager criteria as other menus), so this panel no longer lists non-managers.

Technical details (implementation boundaries)
- No database schema or policy migration required.
- Main changes are UI behavior + one backend function logic update.
- Existing RLS protections remain in place; this is list filtering + UX consistency, not access broadening.

Validation checklist
- Pipeline table: no overlap in Actions column; icons remain clickable at multiple widths.
- Reassignment menus: only managers appear, and current manager is included.
- Recruiter report table: reassignment available from right-side action column and no button collision.
- Call-center compact action bars: no text/button stacking.
- Regression check: existing actions (notes, record, licensing, hire/terminate, email) still work after layout hardening.
