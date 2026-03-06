

# Go-Live Verification — Current Status & Remediation Plan

## Assessment Summary

After reviewing all key files against the checklist, the platform is in strong shape. Here is the status of each critical area and what needs fixing.

---

## Already Passing (No Changes Needed)

| Area | Status |
|------|--------|
| **Navigation / Routing** | All routes wired in App.tsx, AuthenticatedShell provides single sidebar, no double-wrap |
| **Lead Center Bulk Distribution** | `handleBulkAssign`, `handleBulkDelete`, `handleSingleDelete`, `handleBanLead` all fully wired with vault archival |
| **Aged Leads Table + Bulk Select** | Full-width `<Table>` with checkboxes, QuickAssignPanel with notification, bulk delete bar |
| **RecruiterHQ Layout** | Full-width table (desktop), card list (mobile), filters/sort/search working, tools collapsed |
| **CRM Layout** | Tabs-based stage filtering + full-width table, no DashboardLayout wrapper |
| **Applicants** | DashboardLayout removed, defaults to list view |
| **Dashboard Role Gating** | Admin sees agency stats, agents see personal metrics, confetti disabled |
| **NotificationHub** | Blast History tab with 14-day breakdown table already implemented |
| **Calendar** | No max-width constraint, full-width rendering |
| **DatePeriodSelector** | Component exists at `src/components/ui/date-period-selector.tsx` |
| **RLS Policies** | All tables properly secured with admin/manager/agent role checks |
| **Auth System** | AuthProvider with role caching, ProtectedRoute with admin gating |

---

## Issues Found — Needs Fixing

### 1. RecruiterDashboard still imports and renders `ConfettiCelebration`
Line 37 imports it, line 1069 renders it. This was supposed to be removed as part of the cleanup. It fires whenever `confetti` state is set to true (on licensed events). This is fine functionally but contradicts the "remove ConfettiCelebration" directive.

**Fix**: Remove the import and `<ConfettiCelebration>` render. Keep the XP toast which is more subtle.

### 2. DashboardApplicants still uses `GlassCard` per applicant in list mode
The list view (lines ~700+) likely still renders individual `GlassCard` components per applicant rather than a proper `<Table>`. Need to verify and convert to table rows if so.

**Fix**: Convert the list view rendering to use `<Table>` components with proper columns (Name, Email, Phone, Status, License, City/State, Actions).

### 3. Calendar is still interview-list only — no grid view
The CalendarPage shows a list of scheduled interviews grouped by date but lacks a visual week/month calendar grid. This makes it hard for managers to see availability at a glance.

**Fix**: Add a simple week-view grid using CSS grid (7 columns for days, rows for hours) that plots interview blocks visually. Keep the list view as a secondary tab.

### 4. DatePeriodSelector not yet integrated into Dashboard
The component exists but is not imported or used by Dashboard.tsx, Command Center, or Performance views.

**Fix**: Add `DatePeriodSelector` to Dashboard.tsx stat queries, filtering production data by selected period instead of "all time".

### 5. Performance Dashboard (Numbers page) missing deal entry features
The checklist requires: add deal, monthly premium input, ALP auto-calc (premium × 12), edit/delete deals. The Numbers page exists but need to verify these features.

### 6. DashboardApplicants — Kanban toggle still exists
The page still has `LayoutGrid` and `List` toggle buttons. Per the directive, Kanban should be an optional toggle only, not prominent. Currently it defaults to list which is correct, but the Kanban view should be de-emphasized.

---

## Remediation Plan

### Task 1: Clean up ConfettiCelebration from RecruiterDashboard
- Remove import (line 37) and render (line 1069) from `RecruiterDashboard.tsx`
- Remove `confetti` state and `triggerCelebrate` function

### Task 2: Convert DashboardApplicants list view to Table
- Replace per-applicant `GlassCard` rendering with `<Table>` columns: Name, Email, Phone, Status, License Progress, City/State, Created, Actions
- Add bulk select checkboxes
- Keep Kanban as a small toggle option

### Task 3: Add week-view calendar grid to CalendarPage
- Add a `Tabs` component with "List" and "Week" views
- Week view: 7-column CSS grid showing time slots with interview blocks positioned by date/time
- Simple, functional, no external library needed

### Task 4: Integrate DatePeriodSelector into Dashboard
- Import and add above the stat cards section
- Filter the `fetchDashboardData` query by selected date range
- Pass date range to stat calculations

### Task 5: Verify Numbers page deal entry
- Read the Numbers page to confirm add/edit/delete deal functionality
- Verify ALP = monthly premium × 12 calculation
- Fix if missing

### Files to modify
| File | Change |
|------|--------|
| `src/pages/RecruiterDashboard.tsx` | Remove ConfettiCelebration |
| `src/pages/DashboardApplicants.tsx` | Convert list view to Table |
| `src/pages/CalendarPage.tsx` | Add week-view grid tab |
| `src/pages/Dashboard.tsx` | Integrate DatePeriodSelector |
| `src/pages/Numbers.tsx` | Verify/fix deal entry (if needed) |

No database changes needed.

