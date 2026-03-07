

# Full Audit: All Prompts — What's Done, What's Still Missing

## Status Summary

| Issue | Status | Notes |
|-------|--------|-------|
| **Recruiter HQ horizontal scroll** | ✅ Done | `overflow-x-auto` + `min-w-[1100px]` on desktop table |
| **CRM table scroll** | ✅ Done | `overflow-x-auto` + `min-w-[1100px]` on each section table |
| **GraduationCap on Pipeline list view** | ✅ Done | `ResendLicensingButton` added at line ~1083 in DashboardApplicants |
| **"My Directs" toggle on Pipeline** | ✅ Done | `myDirectsOnly` state + filter + toggle button in DashboardApplicants |
| **"My Directs" toggle on Dashboard** | ✅ Done | Toggle present at line ~293, state at line ~235 |
| **"My Directs" toggle on Recruiter HQ** | ✅ Done | Toggle at line ~1256, filter at line ~1034 |
| **Manager comparison: Personal/Team/Total ALP** | ✅ Done | TeamOverviewDashboard shows stacked chart + clickable rows with Personal/Team/Total values |
| **Manager drill-down to agent roster** | ✅ Done | Expandable rows with agent name, stage, 30-day AOP, deals |
| **Avg Leads/Day precision (LeadCenter)** | ✅ Done | Uses `parseFloat((recentLeads / 30).toFixed(1))` |
| **Lead Center pipeline actions (Hired, Contracted, etc.)** | ✅ Done | DropdownMenu with Contacted, Hired, Contracted, Not Qualified, Delete, Ban actions |
| **Aged Leads per-row QuickAssignMenu** | ✅ Done | `QuickAssignMenu` in each row's action cell for admin |
| **Aged Leads bulk assign in selection bar** | ⚠️ Partially | QuickAssignMenu per-row exists; need to verify bulk assign in bottom bar |
| **Email reliability (QuickEmailMenu → invokeEdge)** | ✅ Done | Uses `invokeEdge` with `applicationId` guard |
| **send-outreach-email structured errors** | ✅ Done | Returns 400 with missing field details |
| **Manager ownership fix (submit-application)** | ✅ Done | Hardcoded fallback removed; passes null when no referral |
| **NotificationHub → invokeEdge** | ✅ Done | Imported and used for retry paths |
| **ApplicantCheckin → invokeEdge** | ✅ Done | Uses `invokeEdge("send-notification", ...)` |
| **OnboardingPipelineCard cross-ref applications** | ✅ Done | Cross-references `applications.license_progress` with progress ordering |
| **Dashboard stats filtered by DatePeriodSelector** | ❌ NOT Done | `dateRange` is in query key but `fetchDashboardData` ignores it — always queries all data with hardcoded 30/60-day windows |
| **Aged Leads table overflow-x-auto** | ❌ NOT Done | No `overflow-x-auto` wrapper on the Aged Leads table |
| **Dashboard "My Directs" actually filtering stats** | ❌ NOT Done | Toggle exists but `fetchDashboardData` doesn't receive or use `myDirectsOnly` — stats always show same numbers regardless of toggle |

---

## What Needs to Be Fixed (3 items)

### 1. Dashboard stats ignore DatePeriodSelector
`fetchDashboardData` (line 76) takes `(userId, profileName, userEmail)` but never receives `dateRange`. The query key includes `dateRange` so it refetches, but the function itself uses hardcoded 30/60-day windows. Stats and charts don't change when you pick a different date period.

**Fix:** Pass `dateRange` into `fetchDashboardData` and use it to filter `applications` by `created_at` within the range. Update chart data generation to respect the selected period.

### 2. Dashboard "My Directs" toggle is cosmetic
The `myDirectsOnly` state exists and renders a toggle button, but `fetchDashboardData` doesn't receive it. The stats always show the same numbers regardless of toggle position. For non-admin managers this is fine (already filtered by `assigned_agent_id`), but for admin it has no effect.

**Fix:** Pass `myDirectsOnly` and `currentAgentId` to `fetchDashboardData`. When `myDirectsOnly` is true, filter applications to only those where `assigned_agent_id === currentAgentId`.

### 3. Aged Leads table missing overflow-x-auto
Unlike RecruiterDashboard and DashboardCRM which now have `overflow-x-auto` + `min-w` on their tables, `DashboardAgedLeads.tsx` has no horizontal scroll wrapper. On narrower viewports, right-side columns (actions, assign) can get clipped.

**Fix:** Wrap the Aged Leads `<Table>` in a `div.overflow-x-auto` with `min-w-[1000px]` on the table, matching the pattern used in the other operational pages.

---

### Files to modify
| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Pass `dateRange` + `myDirectsOnly` + `currentAgentId` to `fetchDashboardData`; filter applications by date range; filter by agent ID when "My Directs" active |
| `src/pages/DashboardAgedLeads.tsx` | Add `overflow-x-auto` wrapper + `min-w-[1000px]` on table |

No database changes needed.

