

# Fix: CRM License Progress Showing Wrong Data

## Root Cause

The CRM's `fetchAgents` function looks up each agent's `license_progress` from the `applications` table using `assigned_agent_id` — which is the **recruiter/manager** who owns the lead, NOT the applicant. This means:

- Agent A's license progress shows **their recruit's** progress instead of their own
- Most agents show as "Course Not Purchased" even when they've completed courses, scheduled tests, etc.
- The Unlicensed tab columns (Course Purchased, Course Finished, Test Scheduled, Waiting on License) are mostly empty or misattributed

## Fix

### 1. `src/pages/DashboardCRM.tsx` — Fix license progress lookup

**Current (broken):** Line 647 queries `applications` by `assigned_agent_id` (recruiter ID), then maps that to the agent.

**Fix:** After fetching agents and profiles, query applications by **email match** against the agent's profile email to find each agent's OWN application and its `license_progress`.

Replace the `appLicenseResult` query and `licenseProgressMap` construction:

```typescript
// Fetch each agent's OWN application by email match
const agentEmails = [...profileMap.values()]
  .map(p => p.email?.toLowerCase().trim())
  .filter(Boolean);

const { data: ownApps } = agentEmails.length > 0
  ? await supabase.from("applications")
      .select("email, license_progress, test_scheduled_date")
      .is("terminated_at", null)
  : { data: [] };

// Build email→progress map, keeping most advanced progress
const progressOrder = ["unlicensed","course_purchased","finished_course",
  "test_scheduled","passed_test","fingerprints_done","waiting_on_license","licensed"];

const emailProgressMap = new Map<string, { progress: string; testDate: string | null }>();
for (const app of ownApps || []) {
  const email = app.email?.toLowerCase().trim();
  if (!email) continue;
  const current = emailProgressMap.get(email);
  const newIdx = progressOrder.indexOf(app.license_progress || "unlicensed");
  const curIdx = current ? progressOrder.indexOf(current.progress) : -1;
  if (newIdx > curIdx) {
    emailProgressMap.set(email, {
      progress: app.license_progress || "unlicensed",
      testDate: app.test_scheduled_date
    });
  }
}
```

Then when building `crmAgents`, look up by `profile.email` instead of `agent.id`:

```typescript
const agentEmail = profile?.email?.toLowerCase().trim();
const ownProgress = agentEmail ? emailProgressMap.get(agentEmail) : null;
// ...
licenseProgress: ownProgress?.progress || null,
testScheduledDate: ownProgress?.testDate || null,
```

### 2. Same file — Fix the separate unlicensed applicants query (lines 717-738)

The `newApplicants` merge already works correctly since it reads `license_progress` directly from the application row. No change needed there, but ensure deduplication uses the same email-matching logic.

### 3. `src/components/dashboard/OnboardingPipelineCard.tsx` — Already fixed

This component already uses email-based cross-referencing (lines 69-82). No changes needed.

## Files to modify

| File | Change |
|------|--------|
| `src/pages/DashboardCRM.tsx` | Replace `assigned_agent_id`-based license progress lookup with email-based matching; use most-advanced progress when multiple applications exist |

## Impact

- All unlicensed agents will correctly appear in their actual license stage columns
- "Course Purchased", "Course Finished", "Test Scheduled", "Waiting on License" will show accurate counts
- No database changes needed

