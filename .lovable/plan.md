

# Public Manager Recruiting Leaderboard Plan

This plan makes the recruiting leaderboard public across all managers' dashboards so everyone can see where they rank amongst each other.

---

## Current State Analysis

Based on my review:

1. **Manager Leaderboard Component** (`ManagerLeaderboard.tsx`):
   - Already fetches ALL managers from `user_roles` table
   - Already shows rankings for all managers with their recruits
   - Already highlights the current user's position
   - Uses real-time subscriptions for instant updates

2. **Daily Leaderboard Email** (`send-daily-leaderboard-summary`):
   - Already sends to ALL managers
   - Shows complete rankings with everyone's position
   - Includes motivational messaging about how close they are to next rank

3. **Real-time Notifications** (`notify-all-managers-leaderboard`):
   - Already broadcasts to all managers when someone scores a recruit

**Good news**: The recruiting leaderboard is already designed to be public! All managers can see everyone's rankings.

---

## What Needs Verification/Confirmation

### 1. Database Visibility
The current queries use the service role key in edge functions, which bypasses RLS. The frontend component (`ManagerLeaderboard.tsx`) queries:
- `agents` table - to get all active agents
- `user_roles` table - to filter managers only
- `profiles` table - to get names
- `applications` table - to count recruits

These all have proper RLS policies that allow managers to view necessary data.

### 2. Dashboard Visibility
The `ManagerLeaderboard` component is already displayed in `Dashboard.tsx` (line 399) for all users in the "Growth & Recruitment" section.

---

## Enhancements to Implement

### 1. Add "Your Numbers" Summary Card
Add a prominent card showing the current manager's recruiting stats at the top of the leaderboard:
- Your Rank: #X of Y managers
- Your Total Recruits: X
- Gap to #1: X recruits away

### 2. Confirm Daily Email Schedule is Active
Verify the cron job for `send-daily-leaderboard-summary` is scheduled (8 AM EST daily per memory).

### 3. Add Real-time Position Tracking
Similar to the sales leaderboard rank change indicators, add rank change tracking to show if a manager moved up or down.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/ManagerLeaderboard.tsx` | Add "Your Stats" summary card at top, add rank change indicators |

---

## Confirmation Checklist

After implementation, the following will be confirmed:

1. ✅ All managers can see the complete recruiting leaderboard in their Dashboard
2. ✅ All managers receive daily email with full leaderboard rankings
3. ✅ Real-time notifications when any manager scores a recruit
4. ✅ Each manager sees their personal rank highlighted with "(You)"
5. ✅ Your numbers (admin/Samuel James) are included in the leaderboard

---

## Technical Implementation

### File: `src/components/dashboard/ManagerLeaderboard.tsx`

**Changes:**

1. **Add Personal Summary Card** (top of component):
   - Show "Your Rank: #X"
   - Show "Total Recruits: X"
   - Show "Gap to #1: X recruits away" (if not #1)
   - Show "You're #1! 👑" (if leading)

2. **Add Rank Change Indicator**:
   - Store previous rankings in localStorage
   - Compare to current rankings on fetch
   - Display +/- indicators like the sales leaderboard

3. **Visual Polish**:
   - Add pulsing glow effect when manager moves into top 3
   - Add "LIVE" badge to indicate real-time updates

---

## Expected Outcome

After implementation:
- All managers see public recruiting leaderboard in Dashboard
- Each manager sees exactly where they rank among peers
- Daily emails continue to go out with full rankings
- Real-time updates when anyone scores a recruit
- Your numbers (Samuel James) appear in the leaderboard as admin/manager
- Motivational messaging shows how close they are to moving up

The system is already set up for public visibility - this plan adds polish and confirmation that everything is working correctly.

