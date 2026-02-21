

# Phase 2 — Lead Scoring + Smart Follow-Ups + Call Outcomes

Phase 1 (Activity Timeline, logging utility, layout polish) is complete. This plan implements the three highest-ROI intelligence features from Phase 2.

---

## 2A. Lead Score System

### Database Change

Add three columns to the `applications` table:

- `lead_score` (integer, default 50) — computed score 0-100
- `next_action_at` (timestamptz, nullable) — when the next follow-up is due
- `next_action_type` (text, nullable) — what the follow-up is (e.g. "call_followup", "course_checkin", "test_reminder")

No new table needed; these extend the existing `applications` table that the Recruiter HQ already queries.

### Scoring Logic (client-side computation on fetch)

Rather than a background worker, compute the score in the dashboard from existing data:

- `license_progress = licensed` -> +25
- `test_scheduled_date` is set -> +20
- `last_contacted_at` within 48h -> +15
- `last_contacted_at` older than 72h -> -20
- `notes` is non-empty (3+ words) -> +10
- `created_at` within 7 days + `contacted_at` set -> +15
- `referral_source` is set -> +10
- Base score starts at 30, clamped to 0-100

### UI Changes in RecruiterDashboard.tsx

- Add a `computeLeadScore(lead)` helper function
- Display a color-coded score badge on each LeadCard (Row 1, next to the contact freshness badge):
  - Red badge for score less than 40
  - Yellow/amber badge for score 40-70
  - Green badge for score 70+
- Add "Score" as a new sort option in the sort dropdown

---

## 2B. Smart Follow-Up Engine

### Auto-Assign Logic

When leads are fetched, compute `next_action_at` client-side based on current state:

- New lead (no `contacted_at`): action due 10 minutes after `created_at`
- No contact in 24h+: action due now
- `license_progress = course_purchased`: action due 3 days after last contact
- `license_progress = test_scheduled`: action due 1 day before `test_scheduled_date`

### "Action Required Now" Banner

Add a highlighted strip above the kanban columns showing:
- Count of overdue leads (where computed `next_action_at` is in the past)
- "Mark Done" button that:
  1. Updates `last_contacted_at` to now
  2. Logs a `followup_completed` activity
  3. Refreshes the list

---

## 2C. Call Outcome Tracking

### UI Change

When the Call button is clicked, instead of immediately logging `call_attempt`, show a small popover/dialog with outcome options:

- No Answer
- Left Voicemail
- Spoke - Interested
- Spoke - Not Interested
- Wrong Number

### Activity Logging

Store the selected outcome in `lead_activity.details.outcome`. The `activity_type` becomes:
- `call_no_answer`
- `call_voicemail`
- `call_connected` (for Interested/Not Interested)
- `call_wrong_number`

### Filter Addition

Add a new filter option: "Interested (no meeting)" — shows leads where any `call_connected` activity has `outcome = "interested"` AND no `test_scheduled_date` is set.

---

## Files Changed/Created

| File | Action |
|---|---|
| `supabase/migrations/XXXX_add_lead_score_columns.sql` | New migration: add `lead_score`, `next_action_at`, `next_action_type` to `applications` |
| `src/pages/RecruiterDashboard.tsx` | Modified: add score computation, score badge on cards, "Action Required" banner, call outcome popover, new sort/filter options |

## Technical Notes

- Lead score is computed client-side from existing fields to avoid a background worker. This keeps it simple and avoids new edge functions.
- The `lead_score` column in the database is reserved for future server-side computation but not written to in this phase.
- `next_action_at` and `next_action_type` columns are added for future server-side automation but computed client-side for now.
- Call outcome popover uses the existing Popover component from the UI library.
- No new dependencies needed.

