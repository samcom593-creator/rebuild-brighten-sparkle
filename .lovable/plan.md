
# Add Direct Password Change to Dashboard Settings

## What You Want
Users should be able to change their password directly from the dashboard settings page by typing in a new password and clicking save - no email links required.

## Solution
Add a password change section with input fields right on the settings page. When they enter a new password and click "Update Password", it will change immediately using Supabase's built-in `updateUser` method.

## Changes to Make

### Update `ProfileSettings.tsx`

1. **Add new state variables for password fields:**
   - `newPassword` - for the new password input
   - `confirmPassword` - to confirm they typed it correctly
   - `passwordLoading` - loading state for the save button
   - `passwordSaved` - success state

2. **Add password validation:**
   - Minimum 6 characters
   - Passwords must match

3. **Create `handlePasswordChange` function:**
   ```typescript
   const handlePasswordChange = async () => {
     // Validate passwords match and meet requirements
     if (newPassword.length < 6) {
       toast({ title: "Password too short", variant: "destructive" });
       return;
     }
     if (newPassword !== confirmPassword) {
       toast({ title: "Passwords don't match", variant: "destructive" });
       return;
     }
     
     // Update password directly - no email needed!
     const { error } = await supabase.auth.updateUser({
       password: newPassword
     });
     
     if (error) throw error;
     
     toast({ title: "Password Updated!" });
     // Clear the fields
   };
   ```

4. **Replace the current "Reset Password" section with direct input fields:**
   - New Password input (with eye icon to show/hide)
   - Confirm Password input
   - "Update Password" button
   - Keep the old email reset as a secondary option ("Or send reset link")

## UI Preview

```text
┌─────────────────────────────────────────────┐
│  Change Password                            │
├─────────────────────────────────────────────┤
│  New Password                               │
│  ┌─────────────────────────────────┐        │
│  │ ••••••••                    👁  │        │
│  └─────────────────────────────────┘        │
│                                             │
│  Confirm Password                           │
│  ┌─────────────────────────────────┐        │
│  │ ••••••••                    👁  │        │
│  └─────────────────────────────────┘        │
│                                             │
│  [ Update Password ]                        │
│                                             │
│  Or send a reset link to your email         │
└─────────────────────────────────────────────┘
```

## Technical Details

- Uses `supabase.auth.updateUser({ password: newPassword })` - this works instantly for logged-in users
- No email verification needed - they're already authenticated
- Password fields are cleared after successful update for security
- Show/hide password toggle for better UX

## Files to Modify

1. `src/components/dashboard/ProfileSettings.tsx` - Add password input fields and update handler
