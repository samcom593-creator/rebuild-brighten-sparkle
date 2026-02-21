
# Make Activation Risk Banner Interactive with Agent Actions

## Current Problem
The Activation Risk Banner is purely informational -- it shows a count of at-risk agents (no production in 14+ days) but clicking it does nothing. You want to tap it, see who those agents are, and take action on each one (deactivate, move to inactive, remove, etc.).

## Solution

Transform the banner into a clickable element that expands to show the full list of at-risk agents with one-tap action buttons for each.

### How It Will Work
1. **Tap the banner** -- it expands inline (or opens a sheet/dialog) showing the list of at-risk agents with their name, last production date, and days since last activity
2. **Each agent row has quick actions**:
   - **"Move to Inactive"** -- sets `is_inactive = true` (soft removal, keeps data)
   - **"Deactivate"** -- opens the existing `DeactivateAgentDialog` for full options (terminate, switch teams, remove from system)
   - **"Dismiss"** -- hides that agent from the risk list for 7 days (without changing their status)
3. **Bulk action**: A "Move All to Inactive" button at the bottom to handle the entire list in one tap
4. After any action, the list and count update immediately

### Visual Design
- The banner stays as-is when collapsed (amber warning card with count)
- On tap, it expands with a smooth animation to show agent rows
- Each row: Agent name | Last active date | Days inactive | Action buttons
- Compact rows to fit many agents without excessive scrolling

---

## Technical Details

### File: `src/components/dashboard/ActivationRiskBanner.tsx` (REWRITE)
- Change the query to return the full agent list (not just a count) -- fetch `agents.id`, `agents.user_id`, join with `profiles.full_name`, and compute last production date from `daily_production`
- Add `expanded` state toggled by clicking the banner
- When expanded, render agent rows with:
  - Name from profiles
  - Last production date (or "Never" if none)
  - Days since last activity
  - "Inactive" button (quick action: sets `is_inactive = true`)
  - "Options" button (opens `DeactivateAgentDialog`)
  - "Dismiss" button (stores agent ID in local state to hide for current session)
- Add "Move All to Inactive" bulk action button
- Each action triggers a Supabase update, plays a sound effect, shows a toast, and refetches the query
- Import and use `DeactivateAgentDialog` for the full options flow

### No database changes needed
- The `agents` table already has `is_inactive` and `is_deactivated` columns
- The `DeactivateAgentDialog` already handles all termination/transfer flows

### Files Modified
- `src/components/dashboard/ActivationRiskBanner.tsx` -- full rewrite to interactive expandable list with actions
