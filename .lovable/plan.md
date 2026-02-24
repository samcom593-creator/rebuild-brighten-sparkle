

# Comprehensive Dashboard & Blast Optimization Plan

## User Issues Identified

1. **Blast Resume**: SMS/Push campaigns get interrupted halfway with no way to resume — need percentage tracking and a "Continue" button
2. **Total Applications Count**: Dashboard should prominently show total application count  
3. **CRM Layout**: Card-based layout is cluttered and unpleasant — needs a traditional row/table format instead of box-by-box
4. **Duplicate Merge Not Working**: Shows 49 duplicates in aged leads but can't merge them — the DuplicateMergeTool only merges `agents` table records, not `aged_leads` or `applications`
5. **Calendar Scheduling**: Needs an "Add Applicant" option when lead doesn't exist in system, plus Instagram field
6. **Schedule Button Everywhere**: Every lead card in Call Center, Lead Center, and Pipeline should have a schedule button
7. **Lead Center Slow**: Loading all applications + aged leads without pagination
8. **Remove from Pipeline**: Need ability to remove/archive people from license progress pipeline
9. **Dashboard Load Time**: Still takes a second to load

## Plan

### 1. Blast Resume System (NotificationHub)

**File: `src/pages/NotificationHub.tsx`** — Modify `BulkBlastSection`

The current blast fetches all IDs fresh each time and has no memory of previous progress. Changes:

- Add `localStorage` persistence for blast state: save `{ batchIndex, totalBatches, leadIds, type, stats, startedAt }` under key `apex_blast_progress`
- On mount, check if a previous blast exists. If so, show a "Resume Blast" card with:
  - Percentage completed (e.g., "67% — 134 of 200 batches sent")
  - Accumulated stats (Push: 45, SMS: 32, Email: 89)
  - "Continue Blast" button that picks up from `batchIndex`
  - "Discard & Start Fresh" button
- During blast, save progress to localStorage after each batch completes
- On completion (100%), clear localStorage and show final results
- Add a "Blast History" section that logs blast metadata to `notification_log` with a special channel type

### 2. CRM Conversion to Row/Table Layout

**File: `src/pages/DashboardCRM.tsx`** — Major refactor of the main view

Replace the 3-column card grid (lines 1617-1681) with a traditional table/row layout:

- Replace `GlassCard` agent cards with compact table rows
- Each row shows: Avatar + Name | Stage | License Progress | Course? | Last Contact | Weekly ALP | Actions (mic, email, licensing, hide, deactivate)
- Expandable row detail on click (shows attendance, checklist, notes, onboarding tracker)
- Keep the 4 stat cards at top as clickable filters
- Keep column headers clickable to sort by any column
- Mobile: switch to a compact list with the most essential info per row (name, stage badge, last contact)
- Remove the 3-column overview entirely; the table IS the default view
- Keep expanded single-column view for stat card drill-down, but render as table rows not cards

The key layout change:
```text
Current (cards):
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Onboarding│ │In Training│ │   Live   │
│ ┌──────┐  │ │ ┌──────┐  │ │ ┌──────┐ │
│ │Card 1│  │ │ │Card 1│  │ │ │Card 1│ │
│ └──────┘  │ │ └──────┘  │ │ └──────┘ │
│ ┌──────┐  │ │ ┌──────┐  │ │ ┌──────┐ │
│ │Card 2│  │ │ │Card 2│  │ │ │Card 2│ │
│ └──────┘  │ │ └──────┘  │ │ └──────┘ │
└──────────┘ └──────────┘ └──────────┘

New (rows):
┌─────────────────────────────────────────────┐
│ Name     │ Stage │ License │ Contact │ ALP  │
├─────────────────────────────────────────────┤
│ John S.  │ Onb.  │ Course  │ 2h ago  │ $0   │
│ Jane D.  │ Train │ Unlicen │ 3d ⚠   │ $0   │
│ Bob L.   │ Live  │ Licensed│ Today   │ $5K  │
│ ...      │       │         │         │      │
└─────────────────────────────────────────────┘
```

### 3. Fix Duplicate Merge for Aged Leads

**File: `src/components/admin/DuplicateMergeTool.tsx`** — Currently only detects duplicates in the `agents` table

The "49 duplicates" the user sees are likely aged leads with the same email/phone, not agent records. The tool doesn't scan `aged_leads` or `applications` at all.

Changes:
- Add a third tab: "Aged Lead Duplicates"
- Query `aged_leads` for duplicate emails/phones
- For aged lead duplicates, provide:
  - "Merge Notes" — combine notes from all duplicates into one record
  - "Delete Duplicates" — delete extra records, keeping the one with the most recent `last_contacted_at`
- Also add duplicate detection for `applications` table (same email = duplicate applicant)
- For application duplicates, soft-delete extras by setting `terminated_at`

### 4. Add Schedule Button to Lead Cards Everywhere

**Files:**
- `src/components/callcenter/CallCenterLeadCard.tsx` — Add schedule button next to voice recorder actions
- `src/pages/LeadCenter.tsx` — Add schedule icon button in lead row actions
- `src/components/pipeline/KanbanBoard.tsx` — Add schedule button on pipeline cards

For each location:
- Add a `Calendar` icon button that opens the `InterviewScheduler` dialog pre-populated with the lead's info
- The scheduler already exists and works — just needs to be wired in

### 5. Calendar: Add New Applicant Option

**File: `src/pages/CalendarPage.tsx`** — Modify lead search dialog

When search yields no results, show an "Add New Applicant" button that:
- Opens a mini-form inline: First Name, Last Name, Email, Phone, Instagram Handle
- On submit, inserts into `applications` table with status `new`
- Then automatically opens the scheduler for the newly created application
- Include Instagram handle field in the form

### 6. Lead Center Performance

**File: `src/pages/LeadCenter.tsx`** — Currently loads ALL applications + ALL aged leads on mount

Changes:
- Switch from `useState` + `useEffect` to `useQuery` with 120s staleTime for caching
- Add pagination: show 50 leads per page with next/prev controls
- Move the heavy `useMemo` filtering to happen on the paginated subset, not the full array
- Add a loading skeleton instead of blank screen on first load
- Run the agents/profiles lookup in `Promise.all` instead of sequential

### 7. Remove from Pipeline

**File: `src/pages/DashboardCRM.tsx`** — Add "Archive/Remove" action to agent cards

- Add a "Remove from Pipeline" option in the agent card actions (next to Hide and Deactivate)
- This sets the agent's `license_progress` back to `unlicensed` and `has_training_course` to `false` in both `agents` and `applications` tables
- Different from "Deactivate" — this just resets their licensing progress without removing them from the system
- Confirmation dialog: "This will reset {name}'s license progress. They'll remain active but will no longer appear in the license pipeline."

### 8. Dashboard Total Applications Display

The `TotalApplicationsBanner` already shows total application count on the Dashboard. However, the user may want it more prominent or placed differently.

**File: `src/pages/Dashboard.tsx`** — Verify `TotalApplicationsBanner` is visible and positioned well. The component already exists and is imported on line 42 and rendered. No changes needed here — the count IS showing. If the user can't see it, it may be below the fold. Move it higher in the render order if needed.

### 9. Dashboard Load Optimization

**File: `src/pages/Dashboard.tsx`** — The dashboard runs multiple sequential queries

- Audit and convert any remaining sequential queries to `Promise.all`
- Ensure the `useQuery` pattern is used with 120s staleTime (already implemented per memory)
- Add skeleton placeholders for each section while loading
- Lazy-load below-fold components (leaderboards, growth chart)

---

## Technical Summary

| File | Type | Change |
|------|------|--------|
| `src/pages/NotificationHub.tsx` | MODIFY | Add blast resume via localStorage, continue button, progress persistence |
| `src/pages/DashboardCRM.tsx` | MAJOR REFACTOR | Convert card layout to row/table format, add remove-from-pipeline action |
| `src/components/admin/DuplicateMergeTool.tsx` | MODIFY | Add aged leads + applications duplicate detection and merge/delete |
| `src/components/callcenter/CallCenterLeadCard.tsx` | MODIFY | Add schedule interview button |
| `src/pages/LeadCenter.tsx` | MODIFY | Add pagination, useQuery caching, performance optimization |
| `src/pages/CalendarPage.tsx` | MODIFY | Add "New Applicant" form with Instagram field when no search results |
| `src/components/pipeline/KanbanBoard.tsx` | MODIFY | Add schedule button to pipeline cards |
| `src/pages/Dashboard.tsx` | MODIFY | Optimize load order, ensure TotalApplicationsBanner visibility |

No database migrations required. No new edge functions. All changes use existing tables and RLS policies.

