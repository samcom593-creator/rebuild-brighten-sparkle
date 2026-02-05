# ✅ COMPLETED: Add "Promote to Manager" Action in Command Center

## Summary

Added a simple one-click "Promote to Manager" option in the Command Center's agent dropdown menu. Admins can now instantly promote any agent to manager status so they can be assigned leads.

---

## What Was Implemented

### 1. "Promote to Manager" Menu Option ✅

In the Command Center's agent dropdown menu (the three dots):
- **Icon**: Crown icon
- **Label**: "Promote to Manager"
- **Visibility**: Only shows if agent is NOT already a manager and has a user account
- **Action**: Inserts a `manager` role into `user_roles` table

### 2. "Remove Manager Role" Option ✅

The reverse action for flexibility:
- **Icon**: UserMinus icon
- **Label**: "Remove Manager Role"
- **Visibility**: Only shows if agent IS already a manager
- **Action**: Deletes the `manager` role from `user_roles` table

### 3. Manager Badge ✅

Shows a teal "Manager" badge next to agent names who are managers for quick identification.

---

## User Flow

1. Open Command Center
2. Find any agent in the leaderboard
3. Click the three dots menu
4. Click "Promote to Manager"
5. Agent immediately becomes a manager and can be assigned leads

No complicated invite links. No separate pages. Just one click.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/pages/DashboardCommandCenter.tsx` | Added promote/demote menu items, fetch manager status, handle role updates, manager badge |

---

## Technical Details

- Fetches manager roles from `user_roles` table alongside agent data
- Uses `isManager` flag in `AgentWithStats` interface
- Promote handler inserts into `user_roles` with `role: "manager"`
- Demote handler deletes from `user_roles` where `role = "manager"`
- RLS ensures only admins can perform these actions
