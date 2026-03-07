

# Fix: Restore GraduationCap (Send Coursework) Button to Pipeline List View

## Problem
The Pipeline (DashboardApplicants) list view is missing the GraduationCap / "Send Coursework" button that exists on the Kanban cards. The `ResendLicensingButton` component is imported but only used in the Kanban `PipelineCard` — it was never added to the list view's action column.

## Fix
Add the `ResendLicensingButton` to the list view row actions in `src/pages/DashboardApplicants.tsx`, right after the existing action buttons (Notes, Mic, Assign, Hired, Terminate).

### File: `src/pages/DashboardApplicants.tsx`
- In the actions cell (around line 1076-1101), add a `ResendLicensingButton` for unlicensed applicants
- Place it after the Mic button and before the Assign button, matching the order from the Kanban card
- Only show when `app.license_status !== "licensed"`

This is a one-line addition — the component is already imported at line 68.

