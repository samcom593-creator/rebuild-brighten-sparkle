

# Update Lead Records from Course Data + Add Calendar Sidebar Navigation

## Part 1: Update Existing Lead Records in Database

Based on the uploaded XcelSolutions course data, the following updates need to be made to the `applications` table. Each update also appends course progress details into the lead's `notes` field.

### Updates for Existing Records (5 leads already in DB)

| Lead | Current `license_progress` | New `license_progress` | Notes to Append |
|---|---|---|---|
| **Andre Sanabria** | `unlicensed` | `finished_course` | "XCEL Pre-Licensing: 100% complete. Final Exam Score: 91/100 (Passed). Completed 2/19/2026. Time in course: 18h 47m." |
| **Malik Tobias** | `test_scheduled` | Keep `test_scheduled` | "XCEL Pre-Licensing: 100% complete (98% overall). Final Exam Score: 92/100 (Passed). Completed 2/14/2026. Time in course: 1h 39m." |
| **Demetric Fulton** | `test_scheduled` | Keep `test_scheduled` | "XCEL Pre-Licensing: 100% complete (64% overall). Final Exam Score: 74/100 (Passed). Completed 2/18/2026. Time in course: 17h 7m." |
| **Ben Gillie** | `finished_course` | Keep `finished_course` | "XCEL Pre-Licensing (PA): 28% complete (18% overall). Still in course. Time in course: 3h 9m. Enrolled 2/18/2026." |
| **Cooper Ubert** | `course_purchased` | Keep `course_purchased` | "XCEL Pre-Licensing (WI): 90% complete (61% overall). Still in course. Time in course: 4h 41m. Enrolled 2/17/2026." |

Andre is the only one who needs a `license_progress` change (from `unlicensed` to `finished_course` since he completed his pre-licensing course and passed).

### New Application Records (4 leads NOT in DB)

These 4 people have courses in XcelSolutions but no `applications` record. They will be inserted as new applications with the correct `license_progress`:

| Lead | State | Progress | `license_progress` |
|---|---|---|---|
| **Jordan McClendon** | Florida | 100% complete, exam passed (87) | `finished_course` |
| **Joshua Auguste** | Florida | 0%, course disabled | `unlicensed` |
| **Pierre Auguste** | Florida | 100% complete, exam passed (74), course disabled | `finished_course` |
| **Yosiah Augustine** | Texas | 17% in progress | `course_purchased` |

Each new record will include full course progress in the `notes` field.

## Part 2: Add "Calendar" Sidebar Navigation Item

A new **Calendar** page will be created and added to the sidebar navigation for all authenticated users (admin, manager, agent). This page provides a centralized scheduling hub.

### What the Calendar page will show:
- **Upcoming Interviews**: All scheduled interviews from `scheduled_interviews` table, displayed as a chronological list with date/time, applicant name, type (video/phone/in-person), and meeting link
- **Schedule New Meeting**: An embedded `InterviewScheduler` component to schedule interviews without leaving the page
- **Auto-Send Calendar Link**: Ability to send a Google Calendar invite link to the applicant after scheduling
- **Past Interviews**: History of completed/no-show interviews
- **Quick filters**: Today, This Week, All Upcoming

### Sidebar Changes
- Add a `Calendar` icon nav item labeled **"Calendar"** in the TOOLS section of the GlobalSidebar
- Route: `/dashboard/calendar`
- Available to all roles (admin, manager, agent)

## Part 3: Checklist Verification

All previously identified checklist items from the Final System Completion remain implemented:
- Error boundaries, feature flags, central config, schedule bar, lead scoring, smart follow-ups, activity timeline, XP system, sound effects, confetti, AI panel, interview scheduler, dark/light mode, sidebar, weekly badges, memoization, query caching
- Communication Hub (LeadDetailSheet), Daily Challenges, Dormant Badge, No-Show Recovery, Production Forecast, System Integrity Card, Activation Risk Banner -- all implemented in previous iterations

---

## Technical Implementation Details

### Step 1: Database Updates (via data insert tool)

Run SQL updates for the 5 existing leads (update `license_progress` where needed + append course notes). Run SQL inserts for the 4 missing leads as new applications.

### Step 2: Create `src/pages/CalendarPage.tsx` (NEW)

- Fetches all `scheduled_interviews` joined with `applications` for applicant names
- Groups by date (Today, This Week, Later)
- Each interview card shows: time, applicant name, type badge, meeting link button, status badge
- "Schedule Interview" button opens the existing `InterviewScheduler` dialog
- "Send Calendar Link" button generates and opens a Google Calendar URL (reusing `buildCalendarUrl` from InterviewScheduler)
- Filter tabs: Upcoming | Past | All

### Step 3: Update `src/App.tsx`

- Add lazy import for `CalendarPage`
- Add route: `/dashboard/calendar` inside the AuthenticatedShell

### Step 4: Update `src/components/layout/GlobalSidebar.tsx`

- Import `Calendar` icon from lucide-react (already imported elsewhere)
- Add `{ icon: Calendar, label: "Calendar", href: "/dashboard/calendar" }` to the TOOLS section, available for all roles (admin, manager, agent)
- Position it after "Call Center" for admin/manager, or after "My Pipeline" for agent-only users

### Files Created
- `src/pages/CalendarPage.tsx`

### Files Modified
- `src/App.tsx` (add route)
- `src/components/layout/GlobalSidebar.tsx` (add nav item)
- Database: 5 UPDATE queries + 4 INSERT queries for lead records

