

# RecruiterHQ Card UX Fixes

## Problems
1. **Action buttons too small/close together** — `h-6 w-6` icons with `gap-1` are nearly impossible to tap on mobile
2. **Score badge is read-only** — no way to tap and update the lead score
3. **No Instagram handle visible** — should show `@handle` next to the name if available
4. **Last contacted not updatable** — need a "Mark contacted" button so managers can stamp `last_contacted_at = now()`

## Changes

### File: `src/pages/RecruiterDashboard.tsx`

**1. Bigger action buttons + more spacing**
- Change all action buttons from `h-6 w-6` to `h-8 w-8` (32px touch targets)
- Change icon sizes from `h-3 w-3` to `h-4 w-4`
- Change `gap-1` on the action rows to `gap-1.5`
- This applies to the Contact group (~line 492-591), Utility group (~line 597-674), and Notes button (~line 677-689)

**2. Tappable score badge → Popover with input**
- Replace the static `<Badge>` score display (~line 444-448) with a `<Popover>` containing a small number input
- On submit, update `applications.lead_score` via Supabase and refresh
- Keep the same badge styling as the trigger

**3. Instagram handle next to name**
- After the name text (~line 441), if `lead.instagram_handle` exists, show a small `@handle` text in muted style
- Display inline, truncated

**4. "Mark contacted" button on the contact freshness badge**
- Add a small `CheckCircle` button next to the last-contact badge (~line 460-463)
- On click, update `applications.last_contacted_at = new Date().toISOString()` and log activity
- Shows a quick toast confirmation

