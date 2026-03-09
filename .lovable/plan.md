

# Go-Live Final Remediation Plan

## Issues Identified

### 1. No "My Directs" Filter on Pipeline (DashboardApplicants), Dashboard, or RecruiterHQ
Currently, admin/managers see ALL agents/applicants with no toggle to filter to only their directly-invited recruits. The AgentPipeline page has a "My Recruits" button, but DashboardApplicants, Dashboard, and RecruiterDashboard lack this.

**Fix**: Add a "My Directs" / "Full Team" toggle to:
- `DashboardApplicants.tsx` — filter `assigned_agent_id` to only the current manager's agent ID
- `Dashboard.tsx` — the `fetchDashboardData` function currently filters to `assigned_agent_id = agentData.id` for non-admin, but admin sees everything; add a toggle for admin to scope to their directs
- `RecruiterDashboard.tsx` — add a "My Directs" filter button alongside existing filters

### 2. Aged Leads Missing a Visible "Distribute" Button
The Aged Leads page has a `QuickAssignPanel` but it only appears when `isAdmin && managers.length > 0`. The per-row actions only have status changes + delete/ban via the DropdownMenu — no per-row assign button and no bulk distribute button at the bottom selection bar.

**Fix**:
- Add a `QuickAssignMenu` to each row's actions dropdown (like LeadCenter has)
- Add a bulk assign section to the bottom selection bar (currently only has "Delete Selected" and "Clear")

### 3. Avg Leads/Day Inaccurate in Lead Center
The calculation uses `Math.round(recentLeads / 30)` which rounds to zero for small counts. Should use more precise calculation.

**Fix**: Change to `parseFloat((recentLeads / 30).toFixed(1))` to show one decimal place.

### 4. Lead Center Missing Pipeline Actions (Hired, Contracted, etc.)
Lead Center per-row actions have: Assign, Phone, Email, Resend Licensing, Delete, Ban. But it's missing the stage-change actions that exist in DashboardApplicants (Mark as Hired, Contracted, Terminate).

**Fix**: Add a DropdownMenu with status-change actions (Contacted, Hired, Contracted, Terminate) to the Lead Center row actions for application-source leads.

### 5. Dashboard Stats Not Filtering by DatePeriodSelector
The `DatePeriodSelector` was added to Dashboard UI but `fetchDashboardData` doesn't use `dateRange` — it always queries all data.

**Fix**: Pass `dateRange` into the query key and filter applications by `created_at` within the selected range.

### 6. OnboardingPipelineCard Dashboard Accuracy
The card shows Course Purchased, Test Scheduled, etc. based on `agents` table fields (`has_training_course`, `onboarding_stage`). It only queries agents invited by the current manager (non-admin). For admin it queries ALL agents. This is correct. However, it doesn't cross-reference with `applications` table license_progress data.

**Fix**: Cross-reference with `applications.license_progress` to ensure counts include applicants at each stage (course_purchased, passed_test, waiting_on_license, etc.), not just agent records.

### 7. Todoist Integration
Todoist has an official REST API. This would require the user's Todoist API token as a secret, stored via the secrets tool. We can create an edge function that syncs planner blocks to/from Todoist tasks. However, Todoist is not available as a connector — the user would need to provide their API key manually.

### 8. Google Calendar & Calendly Integration
Google Calendar integration would require OAuth setup (not available as a connector). Calendly is already partially integrated (CalendlyEmbed component exists). For Google Calendar, we can generate `.ics` download links or `calendar.google.com` add-event URLs from scheduled interviews.

**Fix**: Add "Add to Google Calendar" links on scheduled interviews in CalendarPage. For Calendly, it's already embedded — verify it's wired into scheduling flows.

---

## Implementation Plan

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/DashboardApplicants.tsx` | Add "My Directs" / "Full Team" toggle button in filters; filter by `assigned_agent_id === agentId` when "My Directs" active |
| `src/pages/Dashboard.tsx` | Pass `dateRange` to query; add "My Directs" toggle for admin; filter stats by date range |
| `src/pages/RecruiterDashboard.tsx` | Add "My Directs" filter toggle |
| `src/pages/DashboardAgedLeads.tsx` | Add per-row QuickAssignMenu; add bulk assign to selection bar |
| `src/pages/LeadCenter.tsx` | Add status-change actions (Hired, Contracted, Terminate) to per-row dropdown; fix avg leads/day precision |
| `src/components/dashboard/OnboardingPipelineCard.tsx` | Cross-reference applications table for accurate license_progress counts |

### External Integrations
- **Todoist**: Requires API key — will prompt user to provide it via secrets tool before implementing
- **Google Calendar**: Add "Add to Google Calendar" URL links on CalendarPage interview entries (no API key needed, uses URL scheme)
- **Calendly**: Already embedded via CalendlyEmbed component — verify wiring

No database changes needed.

