

# Phase 1 Completion — Remaining Items

## Current State Assessment

After reviewing all files:
- **RecruiterDashboard**: Already full-width table (desktop) + card list (mobile). Done.
- **DashboardAgedLeads**: Already Table with bulk checkboxes and select-all. Done.
- **DashboardApplicants**: Already defaults to list view. Done.
- **DashboardCRM**: Still uses collapsible grouped sections (lines 932-976). Needs conversion to Tabs.
- **NotificationHub**: No blast delivery report section. Needs addition.
- **Dashboard**: Role cleanup partially done but `AgencyGrowthCard` and unused imports remain.

## Changes

### 1. DashboardCRM — Collapsible Sections to Tab Filters
Convert the `SECTIONS.map()` with collapsible accordions (lines 932-1175) into a `<Tabs>` component where each tab shows a flat table of agents in that stage. Remove the expand/collapse toggle pattern. Keep the existing Table columns (Agent, License, Contact, Week ALP, Deals, Attendance) and the expandable row detail.

### 2. NotificationHub — Blast Delivery Report
Add a "Blast History" tab to the existing Tabs. Query `notification_log` for records where title contains "blast" or "WhatsApp" or "Seminar", grouped by date and type. Show: blast type, total sent, total failed, last timestamp, and a "Resend" button per blast type.

### 3. Dashboard — Final Role Cleanup  
Remove the `AgencyGrowthCard` import and render if it only shows placeholder data. Clean up unused imports (`ConfettiCelebration` already disabled but still imported). Ensure agent-only view hides all manager/admin widgets completely.

### Files to modify
| File | Change |
|------|--------|
| `src/pages/DashboardCRM.tsx` | Replace collapsible sections with `<Tabs>` filter |
| `src/pages/NotificationHub.tsx` | Add blast delivery report tab |
| `src/pages/Dashboard.tsx` | Remove dead imports, tighten role gating |

No database changes needed.

