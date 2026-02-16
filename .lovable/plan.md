
# Fix Unlicensed Count -- Include All Non-Licensed People

## Root Cause

The CRM Pipeline (`DashboardCRM.tsx`) only pulls data from the **agents** table, which has just 3 unlicensed records. Meanwhile, the **applications** table has 60+ unlicensed applicants (people who applied, got approved/hired, are in the licensing process). These people are completely missing from the CRM pipeline counts.

The main Dashboard (`Dashboard.tsx`) has the same problem -- it only counts `license_status === "unlicensed"` from applications assigned to the agent, missing anyone with `pending` status.

## What Counts as "Unlicensed"

Anyone who does NOT have `license_status = 'licensed'` is unlicensed. This includes:
- Agents with `license_status = 'unlicensed'` (3 in DB)
- Agents with `license_status = 'pending'` (0 in agents, 2 in applications)  
- Applicants in any licensing progress stage: course purchased, studying, test scheduled, waiting on license, finished course -- all unlicensed until they get their actual license

## Changes

### 1. `src/pages/DashboardCRM.tsx` -- Include Applications in Pipeline

**Data Fetching**: Add a query to fetch unlicensed applicants from the `applications` table (same pattern used in `ManagerTeamView`):
- Fetch applications where `terminated_at IS NULL` and `license_status != 'licensed'` and `status IN ('approved', 'contracting')`
- Deduplicate against existing agent records by email
- Convert these applicants into `AgentCRM` objects with `agentLicenseStatus: "unlicensed"`

**Stat Card Fix**: Update the "Hired (Unlicensed)" count to use `!= 'licensed'` instead of `=== 'unlicensed'`, capturing `pending` status too:
```
// Before
a.agentLicenseStatus === "unlicensed"
// After  
a.agentLicenseStatus !== "licensed"
```

**Expanded View Filter**: Same fix for the unlicensed expanded view filter (line ~1462):
```
// Before
filteredAgents.filter(a => a.agentLicenseStatus === "unlicensed")
// After
filteredAgents.filter(a => a.agentLicenseStatus !== "licensed")
```

### 2. `src/pages/Dashboard.tsx` -- Fix Unlicensed Count

Update the unlicensed count calculation (line ~122) to count everyone who isn't licensed:
```
// Before
const unlicensed = applications.filter(a => a.license_status === "unlicensed").length;
// After
const unlicensed = applications.filter(a => a.license_status !== "licensed").length;
```

### 3. `src/components/dashboard/OnboardingPipelineCard.tsx` -- Include Pending

The pipeline card already counts by onboarding stage which is fine, but the pre-licensing count should also include `pending`:
```
// Before
if (agent.license_status === "unlicensed" && agent.has_training_course === true)
// After
if (agent.license_status !== "licensed" && agent.has_training_course === true)
```

## Files Modified
1. `src/pages/DashboardCRM.tsx` -- Add applications query, merge into agent list, fix filter logic
2. `src/pages/Dashboard.tsx` -- Fix unlicensed count to use `!== "licensed"`
3. `src/components/dashboard/OnboardingPipelineCard.tsx` -- Include pending in pre-licensing count

No database changes needed.
