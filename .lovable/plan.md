

# Fix: Agent rows not expanding in Dashboard Team View

## Problem
In `ManagerTeamView.tsx`, clicking an agent row toggles `expandedMember` state and rotates the chevron, but **no expanded content is ever rendered**. The component is missing the entire expanded section — there's nothing between the click target div (line 464) and the closing `motion.div` (line 465).

## Fix

**File: `src/components/dashboard/ManagerTeamView.tsx`**

Add an expanded content block after the clickable header div (after line 464) that renders when `expandedMember === member.id`. The expanded section will include:

- **Mobile production stats** (Week ALP, Month ALP, Deals) — currently hidden on mobile via `hidden md:flex`
- **Quick actions row**: "View in CRM" button (navigates to `/dashboard/crm?focusAgentId={member.id}`), "Call" button (tel: link if phone available), "Email" button (mailto: link)
- **Agent details**: License status, onboarding stage, days since joined, manager assignment
- **Production summary**: Week/Month ALP with color-coded closing rate

This mirrors the CRM expanded row pattern but in a compact format suitable for the dashboard context.

