
# Bug Fix Plan: Critical Issues

This plan addresses four critical issues you reported, prioritized by impact:

---

## Priority 1: Portal Login Email Not Sending (CRITICAL)

### Root Cause
The edge function logs show the email was "sent" (`Portal login email sent to kebbeh045@gmail.com`) multiple times, and tracking records exist in the database with `open_count: 0`. However, the email is not being received.

**Investigation reveals**: The "from" email domain is `notifications@tx.apex-financial.org` but previously it was `noreply@apex-financial.org`. This subdomain change may be causing deliverability issues.

### Fix
1. Change the "from" address back to verified domain: `APEX Financial <noreply@apex-financial.org>`
2. Redeploy the edge function
3. Test with your email address first

---

## Priority 2: Manager Leaderboard Only Shows Current User

### Root Cause
After reviewing the `ManagerLeaderboard.tsx` code, the component queries:
1. All active agents
2. Filters to only those with "manager" role in `user_roles` table
3. Gets their application counts from the `applications` table

The issue is an **RLS (Row-Level Security) policy problem** on the `profiles` table. The current SELECT policies only allow:
- Users to see their own profile
- Managers to see their direct team's profiles
- Admins to see all profiles

This means when building the leaderboard, a manager cannot see other managers' names since they don't have permission to read other managers' profiles.

### Fix
Add a new RLS policy on the `profiles` table that allows any authenticated manager to view the profile names of other managers:

```sql
CREATE POLICY "Managers can view all manager profiles"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) AND
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = profiles.user_id
    AND user_roles.role = 'manager'
  )
);
```

This allows managers to see other managers' profiles for leaderboard purposes while maintaining privacy for regular agent data.

---

## Priority 3: CRM Attendance Grid Missing Day Letters

### Root Cause
The `AttendanceGrid.tsx` component has `DAYS = ["Su", "M", "T", "W", "Th", "F", "Sa"]` defined but only displays icons (checkmark/X) inside the day buttons, not the day letters.

### Fix
Add day letter labels above the attendance grid. Update the component to show:
```
         Su  M  T  W  Th  F  Sa
Meeting: [✓] [✓] [-] [-] [-] [-] [-]
Sold:    [✓] [-] [-] [-] [-] [-] [-]
```

This adds minimal visual overhead while making the dates clear.

---

## Priority 4: CRM Expanded View Slow Loading / Stuck

### Root Cause
When clicking on a stage card (In Course, Live, etc.) to expand it, the `expandedColumn` state triggers a re-render. The animation with `AnimatePresence mode="wait"` combined with nested data fetching causes perceived slow loading.

The issue is not an "infinite loop" but rather:
1. Multiple cascading queries when expanding
2. Animation transitions blocking UI
3. All agent notes fetching on mount (AgentNotes has `useEffect` that fetches on initial render)

### Fixes
1. **Reduce animation transitions**: Use faster durations in the expand animation
2. **Lazy-load agent notes**: Only fetch notes when the notes section is expanded, not on card mount
3. **Add loading skeleton**: Show skeleton placeholders immediately while data loads
4. **Debounce the expansion**: Add a small delay before triggering the expanded view to prevent double-clicks

---

## Technical Implementation Details

### Email Fix (send-agent-portal-login)
```typescript
// Line 89: Change from
from: "APEX Financial Empire <notifications@tx.apex-financial.org>"
// To
from: "APEX Financial <noreply@apex-financial.org>"
```

### RLS Policy (SQL Migration)
```sql
-- Allow managers to view other managers' profiles for leaderboard
CREATE POLICY "Managers can view manager profiles for leaderboard"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = profiles.user_id
    AND user_roles.role = 'manager'
  )
);
```

### AttendanceGrid.tsx Changes
- Add a header row showing day abbreviations (Su, M, T, W, Th, F, Sa)
- Keep existing tooltip functionality for full date on hover

### DashboardCRM.tsx Performance
- Change animation duration from 0.15s to 0.1s
- Add immediate loading skeleton when expanding
- Modify AgentNotes to lazy-load

---

## Testing Plan

After implementation:
1. **Email**: Send a test portal login to your email (info@kingofsales.net) first
2. **Leaderboard**: Log in as a non-admin manager and verify other managers appear
3. **CRM Dates**: Check that day letters (Su, M, T, W, Th, F, Sa) appear above attendance grid
4. **CRM Speed**: Test expanding each stage and verify it loads within 1-2 seconds

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/send-agent-portal-login/index.ts` | Fix "from" email address |
| SQL Migration | Add RLS policy for manager profile visibility |
| `src/components/dashboard/AttendanceGrid.tsx` | Add day letter header row |
| `src/pages/DashboardCRM.tsx` | Optimize animations, add loading states |
| `src/components/dashboard/AgentNotes.tsx` | Lazy-load notes instead of fetching on mount |
