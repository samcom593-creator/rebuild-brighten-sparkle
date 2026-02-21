

# Recruiter HQ Elite Upgrade — Phased Implementation Plan

This is a large-scale initiative. To deliver quality without breaking things, we split into **3 phases**, starting with the highest-ROI items.

---

## PHASE 1 — Lead Activity Timeline + Layout Polish (Core)

### 1A. New Database Table: `lead_activity`

Create a `lead_activity` table to track all interactions with leads.

**Columns:**
- `id` (uuid, PK)
- `lead_id` (uuid, FK to applications.id, indexed)
- `actor_user_id` (uuid, nullable)
- `actor_name` (text, nullable, denormalized)
- `actor_role` (text, nullable)
- `activity_type` (text, required) -- e.g. `call_attempt`, `email_sent`, `stage_changed`, `note_added`, `calendly_link_sent`
- `title` (text, required)
- `details` (jsonb, nullable)
- `created_at` (timestamptz, default now(), indexed)

**RLS Policies:**
- Admins: full access (ALL)
- Managers: SELECT on leads assigned to them or their team
- Agents/recruiters: SELECT + INSERT on their assigned leads

**Indexes:**
- `lead_id` + `created_at DESC` composite index for fast timeline queries

**Realtime:** Enable via `ALTER PUBLICATION supabase_realtime ADD TABLE lead_activity`

### 1B. Activity Logging Utility

Create `src/lib/logLeadActivity.ts`:
- Single async function: `logLeadActivity({ leadId, type, title, details })`
- Auto-populates `actor_user_id`, `actor_name`, `actor_role` from current auth session
- Fire-and-forget (never blocks UI; `console.warn` on failure in dev)
- Used by all action handlers in RecruiterDashboard

### 1C. Auto-Log Activity for Key Events

Instrument the existing `RecruiterDashboard.tsx` handlers:

| Event | activity_type | title | details |
|---|---|---|---|
| Call button clicked | `call_attempt` | "Called {name}" | `{ phone }` |
| Email sent (QuickEmailMenu) | `email_sent` | "Email sent" | `{ template }` |
| Licensing instructions sent | `email_sent` | "Licensing instructions sent" | `{ channel: "email" }` |
| Calendly link opened | `calendly_link_sent` | "Calendly link sent" | `{ link_type }` |
| Stage changed (LicenseProgressSelector) | `stage_changed` | "Stage moved" | `{ from_stage, to_stage }` |
| Note saved | `note_added` | "Note added" | `{ note_preview: first 140 chars }` |

### 1D. ActivityTimeline Component

Create `src/components/recruiter/ActivityTimeline.tsx`:
- Vertical timeline with left border + colored dots
- Each item: title, relative timestamp (exact on hover), actor name/role, optional detail line
- Newest first by default
- Uses TanStack Query with `lead_id` in query key
- Subscribes to realtime inserts on `lead_activity` for live updates

### 1E. Timeline Integration into LeadCard

- Add a collapsible "Recent Activity" section (last 3 items) below the notes toggle
- Uses the same expand/collapse pattern as existing notes
- On desktop: shows inline; on mobile: collapsed by default

### 1F. Layout Polish

- **Mobile kanban**: On small screens, switch from grid to a segmented tab control that shows one column at a time (avoid tiny cards)
- **Card consistency**: Fixed padding (`p-2.5`), fixed action bar height (`h-7`), no layout shift
- **Virtualization**: If a column has 20+ cards, render only visible ones using a simple scroll-based approach (CSS `max-h-[60vh] overflow-y-auto` is already in place; add lazy rendering for 50+ cards)
- **Reduce heavy animations**: Disable `whileHover` and per-card `motion.div layout` when list has 30+ items

---

## PHASE 2 — Lead Scoring + Smart Follow-Ups (Intelligence Layer)

### 2A. Lead Score Field

Add `lead_score` (integer, 0-100) column to `applications` table.

**Scoring formula (computed on activity log or stage change):**
- Licensed = +25
- Test scheduled = +20
- Replied in last 48h = +15
- No contact 72h+ = -20
- Multiple notes (3+) = +10
- Applied + booked call = +15
- Referred by agent = +10

Display as color badge on card: Red (less than 40), Yellow (40-70), Green (70+). Add "Sort by Score" option.

### 2B. Smart Follow-Up Engine

Add `next_action_at` (timestamptz) and `next_action_type` (text) columns to `applications`.

Auto-assign rules:
- New lead: 10 min follow-up
- No answer: 24h follow-up
- In course: 3-day check-in
- Test scheduled: 24h reminder

Add "Action Required Now" strip at top of Recruiter HQ showing overdue count. One-click "Mark Done" logs timeline entry.

### 2C. Call Outcome Tracking

When logging a call, show a quick outcome selector:
- No Answer / Left Voicemail / Spoke - Interested / Spoke - Not Interested / Wrong Number

Store in `lead_activity.details`. Add filter: "Show all Interested leads not yet scheduled."

---

## PHASE 3 — Performance + Analytics (Command Layer)

### 3A. Recruiter Performance Board

Metrics panel above Kanban:
- Leads Assigned, Contact Rate %, License Rate %, Avg Days to Licensed, 7-Day Activity Count

### 3B. Conversion Funnel Heatmap

Track time between stages. Visual funnel with drop-off % at each stage. Highlight bottleneck in red.

### 3C. Auto No-Show Recovery

On `meeting_scheduled` with `no_show` status: auto-send SMS (15 min) + email (2 hrs) + create follow-up task. Track No-Show Recovery Rate %.

### 3D. Daily Execution Mode

Toggle that filters to only: overdue leads, high-score leads, leads with no contact 48h+. Hides everything else for focused work.

---

## Files Changed/Created (Phase 1)

| File | Action |
|---|---|
| `supabase/migrations/XXXX_create_lead_activity.sql` | New migration |
| `src/lib/logLeadActivity.ts` | New utility |
| `src/components/recruiter/ActivityTimeline.tsx` | New component |
| `src/pages/RecruiterDashboard.tsx` | Modified (add activity logging calls, timeline integration, mobile tab layout) |
| `src/components/dashboard/LicenseProgressSelector.tsx` | Modified (pass `onBeforeChange` to capture from_stage for activity log) |

## Technical Notes

- All activity logging is fire-and-forget to maintain sub-1s UI responsiveness
- TanStack Query with 120s staleTime for timeline data, realtime subscription for live updates
- No breaking API changes; `lead_activity` is a new additive table
- RLS policies follow the existing `has_role()` / `get_agent_id()` pattern
- The massive feature list (Parts 4-12, add-ons like OCR, SMS integration, AI coaching, etc.) is documented as future phases and will be tackled incrementally after Phase 1-3 are stable

