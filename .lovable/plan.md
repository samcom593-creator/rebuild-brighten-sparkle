
Goal: Make the CRM Unlicensed Pipeline behave correctly so clicking any unlicensed card opens the lead detail sheet (with its action buttons), instead of doing nothing.

What I found:
- In `src/pages/DashboardCRM.tsx`, unlicensed cards currently call `setExpandedAgentId(...)` on click.
- Expanded rows only render in the licensed table section, so unlicensed cards have no visible expansion target.
- The detail sheet is already wired (`ApplicationDetailSheet`), but CRM currently tracks only `agentId` for opening it.
- Unlicensed cards can represent two record shapes:
  1) true agent rows (need `agentId` lookup),
  2) application-only rows (need direct `applicationId` lookup).
  Without handling both, some cards won’t open usable details.

Implementation plan:
1. Replace single-ID detail sheet state with a dual-target state
- In `DashboardCRM`, replace `viewAppAgentId: string | null` with a state object like:
  - `viewAppTarget: { agentId?: string; applicationId?: string } | null`
- This lets one click open the same sheet for both agent-backed and application-only cards.

2. Add application linkage to CRM row model
- Extend `AgentCRM` with optional `applicationId`.
- While building CRM data (`fetchAgents`), include the latest application `id` in the applications query used for agent enrichment.
- Map:
  - agent-backed rows: `applicationId` from latest assigned application (if present),
  - application-only rows: `applicationId = app.id` directly.

3. Fix unlicensed card click behavior
- In the unlicensed card `onClick`, stop toggling `expandedAgentId`.
- Open detail sheet via `setViewAppTarget(...)` using:
  - `applicationId` when available,
  - otherwise `agentId`.
- Keep click sound feedback.

4. Ensure “action buttons” path is always available
- Pass both props to `ApplicationDetailSheet`:
  - `applicationId={viewAppTarget?.applicationId}`
  - `agentId={viewAppTarget?.agentId}`
- This guarantees the sheet resolves correctly and shows its quick actions (Call/Email) whenever data exists.
- If neither identifier can resolve an application, show a clear toast instead of silent failure.

5. Add lightweight card-level quick actions (optional but aligned with your request)
- Add small action icons on unlicensed cards (Phone, Email, View, Record), with `stopPropagation()` so the card click still opens details cleanly.
- Reuse existing handlers (`setRecorderAgent`) and existing links (`tel:`, `mailto:`).

6. Validation
- Test in CRM Unlicensed Pipeline:
  - Clicking card opens sheet for agent-backed records.
  - Clicking card opens sheet for application-only records.
  - Quick actions work and do not block opening behavior.
  - Closing sheet resets state cleanly.
- Regression check: licensed table expand/collapse still works as before.

Technical details (concise):
- File to update: `src/pages/DashboardCRM.tsx`
- No backend schema/function changes required.
- No auth/RLS changes required.
- Existing `ApplicationDetailSheet` can already render action buttons; this fix focuses on correct routing/opening state and record targeting.
