

# Fix: Course Emails Going to Wrong People + Magic Link Sign-In Broken

## Two Issues

### Issue 1: Emails sent to agents who already passed
The `bulk-resend-course-emails` function sends to ALL agents with `has_training_course = true`, including those who already completed the course. It needs to exclude agents who have passed all modules.

### Issue 2: Magic link sign-in fails (agents can't access course)
The `MagicLogin.tsx` page calls `verifyOtp` incorrectly. It passes the hashed token as `token`, but it should use `token_hash`:

```typescript
// BROKEN (current)
supabase.auth.verifyOtp({ email, token: data.tokenHash, type: "magiclink" })

// FIXED
supabase.auth.verifyOtp({ token_hash: data.tokenHash, type: "magiclink" })
```

The `token` parameter expects a raw 6-digit OTP code, not a hash. This explains why agents click the email link, the verify-magic-link function succeeds (logs show "tokenHash present: true"), but the frontend `verifyOtp` call fails and they see an error screen telling them to sign in manually — which they can't do because they don't know their password.

## Fix Plan

### 1. Fix `src/pages/MagicLogin.tsx`
- Line 75: Change `verifyOtp({ email, token: data.tokenHash, type: "magiclink" })` to `verifyOtp({ token_hash: data.tokenHash, type: "magiclink" })`
- Line 92 (retry): Same fix

### 2. Fix `supabase/functions/bulk-resend-course-emails/index.ts`
- After fetching agents with `has_training_course = true`, also fetch `onboarding_progress` to find agents who have passed ALL active modules
- Exclude those fully-completed agents from the email list

### 3. Resend emails
- After deploying fixes, trigger `bulk-resend-course-emails` to send working links to all agents who haven't completed the course

