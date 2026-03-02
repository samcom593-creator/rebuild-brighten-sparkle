

# Phase 3 — Pipeline Dashboard Rebuild (CRM-Style Kanban)

## Current State
- `DashboardApplicants.tsx` is a 992-line card-list view with filters, notes, recording, and actions
- `KanbanBoard.tsx` exists with 5 columns (Needs Outreach → Licensed) but cards are minimal — only name, email, contact badge, and phone
- Cards lack: lead score, assigned manager, next action, stage badge, timeline preview

## What Changes

### 1. Enhanced KanbanBoard columns (7 total)
Add two new columns to `KANBAN_COLUMNS`:
- **Applicants** (new leads, `status=new`, no `license_progress`) — first column
- **Dormant** (no contact in 14+ days) — last column

Update `COLUMN_TARGET_STAGE` mapping accordingly.

### 2. Richer pipeline cards (`KanbanBoard.tsx`)
Each card will show:
- **Lead score** badge (color-coded using `SCORE_THRESHOLDS`)
- **Assigned manager** name (passed via props)
- **Stage badge** (current `license_progress` label)
- **Last contact** freshness (already exists, keep)
- **Next action** indicator (from `next_action_type` field)
- **Timeline preview** — last activity title from `lead_activity` (fetched in parent, passed as prop)

### 3. Activity logging on drag-and-drop
In `DashboardApplicants.tsx` `onStageChange` handler, call `logLeadActivity()` after updating `license_progress` to log the stage transition to `lead_activity`.

### 4. Integration with DashboardApplicants
Add a view toggle (List / Kanban) at the top of `DashboardApplicants.tsx`. When Kanban is selected, render the enhanced `KanbanBoard` with the full application data. The existing list view remains available.

### Files Modified
| File | Change |
|------|--------|
| `src/components/pipeline/KanbanBoard.tsx` | Add 2 columns, enrich card with score/manager/stage/next-action/timeline |
| `src/pages/DashboardApplicants.tsx` | Add List/Kanban toggle, wire KanbanBoard with enriched data + activity logging |

### Technical Notes
- `KanbanApplication` interface extended with `lead_score`, `next_action_type`, `assigned_manager_name`, `last_activity_title`
- Manager names already fetched in `DashboardApplicants` — reuse `managerNames` map
- Dormant detection: cards with `last_contacted_at` older than `FOLLOWUP_TIMING.dormantDays` auto-sort to Dormant column
- No new DB tables needed — uses existing `applications`, `lead_activity`, `logLeadActivity()`

