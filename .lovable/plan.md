

# CRM Optimization & Site-Wide Consistency Sweep

## Problems Identified

### 1. CRM Expanded Row Dead Space
The `AgentExpandedRow` component (DashboardCRM.tsx lines 196-498) has a two-column grid where the **right column is often completely empty**:
- For **onboarding agents**: No performance badges, no evaluation, and attendance grids only render for `in_field_training` or `evaluated` stages. Result: entire right column is blank.
- For **in-field training agents without evaluation**: Only attendance grids show, leaving significant vertical dead space below.
- The left column has useful tools (rating, license, checklist) but the right side floats empty.

**Fix**: Fill the right column for ALL stages with contextually relevant data:
- **Onboarding agents**: Show a compact "Getting Started" summary (days since joined, license progress bar, next steps checklist progress %, manager assignment)
- **All agents**: Show compact production summary (week/month AOP + deals) even if zero, and contact history summary (last contacted, total touchpoints)
- Move the attendance status dropdown INTO the right column content area instead of floating alone

### 2. Red "Never" Contact Label — False Alarm
`getContactInfo()` at line 171-177 returns `{ label: "Never", color: "text-red-500" }` when `lastContactedAt` is null. This fires for:
- Brand new agents with no applications assigned yet
- Agents added manually who haven't had leads routed to them
- Unlicensed pipeline applicants

These are NOT stale contacts — they're just new. Showing alarming red "Never" is misleading.

**Fix**: Differentiate between "never contacted because stale" vs "new agent, no leads yet":
- If agent has **zero applications** (no `lastContactedAt` AND no leads assigned), show neutral gray "New" instead of red "Never"
- Only show red "Never" for agents who HAVE assigned applications but haven't been contacted
- In `isStaleAgent()` (line 166-169), also check if the agent actually has applications — don't flag brand-new agents as stale

### 3. "ALP" Labels Still Scattered Across Codebase
Despite previous fixes, "ALP" remains in:

| File | Lines | Current | Should Be |
|------|-------|---------|-----------|
| `DashboardCRM.tsx` (expanded row) | 472, 477 | "Week ALP", "Month ALP" | "Week AOP", "Month AOP" |
| `DashboardCRM.tsx` (table header) | 935 | "Week ALP" | "Week AOP" |
| `ManagerTeamView.tsx` | Multiple | "ALP" labels | "AOP" |
| `CompactProductionEntry.tsx` | 180, 256, 306 | "ALP" references | "AOP" |
| `AgentProfileEditor.tsx` | 318 | "ALP" | "AOP" |
| `DuplicateMergeTool.tsx` | 238-274 | "alp" variable names | Cosmetic only, but labels should say "AOP" |
| `AgentCRM` interface | 111 | `weeklyALP` | Rename to `weeklyAOP` (or at minimum fix display labels) |

**Fix**: Global find-and-replace of all user-facing "ALP" labels to "AOP" across all dashboard components.

### 4. CRM Table Column Optimization
Current table headers (lines 929-938): Agent | License | Contact | Course | [Week ALP] | [Deals] | Attend. | chevron

The "Course" column shows just a checkmark or dash — wasted space. The "Attend." column shows a tiny badge.

**Fix**: Merge Course status INTO the License column as a sub-indicator. Replace standalone Course column with "AOP" (showing week AOP for all agents, not just live). This eliminates dead columns and adds data density.

### 5. Expanded Row Right Column Fill Strategy

For each stage, fill the right column with:

**Onboarding agents** (currently empty right column):
- Days since joined counter
- License progress visual bar (unlicensed → course → test → licensed)
- Manager assignment badge
- Quick production snapshot (even if $0 — shows they haven't started)

**In-Field Training agents**:
- Keep attendance grids (already there)
- Add weekly production summary
- Add days-in-training counter prominently

**Live agents**:
- Keep attendance + performance badges
- Add month-to-date production summary
- Add closing rate with color coding (red <30, yellow <60, green ≥60)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/DashboardCRM.tsx` | 1. Fix `getContactInfo()` to show neutral "New" instead of red "Never" for agents without applications. 2. Fix `isStaleAgent()` to not flag new agents. 3. Rename all "ALP" → "AOP". 4. Fill expanded row right column with stage-appropriate content (production summary, days counter, license progress bar). 5. Merge Course column into License column, replace with AOP column. |
| `src/components/dashboard/ManagerTeamView.tsx` | Rename all "ALP" labels → "AOP" |
| `src/components/dashboard/CompactProductionEntry.tsx` | Rename "ALP" labels → "AOP" |
| `src/components/admin/AgentProfileEditor.tsx` | Rename "ALP" label → "AOP" |
| `src/components/admin/DuplicateMergeTool.tsx` | Rename "ALP" label → "AOP" |
| `src/lib/closingRateColors.ts` | Already fixed (red <30, yellow <60, green ≥60) — import into CRM expanded row |

## Technical Details

### Contact Label Logic Change (DashboardCRM.tsx)
```
// Before:
if (!agent.lastContactedAt) return { label: "Never", color: "text-red-500" }

// After:
if (!agent.lastContactedAt) {
  // Check if agent has any assigned applications
  const hasApps = agent has applications (tracked via weeklyDeals/monthlyDeals or a new hasApplications flag)
  if (!hasApps) return { label: "New", color: "text-muted-foreground" }
  return { label: "Never", color: "text-red-500" }
}
```

### Expanded Row Right Column Fill
Add a `CompactAgentSummary` section that renders for ALL stages:
- 3-stat row: Days Active | Week AOP | Month Deals
- For onboarding: license progress visual (5-step dots)
- Import `getClosingRateColor` for live agent close rate display

### Column Restructure
Replace `Course` column header/cell with `AOP` showing `agent.weeklyALP` (renamed to weeklyAOP) formatted as currency. Move the course checkmark into the License badge as a small indicator icon.

