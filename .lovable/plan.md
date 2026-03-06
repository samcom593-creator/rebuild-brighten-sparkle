

# Phase 1 Completion — Remaining Work

The previous pass completed: double-sidebar fix (CRM + Applicants), Lead Center stubbed handlers, Calendar max-width removal, and confetti suppression. Here is what remains to finish Phase 1.

---

## 1. RecruiterDashboard — Table-First Layout

**Current state**: 1455-line file using card-based Kanban columns grouped by license progress stage. XP system, daily challenges, AI panel clutter the primary view. Hardcoded to "Aisha" only.

**Changes**:
- Replace the Kanban column grid (lines 1325-1431) with a full-width `<Table>` using the existing `table.tsx` components
- Each row: Name, Phone, Email, Location, License Progress (inline selector), Last Contacted badge, Score badge, Actions dropdown
- Keep the existing filter/sort bar (lines 1172-1236) — it already works well
- Move XP bar, DailyChallenge, RecruiterAIPanel into a collapsible "Tools" section or remove from default view
- Keep LeadDetailSheet on row click
- Remove the `max-w-[1800px]` constraint
- Keep mobile column picker but render as a scrollable card list on mobile (not table)

## 2. DashboardCRM — Filter Tabs + Table

**Current state**: Already imports `Table` components (line 31-38) and removed DashboardLayout. Need to verify the rendering actually uses the table properly throughout. The file likely still uses collapsible grouped sections.

**Changes**:
- Convert onboarding stage groups (Onboarding, In-Training, Live, Needs Follow-Up) into `<Tabs>` filter controls instead of visual collapsible groups
- Ensure the table renders full-width with inline quick actions per row
- Remove any remaining `GlassCard` wrappers around individual rows

## 3. DashboardAgedLeads — Card-to-Table Conversion

**Current state**: 989 lines. Uses `GlassCard` per lead row (lines 702-889). Has filters and QuickAssignPanel already working.

**Changes**:
- Replace the `GlassCard`-per-row layout with a proper `<Table>` using bulk-select checkboxes
- Columns: Checkbox, Name, Phone, Email, Instagram, Status, License, Source, Assigned Manager, Actions
- Keep the existing QuickAssignPanel, stats row, filters, and merge/delete/ban dialogs
- Add select-all checkbox in table header
- Wire bulk actions (delete, assign) to selected rows

## 4. DashboardApplicants — Default to List

**Current state**: Already has `viewMode` state defaulting to `"list"` (line 149). DashboardLayout already removed. This may already be done.

**Changes**:
- Verify list view renders a proper full-width table (not cards)
- If it still uses card layout in list mode, convert to `<Table>`
- Remove Kanban as default — keep as optional toggle

## 5. Dashboard Role Cleanup

**Current state**: Dashboard.tsx (498 lines) shows same widgets regardless of role.

**Changes**:
- Admin/Owner: Show agency-wide totals (Total ALP, Deals, Active Agents, Close Rate), leaderboards, team views
- Agent: Show only personal metrics (ALP, Deals, Close Rate, Presentations, Calls)
- Remove `AgencyGrowthCard` import if not wired to real data
- Remove `ConfettiCelebration` import (already disabled but still imported)

## 6. NotificationHub — Delivery Report Section

**Current state**: 1560 lines. Has stats cards and blast buttons. No delivery summary per blast type.

**Changes**:
- Add a "Blast History" tab or section that queries `notification_log` grouped by `event_type` containing "blast"
- Show: blast type, total sent, total failed, last sent timestamp
- Add "Resend" button per blast type

## 7. DatePeriodSelector Component

**New file**: `src/components/ui/date-period-selector.tsx`

- Reusable component with: Today, This Week, This Month, Custom Range
- Returns `{ start: Date, end: Date }` 
- Apply to Dashboard stat cards and Command Center

---

## Files to create/modify

| File | Action |
|------|--------|
| `src/pages/RecruiterDashboard.tsx` | Rewrite render to table layout, collapse XP/AI panels |
| `src/pages/DashboardCRM.tsx` | Convert grouped sections to tab filters + table |
| `src/pages/DashboardAgedLeads.tsx` | Replace GlassCard rows with Table + bulk checkboxes |
| `src/pages/DashboardApplicants.tsx` | Verify/fix list view renders as table |
| `src/pages/Dashboard.tsx` | Add role-based section gating |
| `src/pages/NotificationHub.tsx` | Add blast delivery report section |
| `src/components/ui/date-period-selector.tsx` | New reusable date filter component |

No database changes needed.

