

# Fix Recruiter HQ: Show All Unlicensed Leads + Add Interview Scheduling

## Problem 1: Not All Unlicensed Leads Are Showing

Currently, the data fetch in Recruiter HQ filters leads by `assigned_agent_id` -- meaning Aisha only sees leads assigned specifically to her, not ALL unlicensed leads in the system. The fix is to remove this filter so the Recruiter HQ shows every single unlicensed lead.

**What changes:**
- Remove the `assigned_agent_id` filter from the fetch query (line 756-758 in RecruiterDashboard.tsx)
- This means ALL non-terminated, non-licensed applications will appear in the Kanban board regardless of who they're assigned to

## Problem 2: No Interview Scheduling Option

The "Schedule Interview" dialog component already exists (`InterviewScheduler.tsx`) but it was never wired into Recruiter HQ. The only calendar button currently opens an external Calendly link.

**What changes:**
- Import the `InterviewScheduler` component into RecruiterDashboard
- Add a "Schedule Interview" action button (Calendar icon) to each lead card's action row
- Clicking it opens the in-app interview scheduling dialog for that specific lead
- The existing Calendly button stays as a secondary option

## Problem 3: Side Navigation Missing

The side navigation IS present in the code (GlobalSidebar renders inside AuthenticatedShell which wraps /dashboard/recruiter). If it's not appearing visually, this could be:
- The sidebar is in "fullscreen" mode (hidden)
- A mobile viewport where the sidebar is behind the hamburger menu

**What changes:**
- No structural changes needed -- the sidebar is already mounted
- Will verify it renders correctly on the Recruiter HQ route after the other fixes

---

## Technical Details

### File: `src/pages/RecruiterDashboard.tsx`

**Change 1 -- Show all unlicensed leads (remove agent filter):**

Remove lines 756-758 that conditionally filter by `assigned_agent_id`. The Recruiter HQ is already access-restricted to Aisha + admins, so showing all leads is the intended behavior.

**Change 2 -- Add InterviewScheduler:**

- Import `InterviewScheduler` from `@/components/dashboard/InterviewScheduler`
- Add state to the `LeadCard` component: `schedulerOpen` and the selected lead info
- Add a Calendar icon button in the action row (between Email and Calendly buttons)
- Render `InterviewScheduler` dialog conditionally when `schedulerOpen` is true
- On successful scheduling, refresh leads and log activity

### Files Modified
- `src/pages/RecruiterDashboard.tsx` (2 changes: query fix + interview scheduler integration)
