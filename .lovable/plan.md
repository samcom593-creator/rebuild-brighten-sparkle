

# Fix Lead Center Stats, Aged Lead License Data, and Clean Up Agent CRM

## Issues Found

1. **Lead Center "New Leads" stat card** -- Currently counts only drip-in applications with status "new". User wants this to mean "new leads that just dropped in" (new drip-ins only). This is already correct per the last change, but the label "New Leads" is confusing -- rename to "New Drip-Ins" for clarity.

2. **Lead Center "Licensed" stat shows wrong count** -- It counts `licenseStatus === "licensed"` across all leads. But 655 aged leads have `license_status = "unknown"` in the database instead of their actual license status. The licensed count looks low because the imported aged lead data defaulted to "unknown". Need to include aged leads from the DB count properly and ensure the Licensed card reflects the real number.

3. **Lead Center Pipeline/Contacted/Closed stat cards missing** -- User wants to see: Pipeline (all active), Contacted (people called), and Closed/Hired (people marked as hired). Currently, the 4 cards are: Total Leads, Unassigned, Licensed, New Leads. Replace them with the user's requested set.

4. **Lead Center "Closed" badge should show who closed it** -- If someone else's manager closed the lead, the badge should say "Closed by [Manager Name]" instead of just "Hired".

5. **Lead Center status filter has "Qualified"** -- User says there should only be "Hired" or "Contracted", not "Qualified". Remove it.

6. **Aged Leads page: all leads showing as unlicensed** -- 655 aged leads have `license_status = "unknown"` which the UI shows as unlicensed. The licensed count filter on line 332 also excludes leads not in `["new", "contacted", "no_pickup"]` statuses. Fix the filter to count all licensed leads regardless of status, and show "unknown" leads more clearly.

7. **Agent CRM: Remove "Follow-Up" option** -- The CRM card currently shows a "Last F/U" line (last follow-up). User wants this removed.

8. **Agent CRM: Remove "Below $10K" and "Critical" buttons** -- The Performance Tier dropdown shows "Below $10K" and the Attendance Issues "Critical" stat card exists. Remove the performance tier dropdown entirely and remove the "Attendance Issues" (critical) stat card.

9. **Agent CRM: Add "Full View" column** -- Add an "All Agents" stat card that shows every agent at once (a full view).

10. **Agent CRM: Add "Unlicensed" column** -- Add a dedicated column/card showing agents whose license progress is "unlicensed" so they're easy to spot.

11. **Agent CRM: Hide licensing hat icon for licensed agents** -- The `ResendLicensingButton` currently shows for all agents including licensed ones. Only show it for unlicensed agents.

12. **Agent CRM: Auto-detect duplicates** -- Add client-side duplicate detection (by email/phone) similar to how Aged Leads already does it, and show a warning badge on duplicate agents.

## Changes

### File: `src/pages/LeadCenter.tsx`

**Stats cards** -- Replace the 4 cards with:
- "New Drip-Ins" (applications with status "new") 
- "Contacted" (leads with `contactedAt` set)
- "Closed" (leads with status "hired" or "contracted")
- "Licensed" (leads with `licenseStatus === "licensed"`)

**Closed badge** -- In the table row, when status is "hired" or "contracted", show "Closed by [Assigned Manager Name]" if a different manager closed it, or just "Hired"/"Contracted" if it's the current user.

**Status filter cleanup** -- Remove "Qualified" from the status dropdown. Keep: New, Not Contacted, Contacted, Hired, Contracted, Not Qualified.

**Licensing hat icon** -- Only render `ResendLicensingButton` when `lead.licenseStatus !== "licensed"`.

### File: `src/pages/DashboardAgedLeads.tsx`

**Fix licensed count** -- Change line 332 to count ALL leads with `licenseStatus === "licensed"` regardless of status (remove the status filter). Same for unlicensed count on line 333.

**Show "unknown" as "Unknown"** -- The license badge already handles this, but ensure it's clearly distinguishable and not lumped with "unlicensed".

### File: `src/pages/DashboardCRM.tsx`

**Remove Last F/U line** -- Remove the "Last F/U" / "No follow-up yet" section from `renderAgentCard` (lines 766-779).

**Remove Performance Tier dropdown** -- Remove the entire performance tier dropdown from the status controls section (lines 1030-1055).

**Remove "Attendance Issues" (Critical) stat card** -- Remove the critical stat card from the stats grid (lines 1245-1261). Keep attendance dropdown on cards for managers to set status.

**Add "Full View" stat card** -- Add a card labeled "All Agents" that shows total count. When clicked, expands to show all agents regardless of stage.

**Add "Unlicensed" column** -- Add a stat card labeled "Unlicensed" showing agents with `licenseProgress === "unlicensed"` or null. When clicked, shows only those agents.

**Hide licensing hat for licensed agents** -- In the "In Course" section, only show `ResendLicensingButton` when the agent's license progress is not "licensed".

**Duplicate detection** -- Add a `useMemo` that detects agents with duplicate emails or phone numbers (same pattern as Aged Leads page). Show a small warning badge on duplicates.

