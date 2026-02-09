
# Fix Invitation Tracker Removal, Account Linking, and Dashboard Agent Management

## Issues to Fix

### 1. Invitation Tracker "X" button not actually removing people
**Root cause**: The `handleRemove` function in `InvitationTracker.tsx` sets `is_deactivated = true` on the agent and shows "removed" toast, but the `fetchInvitations` query does NOT filter out deactivated agents. So the agent reappears immediately when the list refreshes.

**Fix**: Add `.eq("is_deactivated", false)` to the fetch query in `InvitationTracker.tsx` (line 92, before `.order()`).

### 2. Account linking broken (`link-account` edge function)
**Root cause**: The function uses `supabaseClient.auth.getClaims(token)` which is not a valid Supabase JS method. This silently fails, returning an error and preventing agents from linking their accounts.

**Fix**: Replace the `getClaims` call with `supabaseAdmin.auth.getUser(token)` which properly verifies the JWT and returns the user ID and email. Remove the unnecessary `supabaseClient` instance entirely.

### 3. Terminated agents hidden from dashboard roster
**Root cause**: The admin query in `ManagerTeamView.tsx` filters `.eq("is_deactivated", false)`, hiding all terminated/inactive agents.

**Fix**: Remove the deactivation filter for admins, fetch ALL agents, and split them into three sections: Licensed, Unlicensed Pipeline, and Terminated/Inactive (collapsed by default). Add a "Reactivate" button for terminated agents.

### 4. No license status toggle
**Fix**: Add a toggle button in each agent's expanded card to switch between "licensed" and "unlicensed" statuses.

### 5. No UX sounds on actions
**Fix**: Integrate the existing `useSoundEffects` hook to play sounds on Send Login, Reactivate, License Toggle, and Remove actions.

---

## Technical Details

### File: `src/components/dashboard/InvitationTracker.tsx`
- Add `.eq("is_deactivated", false)` to the query at line 92

### File: `supabase/functions/link-account/index.ts`
- Remove `supabaseClient` creation (lines 37-41)
- Replace `supabaseClient.auth.getClaims(token)` (lines 44-56) with `supabaseAdmin.auth.getUser(token)` and extract `user.id` and `user.email`

### File: `src/components/dashboard/ManagerTeamView.tsx`
| Change | Detail |
|--------|--------|
| Remove `.eq("is_deactivated", false)` filter | Fetch all agents for admin view |
| Add `is_deactivated` to SELECT | Need the field to categorize agents |
| Add `terminatedOpen` state | Collapsed by default |
| Split agents into 3 groups | Licensed active, Unlicensed active, Terminated/Inactive |
| Add "Reactivate" button | Sets `is_deactivated=false`, `status=active`, `is_inactive=false` |
| Add license toggle button | Updates `license_status` column |
| Import and use `useSoundEffects` | Play success/click sounds on actions |
| Add Terminated section to JSX | Red-themed collapsible with reactivate controls |
