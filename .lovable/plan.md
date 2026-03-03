

# Fix: Course Email Links Not Working + Resend Emails

## Root Cause
The `send-course-enrollment-email` edge function (line 12) uses:
```
const BASE_URL = "https://apex-financial.org";
```

This generates magic links like `https://apex-financial.org/magic-login?token=...`. But `apex-financial.org` either doesn't serve this app or serves a different/old version. The actual app lives at `https://rebuild-brighten-sparkle.lovable.app`. The `verify-magic-link` function has **zero logs**, confirming agents never reach the app when clicking the link.

The `send-course-reminder` function (line 104) has a similar but different issue — it links directly to `/onboarding-course` without magic login auth, so unauthenticated users would hit a login wall.

## Fix

### 1. Fix `send-course-enrollment-email/index.ts`
- Change line 12: `BASE_URL` from `"https://apex-financial.org"` to `"https://rebuild-brighten-sparkle.lovable.app"`
- This ensures the magic link points to the correct app where `/magic-login` actually exists

### 2. Fix `send-course-reminder/index.ts`
- Line 104 constructs a direct `/onboarding-course` URL which won't work for unauthenticated users
- Change it to generate a magic login token (like the enrollment email does) so agents get one-tap access
- Import the same magic-token-generation pattern from the enrollment email

### 3. Resend enrollment emails
- After deploying the fixed functions, invoke `send-course-enrollment-email` for every agent currently in `training_online` stage so they get working links

## Technical Details
- Both edge functions need redeployment
- The `send-course-reminder` will need a `generateMagicToken` helper added (copy from enrollment function) and will generate course-destination magic links instead of direct URLs
- Resend will be done by querying `agents` with `onboarding_stage = 'training_online'` and calling the enrollment email function for each

