

# Plan: Bulk Aged Lead Assignment + Manager Lead Isolation

## 1. Upgrade Bulk Aged Lead Assignment UX

**Current state:** The QuickAssignPanel has a small number input (defaulting to 5) and a single "Send" button. It's hard to quickly send 100 leads to a manager.

**Changes to `src/pages/DashboardAgedLeads.tsx`:**

Replace the current QuickAssignPanel with a more prominent version:
- Add preset quantity buttons: **25**, **50**, **100**, **All** — one tap sets the count
- Keep the manual number input for custom amounts
- Make the panel visually larger/clearer so it's obvious how to use
- Add a "Select first N unassigned" button that auto-checks rows for review before sending
- When assigning 50+ leads, show a confirmation dialog with the count and manager name before executing

Also improve the existing selection bar (bottom bar when rows are checked):
- Add a "Select 100" quick button alongside the existing select-all checkbox
- Keep the existing assign-to dropdown in the selection bar

## 2. Fix Manager Lead Isolation (RLS)

**Current state:** I audited the RLS policies on both `applications` and `aged_leads`:

- `applications` has correct manager SELECT policies that restrict visibility to `assigned_agent_id = own agent ID OR sub-agents`. However, there are **duplicate policies** ("Managers can view team applications" AND "Managers can view their team applications" — identical logic). Same for UPDATE. These are harmless but messy.
- `aged_leads` correctly restricts managers to `assigned_manager_id = get_agent_id(auth.uid())`.

**RLS is already enforced correctly** — managers cannot see each other's leads at the database level. The duplicates should be cleaned up.

**Database migration:**
- Drop the duplicate "Managers can view their team applications" SELECT policy
- Drop the duplicate "Managers can update their team applications" UPDATE policy
- This leaves the correctly-named originals in place

No frontend changes needed for isolation — the database already enforces it.

## Files to modify

| File | Change |
|------|--------|
| `src/pages/DashboardAgedLeads.tsx` | Upgrade QuickAssignPanel with preset buttons (25/50/100/All), confirmation dialog for large batches, "Select 100" quick button |
| Database migration | Drop 2 duplicate RLS policies on `applications` |

