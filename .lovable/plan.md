

# Add "View Application" Button Across Dashboards

## Problem

The user wants to tap on any agent/lead from any dashboard view (main Dashboard, CRM, Recruiter HQ, Pipeline) and instantly view their full application details -- without having to navigate to the Applicants page and search for them.

Currently, the `DashboardApplicants` page (`/dashboard/applicants`) renders detailed application cards with contact info, license progress, notes, AI summary, and action buttons. But there's no quick way to jump to a specific application from the CRM table, the Recruiting Quick-View, or the Pipeline.

## Plan

### 1. Create a Reusable "View Application" Sheet/Dialog

**File: `src/components/dashboard/ApplicationDetailSheet.tsx`** (NEW)

A reusable `Sheet` (slide-over panel) that fetches and displays full application details for a given `applicationId` or `agentId`. This avoids navigating away from the current page.

Contents:
- Header: Name, email, phone, city/state, Instagram
- Badges: License status, license progress, onboarding stage, course purchased
- Timeline: Created date, contacted date, last contacted, qualified, contracted
- Previous experience (company, years)
- Notes section (read-only display of `applications.notes`)
- AI Summary button (reuses existing `ApplicantSummary` component)
- Quick actions: Call, Email, Schedule Interview link
- Close button

Data fetching:
- Accept either `applicationId` (direct lookup) or `agentId` (lookup via `applications.assigned_agent_id`)
- Single `useQuery` call to `applications` table with the relevant filter
- Also fetch from `profiles` for display name if needed

### 2. Add "View Application" Button to CRM Table Rows

**File: `src/pages/DashboardCRM.tsx`** — Add a `FileText` icon button in the Actions column (alongside Phone, Mic, Hide, Deactivate) that opens the `ApplicationDetailSheet` for that agent.

Each CRM table row already has `agent.id` -- the sheet will look up the application by `assigned_agent_id`.

### 3. Add "View Application" Link to Recruiting Quick-View

**File: `src/components/dashboard/RecruitingQuickView.tsx`** — Make the agent name clickable to open the `ApplicationDetailSheet` instead of just linking to `/dashboard/crm`. Each row already has `agent.applicationId` available.

### 4. Add "View Application" Button to Call Center Lead Cards

**File: `src/components/callcenter/CallCenterLeadCard.tsx`** — Add a `FileText` icon button in the actions row (next to Schedule, Email, Licensing) that opens the `ApplicationDetailSheet` with the lead's `id`.

### 5. Add "View Application" to Pipeline Cards

**File: `src/components/pipeline/KanbanBoard.tsx`** — Add a small "View" button on each pipeline card that opens the `ApplicationDetailSheet`.

---

## Technical Details

| File | Type | Change |
|------|------|--------|
| `src/components/dashboard/ApplicationDetailSheet.tsx` | **NEW** | Reusable Sheet component showing full application details |
| `src/pages/DashboardCRM.tsx` | MODIFY | Add FileText button in Actions column to open sheet |
| `src/components/dashboard/RecruitingQuickView.tsx` | MODIFY | Make name clickable → open sheet |
| `src/components/callcenter/CallCenterLeadCard.tsx` | MODIFY | Add "View Application" icon button |
| `src/components/pipeline/KanbanBoard.tsx` | MODIFY | Add "View" button on pipeline cards |

### ApplicationDetailSheet Props
```typescript
interface ApplicationDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId?: string;  // Direct lookup
  agentId?: string;        // Lookup via assigned_agent_id
}
```

### Data Query
```typescript
const { data: application } = useQuery({
  queryKey: ["application-detail", applicationId, agentId],
  queryFn: async () => {
    let query = supabase.from("applications").select("*");
    if (applicationId) query = query.eq("id", applicationId);
    else if (agentId) query = query.eq("assigned_agent_id", agentId);
    const { data } = await query.is("terminated_at", null).maybeSingle();
    return data;
  },
  enabled: open && !!(applicationId || agentId),
});
```

No database migrations needed. No new edge functions. All data is already available via existing `applications` table and RLS policies.

