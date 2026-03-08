

# Plan: Add "Change Login" Button to CRM & Dashboard + Fix Email Update Flow

## What's Done Already
- Login email sent to Mikey Cowden at his current email (michaelcow1210@gmail.com) ✅
- Login link also sent to his manager Samuel James (info@kingofsales.net) ✅
- **Email change to `ethernafinancial@gmail.com`** still needs to happen — the edge function requires your admin session, so you'll need to do it from the new UI once it's built

## Problem
The Account Management panel exists but is buried — it's hidden inside the `ApplicationDetailSheet` (which you have to open separately) and the `AgentQuickEditDialog` (which you have to click into from leaderboards). There's no quick way to change email/password directly from the CRM expanded row.

## Changes

### 1. Add "Change Login" button to CRM expanded row (`DashboardCRM.tsx`)
- Add a `KeyRound` icon button labeled "Change Login" in the top action bar of `AgentExpandedRow` (alongside Call, Email, Portal Login, etc.)
- Clicking it opens the `AgentQuickEditDialog` with the Account Management section front and center
- This gives you one-click access to change email, reset password, and send login links directly from the CRM

### 2. Add `onEditLogin` callback to `AgentExpandedRow` 
- New prop `onEditLogin: (agent: AgentCRM) => void`
- Wire it up in the parent `DashboardCRM` component to open the `AgentQuickEditDialog`

### 3. Wire `AgentQuickEditDialog` into `DashboardCRM.tsx`
- Import and mount `AgentQuickEditDialog` in the CRM page (currently it's only used in leaderboards)
- State: `editLoginAgent` to track which agent is being edited
- When "Change Login" is clicked, set the agent and open the dialog

### 4. Fix `update-user-email` to work without session auth
- The edge function currently uses `supabase.auth.getUser(token)` which fails when called from `supabase.functions.invoke()` because it tries to use session-based auth
- Change it to use `getClaims()` pattern (extract JWT from Authorization header, validate claims, get user ID from `sub`)
- This matches how `reset-agent-password` already works and will fix the 401 errors

## Files to Edit
1. `src/pages/DashboardCRM.tsx` — add "Change Login" button + wire AgentQuickEditDialog
2. `supabase/functions/update-user-email/index.ts` — fix auth to use getClaims pattern

## No database changes needed

