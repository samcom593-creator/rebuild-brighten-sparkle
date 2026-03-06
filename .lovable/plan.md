
Goal: Remove “bundled up” UI across Recruiter HQ, Pipeline, and related dashboards so text is always readable and every action is clearly clickable.

What I found (root causes)
1) `QuickEmailMenu` and `QuickAssignMenu` always render text labels (“Email”, “Assign”), even in tiny action cells (`h-6/w-6`, `h-7/w-7`), which causes cramped/broken action rows.
2) Action layouts are inconsistent per page (some rows have too many inline buttons + badges + links), creating crowding on medium/small widths.
3) Several rows lack strict truncation/width constraints (`min-w-0`, `max-w`, `truncate`) for email/phone/name, so content collides with actions.
4) Dense icon rows rely on tooltips and mixed button sizes, reducing click clarity.

Implementation approach
1) Create a shared “clear actions” standard
- Add compact mode support to shared components:
  - `QuickEmailMenu`: `displayMode: "full" | "icon"` (default full).
  - `QuickAssignMenu`: `displayMode: "full" | "icon"` (default full).
- In icon mode: icon-only button, fixed target size, `aria-label` + `title`, no text label.
- Keep dropdown content unchanged (only trigger changes).

2) Apply the standard across all operational dashboards
- Use icon mode in dense table/action cells:
  - `DashboardApplicants` (table actions)
  - `LeadCenter`
  - `DashboardAgedLeads`
  - `RecruiterDashboard` (desktop table actions + dense card rows)
  - `AllLeadsPanel`
  - `TerminatedAgentLeadsPanel`
  - `CallCenterLeadCard`
- Keep full mode only where there is room (header/toolbars, wide card controls).

3) De-bundle row content (text + actions)
- Enforce row structure:
  - Left: identity/contact block (`min-w-0`, `truncate`, max widths).
  - Right: actions group with fixed icon targets.
- For overloaded card rows (especially Recruiter HQ + Pipeline card actions):
  - Keep 3–4 primary actions inline.
  - Move secondary actions into a “More” dropdown.
- Ensure action groups wrap cleanly (`flex-wrap`, `gap-y`) instead of squeezing text.

4) Clickability and interaction clarity
- Standardize actionable target sizes:
  - Dense table/cell: `h-8 w-8`
  - Mobile/touch-heavy cards: `h-9 w-9`
- Add consistent visual affordance (outline/hover/focus ring).
- Ensure all nested action clicks stop row-click propagation where needed.

Technical details (files)
- Shared components:
  - `src/components/dashboard/QuickEmailMenu.tsx`
  - `src/components/dashboard/QuickAssignMenu.tsx`
- High-priority pages/components:
  - `src/pages/RecruiterDashboard.tsx`
  - `src/pages/DashboardApplicants.tsx`
  - `src/components/pipeline/PipelineCard.tsx`
  - `src/pages/AgentPipeline.tsx`
  - `src/pages/LeadCenter.tsx`
  - `src/pages/DashboardAgedLeads.tsx`
  - `src/components/dashboard/AllLeadsPanel.tsx`
  - `src/components/dashboard/TerminatedAgentLeadsPanel.tsx`
  - `src/components/callcenter/CallCenterLeadCard.tsx`
- Optional style helper:
  - Add reusable class/utility for dense action bars (consistent sizing + spacing).

Validation plan (must pass before done)
1) Desktop (1366px): no overlapping/bundled text in Recruiter HQ, Pipeline, Applicants, Lead Center, Aged Leads.
2) Mobile (390px): action rows stay readable; no label collisions.
3) Every visible action/button is clearly clickable (phone, email, assign, stage/status actions, notes/record/schedule).
4) No regression to workflow behavior (all existing actions still trigger same logic).
5) End-to-end manual click-through of these pages with real records to confirm both layout and action execution.
