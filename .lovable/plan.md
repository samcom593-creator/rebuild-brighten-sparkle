

# Full Agent Management: Edit, Email, Password, and Performance Fixes

## Problem Summary

The `AgentQuickEditDialog` (used in both Dashboard Agency Roster and Command Center) is missing critical admin capabilities:

1. **Cannot update agent email** -- the `update-user-email` edge function exists but is never called from the edit dialog
2. **Cannot reset agent password** -- no password reset option in the dialog (the `setup-agent-password` function only creates NEW accounts, not resets)
3. **Only updates `agents.display_name`** -- does NOT update `profiles.full_name`, so name changes don't propagate
4. **Sidebar navigation lag** -- still some sluggishness from heavy CRM/Dashboard queries

## Changes

### 1. `src/components/dashboard/AgentQuickEditDialog.tsx` -- Add Full Admin Controls

For agents who already have a login (`hasExistingLogin = true`), add:

- **Email field**: Show current email with an "Update Email" button that calls `update-user-email` edge function with `targetUserId`
- **Password reset**: Add a "New Password" field with a "Set Password" button that calls `supabaseAdmin.auth.admin.updateUserById` via a new edge function (since `setup-agent-password` only creates new accounts)
- **Full name sync**: When saving display name, also update `profiles.full_name` (not just `agents.display_name`) so the name change appears everywhere

Current save logic only does:
```
agents.update({ display_name })
profiles.update({ phone })  // only if profile_id exists
```

New save logic will do:
```
agents.update({ display_name })
profiles.update({ full_name, phone, instagram_handle })  // via user_id
```

- **Send Login button**: Add a "Send Login" button inside the dialog for agents with accounts (calls `send-agent-portal-login`)

### 2. New Edge Function: `supabase/functions/reset-agent-password/index.ts`

Create a new edge function for admins to reset an existing agent's password:
- Accepts `{ targetUserId, newPassword }`
- Validates caller is admin via JWT
- Calls `supabaseAdmin.auth.admin.updateUserById(targetUserId, { password: newPassword })`
- Returns success/error

### 3. `src/components/dashboard/AgentQuickEditDialog.tsx` -- UI Layout

The edit dialog will be reorganized into clear sections:

- **Profile Info** (name, phone, Instagram) -- always visible
- **Account Management** (email update, password reset, send login) -- only for agents with existing login
- **Create Account** (existing "Create & Send Login" section) -- only for agents WITHOUT login
- **Production Edit** (ALP/deals) -- admin only
- **Merge / Delete** -- existing functionality, unchanged

### 4. `src/components/dashboard/ManagerTeamView.tsx` -- Profile Name Update

When the `AgentQuickEditDialog` saves and calls `onUpdate` (which is `fetchTeamData`), the roster will refresh with updated names. No additional changes needed here since it already passes `onUpdate={fetchTeamData}`.

### 5. Performance: Sidebar Navigation

Add `React.memo` wrapper to the `ManagerTeamView` component's `renderMemberCard` function to prevent unnecessary re-renders during sidebar navigation. The `useInFlightGuard` hook is already correctly implemented.

---

## Technical Details

### Edge Function: `reset-agent-password`
```
POST /reset-agent-password
Body: { targetUserId: string, newPassword: string }
Auth: Bearer token (admin only)
Action: supabaseAdmin.auth.admin.updateUserById(targetUserId, { password })
```

### AgentQuickEditDialog Save Flow (Updated)
```
1. Update agents.display_name
2. If agent has user_id:
   a. Update profiles.full_name via user_id
   b. Update profiles.phone via user_id
   c. Update profiles.instagram_handle via user_id
3. If admin changed production, update daily_production (existing logic)
```

### Email Update Flow
```
1. Admin clicks "Update Email" in dialog
2. Calls update-user-email edge function with { newEmail, targetUserId: agent.user_id }
3. Edge function updates auth.users + profiles table
4. Sends notification emails to old and new addresses
```

### Password Reset Flow
```
1. Admin enters new password in dialog
2. Clicks "Set Password"
3. Calls reset-agent-password edge function
4. Edge function updates auth user password via admin API
5. Toast confirms success
```

## Files Changed

| File | Change |
|------|--------|
| `src/components/dashboard/AgentQuickEditDialog.tsx` | Add email update, password reset, full_name sync, Instagram edit, Send Login button |
| `supabase/functions/reset-agent-password/index.ts` | New edge function for admin password reset |
| `supabase/config.toml` | Add `verify_jwt = false` for new function |

