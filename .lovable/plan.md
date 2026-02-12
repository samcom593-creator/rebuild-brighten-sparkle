

# Fix Magic Link Login for Course Access

## Root Cause

The `verify-magic-link` edge function marks the token as `used_at` immediately after generating the Supabase OTP hash. If the client-side `verifyOtp` call then fails (which happens frequently on mobile Safari due to cookie/session restrictions), the token is permanently consumed. The agent clicks "Try Again" or re-opens the email link, but the token is already marked as used, so the edge function returns a 400 error -- which the Supabase client surfaces as "Edge Function returned a non-2xx status code."

## The Fix

### 1. Allow token re-use within a 5-minute grace window

Instead of permanently blocking a used token, allow re-verification if `used_at` was less than 5 minutes ago. This handles the common case where the OTP generation succeeded server-side but the client-side `verifyOtp` failed.

**File:** `supabase/functions/verify-magic-link/index.ts`

Change the "already used" check from a hard block to a grace period:
- If `used_at` exists AND it was more than 5 minutes ago, return "ALREADY_USED" error
- If `used_at` exists but it was less than 5 minutes ago, allow re-verification (generate a fresh OTP hash)

This is safe because the OTP itself expires quickly, and the magic token still expires after 24 hours.

### 2. Improve error handling in MagicLogin.tsx

The current retry logic calls `verify-magic-link` again with the same token on OTP expiry, but that token is already marked used, so the retry always fails. With the grace window fix above, this retry will now work. Additionally:

- Show the actual error message from the edge function instead of the generic "Edge Function returned a non-2xx status code"
- Parse the response body on non-2xx to extract the real error code

**File:** `src/pages/MagicLogin.tsx`

Update the error extraction to handle `FunctionsHttpError` properly by reading the response body for the actual error details.

### 3. No email template changes needed

The course enrollment email already correctly:
- Uses `destination: "course"` for the magic token
- Links to the correct coursework page
- Includes fallback instructions to sign in at `/agent-login`
- CCs admin and manager

---

## Technical Summary

| File | Change |
|------|--------|
| `supabase/functions/verify-magic-link/index.ts` | Allow re-verification within 5 min grace window instead of hard "already used" block |
| `src/pages/MagicLogin.tsx` | Better error extraction from edge function responses |

