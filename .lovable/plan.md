

# Fix Password Reset Emails and Align Auth Flows

## Problems Found

1. **Missing `send-password-reset` edge function** -- The function is referenced in config and called from the Magic Login page's "Send Me a Fresh Link" feature, but the actual code file does not exist. This means the resend link button silently fails.

2. **Password reset redirect URL is wrong** -- When agents click "Forgot password?" on the Apex Daily Numbers login, it calls `resetPasswordForEmail` with `redirectTo: "https://apex-financial.org/agent-portal"`. This URL does not handle the recovery token. The redirect needs to go to a page that can process the token and let the user set a new password.

3. **No "Forgot Password" on admin/manager login** -- The `/login` page (for admins and managers) has no forgot password option at all.

4. **No password update handler for recovery tokens** -- When a user clicks the reset link in their email, they land on a page but there is no code to detect the recovery session and prompt for a new password.

---

## Plan

### 1. Create the missing `send-password-reset` edge function
- Build `supabase/functions/send-password-reset/index.ts`
- It will accept an email and a type ("reset" or "magic_link")
- For "magic_link": look up the agent by email and call the existing `generateMagicToken` logic to send a new magic link email via Resend
- For "reset": trigger `supabase.auth.admin.generateLink({ type: 'recovery', email })` and send the reset email via Resend with a proper redirect URL

### 2. Fix password reset redirect URLs
- In `AgentNumbersLogin.tsx`: change the `redirectTo` in `handleForgotPassword` from `"https://apex-financial.org/agent-portal"` to `"https://apex-financial.org/settings"` (which is the profile settings page that already has password update logic)
- In `ProfileSettings.tsx`: same fix for consistency
- In `DashboardAccounts.tsx`: same fix

### 3. Add recovery token detection in the app
- In `src/hooks/useAuth.ts` or `App.tsx`: detect when the URL contains a `type=recovery` hash parameter (set by the auth system after clicking the email link)
- When detected, redirect the user to the Settings page with a prompt to enter their new password
- The Settings page already has `supabase.auth.updateUser({ password })` logic -- just need to auto-show the password field

### 4. Add "Forgot Password" to the admin/manager Login page
- Add a "Forgot password?" link to `src/pages/Login.tsx`
- It will call `resetPasswordForEmail` with `redirectTo` pointing to `/settings`

### 5. Align all email flows
- Verify that the `send-agent-portal-login` function (magic link emails) works end-to-end (already confirmed working from logs)
- Ensure the `setup-agent-password` function properly handles the CRM-to-auth account linking (already working)
- Make sure `reset-agent-password` (admin password reset) continues working (already confirmed)

---

## Technical Details

### New file: `supabase/functions/send-password-reset/index.ts`
- Uses Resend to send branded password reset emails matching the existing APEX email template style
- For "magic_link" type: queries the agent by email, generates a magic token, sends the portal login email
- For "reset" type: generates a recovery link via `supabase.auth.admin.generateLink` and sends it via Resend

### Modified files
| File | Change |
|------|--------|
| `src/pages/AgentNumbersLogin.tsx` | Fix `redirectTo` URL in `handleForgotPassword` |
| `src/pages/Login.tsx` | Add "Forgot password?" button with `resetPasswordForEmail` call |
| `src/components/dashboard/ProfileSettings.tsx` | Fix `redirectTo` URL, add recovery session detection to auto-show password change |
| `src/pages/DashboardAccounts.tsx` | Fix `redirectTo` URL |
| `src/pages/MagicLogin.tsx` | No change needed (will work once the edge function exists) |
| `src/App.tsx` | Add `onAuthStateChange` listener for `PASSWORD_RECOVERY` event to redirect to settings |

### Auth flow after fix

```text
Agent clicks "Forgot password?"
  --> resetPasswordForEmail() called
  --> Lovable Cloud email hook sends recovery email
  --> Agent clicks link in email
  --> Redirected to app with recovery token in URL hash
  --> App detects PASSWORD_RECOVERY event via onAuthStateChange
  --> Redirected to Settings page
  --> Password change form shown automatically
  --> Agent sets new password via updateUser({ password })
  --> Done, agent can now log in
```

