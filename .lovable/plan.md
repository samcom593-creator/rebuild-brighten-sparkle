

# Platform Refactor Plan — Phase 1: Critical Fixes & Layout Overhaul

This is a massive undertaking spanning 20+ pages, 100+ components, and multiple backend systems. Attempting everything in a single pass would produce shallow, incomplete results. Instead, this plan covers **Phase 1: the highest-impact structural and functional fixes** that will transform the platform's usability and correctness. Subsequent phases will address polish, recognition, and edge cases.

---

## Scope of Phase 1

### A. Layout & Full-Width Conversion (5 pages)

The following pages currently underutilize screen width or default to Kanban when list/table format is more operationally effective:

1. **RecruiterDashboard.tsx** (1455 lines) — Currently card-based with grouped sections. Convert to a **full-width sortable/filterable table** as the default view. Remove XP/gamification clutter from the primary view. Keep the detail sheet on row click. Ensure all unlicensed applicants + contacted aged leads appear (current query logic looks correct but layout wastes space).

2. **DashboardCRM.tsx** (1208 lines) — Currently uses grouped collapsible sections with expandable rows. Convert to a **full-width table layout** with inline quick actions. Remove the `DashboardLayout` wrapper (it double-wraps the sidebar since `AuthenticatedShell` already provides it). Sections (Onboarding, In-Training, Live, Needs Follow-Up) become filter tabs instead of visual groups.

3. **DashboardApplicants.tsx** (1092 lines) — Has a Kanban/list toggle but defaults to Kanban. Change default to **list view**. Remove the `DashboardLayout` wrapper (same double-wrap issue). Ensure full-width table rendering.

4. **DashboardAgedLeads.tsx** (989 lines) — Already list-based but uses `GlassCard` per row (card soup). Convert to a proper **full-width table** with bulk select checkboxes, inline status/assignment controls.

5. **CalendarPage.tsx** (455 lines) — Currently capped at `max-w-4xl mx-auto`. Remove the max-width constraint. Add a proper week/month calendar grid view instead of just a list of interviews.

### B. Double-Sidebar Fix

`DashboardCRM.tsx` and `DashboardApplicants.tsx` import and render `DashboardLayout` which wraps content in `SidebarLayout`. But these pages are rendered inside `AuthenticatedShell` which already provides `SidebarLayout`. This creates a **double sidebar**. Fix: remove `DashboardLayout` wrapper from both pages.

### C. Bulk Lead Distribution — Verify & Harden

**Lead Center** (`LeadCenter.tsx`): The bulk assign handler exists (lines 382-415) and correctly updates both `applications` and `aged_leads` tables. However:
- `handleBulkDelete` (line 417) has a comment "Implementation same as previous (omitted for brevity)" — this is **dead code** that does nothing server-side. Must implement actual deletion.
- `handleSingleDelete` and `handleBanLead` are similarly stubbed. Must wire real DB operations.

**Aged Leads** (`DashboardAgedLeads.tsx`): Has a `QuickAssignPanel` component. Need to verify the bulk assign actually persists and refreshes correctly.

### D. WhatsApp + Seminar Blast Verification

The edge functions `send-whatsapp-onboarding-blast` and `send-seminar-invite-blast` were fixed (SMS truncation removed, sender domain corrected). Add a **"Delivery Report"** section to Notification Hub showing:
- Total sent per channel per blast type
- Last blast timestamp
- Quick "Resend to All" button

### E. Date Controls

Replace "All Time" defaults with proper date selectors across:
- Dashboard (stat cards)
- Command Center (already has `TimePeriod` type with day/week/month/custom)
- Performance sections

Add a reusable `DatePeriodSelector` component with: Today, This Week, This Month, Custom Range.

### F. Dashboard Role Cleanup

- **Admin/Owner**: Show agency-wide totals (Total ALP, Deals, Active Agents, Close Rate, Top Producers, Top Recruiters)
- **Agent**: Show only personal metrics (ALP, Deals, Close Rate, Presentations, Calls)
- Remove dead/placeholder widgets: `ConfettiCelebration` on every load, `AgencyGrowthCard` if not wired to real data

---

## Technical Details

### Files to modify:

| File | Changes |
|------|---------|
| `src/pages/RecruiterDashboard.tsx` | Full rewrite to table-first layout, remove XP bar from main view, add sort/filter controls |
| `src/pages/DashboardCRM.tsx` | Remove `DashboardLayout` wrapper, convert sections to filter tabs, full-width table |
| `src/pages/DashboardApplicants.tsx` | Remove `DashboardLayout` wrapper, default to list view, full-width |
| `src/pages/DashboardAgedLeads.tsx` | Convert card-per-row to proper table, verify bulk assign |
| `src/pages/CalendarPage.tsx` | Remove `max-w-4xl`, improve layout |
| `src/pages/LeadCenter.tsx` | Fix stubbed delete/ban handlers with real DB operations |
| `src/pages/Dashboard.tsx` | Tighten role-based sections, remove decorative-only widgets |
| `src/pages/NotificationHub.tsx` | Add delivery report summary for blast functions |
| `src/components/dashboard/DashboardLayout.tsx` | Mark as deprecated or remove if unused after CRM/Applicants fix |

### No database changes needed for Phase 1.

### Estimated scope: ~8 major file edits

---

## What Phase 1 does NOT cover (deferred to Phase 2+)

- Full recognition/reward engine build
- Email template preview system
- Complete mobile audit pass
- Design system unification (typography, shadows, spacing)
- Performance dashboard rebuild
- Pipeline status standardization
- Full sync audit across all modules
- Animation/motion standardization

---

## Success criteria for Phase 1

- RecruiterHQ, CRM, Applicants, Aged Leads all render full-width table layouts
- No double-sidebar on any page
- Lead Center bulk delete/ban actually works (not stubbed)
- Calendar uses full width
- Dashboard shows role-appropriate content only
- Notification Hub shows blast delivery summaries
- Zero horizontal scroll on mobile for modified pages

