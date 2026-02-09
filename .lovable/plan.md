

# Critical Fixes: Coursework Blocker + System Improvements

## Priority 1: COURSEWORK FIX (Blocking Issue)

### Root Cause
All 4 course modules use **YouTube videos**, but the `CourseVideoPlayer` component has NO progress tracking for YouTube embeds. The YouTube iframe renders with a static overlay showing "X% watched" but never updates because:
1. The YouTube IFrame API is not loaded
2. `onProgressUpdate()` is never called for YouTube videos
3. `video_watched_percent` stays at 0 for all agents (confirmed in database - all 4 records show 0%)
4. The quiz tab requires 90% watched to unlock -- so nobody can take the quiz

### Fix: `src/components/course/CourseVideoPlayer.tsx`

Replace the YouTube branch with full YouTube IFrame API integration:
- Load the YouTube IFrame API script dynamically
- Use `onStateChange` events to detect when the video is playing
- Poll `getCurrentTime()` / `getDuration()` every 5 seconds to calculate watch progress
- Call `onProgressUpdate(percent)` as progress increases
- Call `onVideoComplete()` when 90% is reached
- Add a "Mark as Watched" fallback button (appears after 2 minutes) in case API tracking fails

### Also fix: `src/hooks/useOnboardingCourse.tsx`

- The `canTakeQuiz` threshold check (line ~157) correctly checks 90%, but also add a manual override: if the module progress record exists and has been active for over 5 minutes, allow quiz access as a safety net

---

## Priority 2: Lead Center Stat Card Click Filters

### Problem
The 4 stat cards (Total Leads, Unassigned, Licensed, New Leads) at the top of Lead Center are not clickable/filterable.

### Fix: `src/pages/LeadCenter.tsx`

Make each stat card clickable to set the corresponding filter:
- **Total Leads**: Reset all filters (show all)
- **Unassigned**: Set `filterManager` to "unassigned"
- **Licensed**: Set `filterLicense` to "licensed"
- **New Leads**: Set `filterStatus` to "new"

Add `cursor-pointer` and hover ring styling to each card, plus an active state indicator.

---

## Priority 3: Bulk Lead Assignment - Remove Options

### Problem
In Command Center, the Bulk Lead Assignment dropdown shows agent options but you can't remove agents from the list.

### Fix: `src/components/dashboard/BulkLeadAssignment.tsx`

The dropdown lists ALL active agents. The user wants to be able to remove specific agents from appearing as assignment options. Add:
- An "X" button next to each agent in the Select dropdown to hide them from the list
- Store hidden agents in local state (session-only, resets on page reload)
- A "Show All" reset button to bring them back

---

## Priority 4: Purchase Leads Admin Dashboard

### New Component: `src/components/dashboard/LeadPaymentTracker.tsx`

Admin-only section on the Purchase Leads page showing:
- Table of all agents marked "evaluated" (live/in-field) from the `agents` table
- Two checkboxes per agent: "$250 Paid" and "$1,000 Paid"
- Beautiful UI with glass card styling
- "Paid" badge displays in CRM for agents who have paid

### Database: New table `lead_payment_tracking`
- `id`, `agent_id`, `week_start` (date), `tier` ("standard" | "premium"), `paid` (boolean), `marked_by`, `marked_at`
- RLS: Admin-only access
- Cron job: Every Sunday at midnight CST, reset all `paid` flags for the new week

### Integration: `src/pages/PurchaseLeads.tsx`
- Show `LeadPaymentTracker` component below the packages (admin-only)

---

## Priority 5: Daily "Log Numbers" Reminder Emails

### Existing: `notify-fill-numbers` Edge Function
This already exists and handles 4pm, 7pm, 9pm reminders. Need to add 10am and adjust times to match request (10am, 6pm, 9pm CST).

### Changes:
1. Update `supabase/functions/notify-fill-numbers/index.ts` to support "10am" reminder type
2. Add/update cron jobs:
   - 10:00 AM CST (16:00 UTC): `reminderType: "10am"` - "Good morning! Start your day by logging yesterday's numbers"
   - 6:00 PM CST (00:00 UTC next day): `reminderType: "6pm"` - existing 7pm logic, adjusted
   - 9:00 PM CST (03:00 UTC next day): `reminderType: "9pm"` - existing final warning

---

## Priority 6: Dashboard Navigation Freeze Fix

### Root Cause Investigation
The freeze occurs during sidebar navigation between sections. This is likely caused by:
- Heavy re-renders when switching tabs
- Stacked realtime subscription refetches

### Fix: Performance guards
- Increase `staleTime` on Command Center and Dashboard queries to 120s
- Ensure `useInFlightGuard` is properly clearing stuck states
- Add `React.memo` to heavy list components in the leaderboard

---

## Files Summary

| File | Action | Priority |
|------|--------|----------|
| `src/components/course/CourseVideoPlayer.tsx` | Rewrite YouTube tracking with IFrame API | P1 - Critical |
| `src/hooks/useOnboardingCourse.ts` | Add safety-net quiz unlock | P1 |
| `src/pages/LeadCenter.tsx` | Make stat cards clickable filters | P2 |
| `src/components/dashboard/BulkLeadAssignment.tsx` | Add remove-from-list option | P3 |
| `src/components/dashboard/LeadPaymentTracker.tsx` | New admin payment tracker | P4 |
| `src/pages/PurchaseLeads.tsx` | Integrate payment tracker | P4 |
| `supabase/functions/notify-fill-numbers/index.ts` | Add 10am reminder | P5 |
| Database migration | `lead_payment_tracking` table + weekly reset cron | P4 |

---

## Database Changes

New table:
```sql
CREATE TABLE lead_payment_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  week_start DATE NOT NULL DEFAULT (date_trunc('week', now()))::date,
  tier TEXT NOT NULL CHECK (tier IN ('standard', 'premium')),
  paid BOOLEAN DEFAULT false,
  marked_by UUID,
  marked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, week_start, tier)
);

ALTER TABLE lead_payment_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payment tracking"
  ON lead_payment_tracking FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can view own payment status"
  ON lead_payment_tracking FOR SELECT
  USING (agent_id = current_agent_id());
```

---

## Expected Outcomes

1. **Coursework**: Agents can watch YouTube videos, progress tracks automatically, quiz unlocks at 90%
2. **Lead Center**: Clicking stat cards filters the table immediately
3. **Bulk Assignment**: Admins can hide specific agents from the dropdown
4. **Payment Tracking**: Admin sees who paid weekly, badges show in CRM, auto-resets Sunday
5. **Reminders**: 10am, 6pm, 9pm daily emails to agents who haven't logged numbers
6. **Performance**: No more freezing during sidebar navigation
