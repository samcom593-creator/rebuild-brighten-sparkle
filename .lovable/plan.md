
# Fix Unassigned Leads, Revamp Accounts Page, Add Gamification + Schedule Bar Dismiss

## 1. Fix Unassigned Leads (Immediate Data Fix)

There are 3 leads currently unassigned (Joshua Auguste, Pierre Auguste, Malik Tobias). These were created before the auto-assign logic was added. The `submit-application` function already defaults new leads to admin agent ID `7c3c5581-3544-437f-bfe2-91391afb217d` (Samuel James) on line 910, so all future applications are covered.

**Fix:** Run a data update to assign the 3 orphaned leads to the admin. Also add a safety net: a database trigger that auto-assigns any application with a NULL `assigned_agent_id` to the admin.

## 2. Revamp Accounts Page (Remove Invite System, Fix N+1, Polish UI)

The current Accounts page has issues:
- The `AdminManagerInvites` section is unused clutter -- remove it entirely
- N+1 query problem: fetches profile and role individually per agent (loops through each one) -- batch this into a single efficient query
- UI is plain -- add gamified stats with animated counters, gradient cards, and sound effects on actions

**Changes:**
- Remove `AdminManagerInvites` import and usage
- Replace the N+1 fetch loop with a batch query (fetch all agents, profiles, and roles in 3 queries, then merge client-side)
- Add sound effects on edit/deactivate/reactivate actions
- Add animated counter stats with gradient styling
- Remove excessive `motion.div` stagger delays

## 3. Schedule Bar -- Dismiss/Complete Items

Currently schedule bar items open a detail sheet but cannot be dismissed inline. Add:
- An "X" dismiss button on each pill that marks the item as handled
  - For overdue/no_contact items: updates `last_contacted_at` to now (marks as contacted)
  - For interview items: marks the interview as "completed"
- A subtle swipe-to-dismiss feel with `whileTap` scale animation
- Sound effect on dismiss ("success" sound)

## 4. Agent Portal -- Add Sound Effects and Polish

The Agent Portal already has nice motion animations (spring stagger on QuickStat cards, gradient backgrounds). Add:
- Sound effects on tab switches and button clicks
- A subtle confetti burst when production numbers are submitted
- Hover glow effects on stat cards

## Technical Details

### Files Modified:

| File | Change |
|------|--------|
| `src/pages/DashboardAccounts.tsx` | Remove `AdminManagerInvites`, batch query, add sounds, animated stats |
| `src/components/layout/ScheduleBar.tsx` | Add dismiss button on pills, mark items as handled |
| `src/pages/AgentPortal.tsx` | Add `useSoundEffects` hook, play sounds on interactions |

### Database:
- Update 3 unassigned applications to set `assigned_agent_id = '7c3c5581-3544-437f-bfe2-91391afb217d'`

### Accounts batch query approach:
```text
1. Fetch all agents (id, user_id, status, created_at)
2. Fetch all profiles WHERE user_id IN [...agentUserIds]
3. Fetch all user_roles WHERE user_id IN [...agentUserIds]
4. Merge client-side in one pass
```
This replaces the current loop of N individual queries with 3 total queries.

### Schedule Bar dismiss flow:
```text
User taps X on pill -->
  if overdue/no_contact: UPDATE applications SET last_contacted_at = now()
  if interview: UPDATE scheduled_interviews SET status = 'completed'
  play success sound
  item disappears from bar (React Query refetch)
```
