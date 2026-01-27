

# Fix Password Reset - Remove Daily Limit

## Problem Identified

The current password reset system uses **Resend** (via the `send-password-reset` Edge Function) to send emails. Resend's free tier has a **100 emails/day limit**, which is causing the error:

```
"You have reached your daily email sending quota."
```

## Solution

Replace the custom Edge Function with Supabase's **built-in `resetPasswordForEmail` method**. This uses Supabase's native email infrastructure with **no daily limits**.

## Changes Required

### 1. Update `AgentNumbersLogin.tsx`

Replace the Edge Function call with Supabase's native method:

```typescript
// BEFORE (uses Resend with quota)
const { error } = await supabase.functions.invoke("send-password-reset", {
  body: { email },
});

// AFTER (uses Supabase built-in - no quota)
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: "https://apex-financial.org/agent-portal",
});
```

### 2. Update `ProfileSettings.tsx`

Same change - switch from the Edge Function to Supabase's built-in method:

```typescript
// BEFORE
const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-password-reset`, ...);

// AFTER
const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
  redirectTo: "https://apex-financial.org/agent-portal",
});
```

### 3. Optional: Delete `send-password-reset` Edge Function

Since we're no longer using it, we can remove the Edge Function to clean up the codebase.

## Technical Details

| Aspect | Current (Resend) | After (Supabase Built-in) |
|--------|------------------|---------------------------|
| Daily Limit | 100 emails/day | **Unlimited** |
| Email Style | Custom branded | Supabase default template |
| Reliability | Dependent on Resend | Native to Supabase |
| Maintenance | Custom code to maintain | Zero maintenance |

## Trade-off

The Supabase default password reset email is more plain/simple compared to the custom APEX-branded template. However, it works reliably without limits. If branded emails are critical, you would need to upgrade Resend to a paid plan ($20/month for 5,000 emails/month).

## Files to Modify

1. `src/pages/AgentNumbersLogin.tsx` - Update `handleForgotPassword` function
2. `src/components/dashboard/ProfileSettings.tsx` - Update password reset handler
3. `supabase/functions/send-password-reset/index.ts` - Delete (optional cleanup)

