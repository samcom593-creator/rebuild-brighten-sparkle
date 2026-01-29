
# Fix Login and Account Creation Issues

## Problem Summary
Users are unable to log in or create accounts because:
1. The `/numbers` page shows "Account creation coming soon" instead of letting new users sign up
2. Phone number lookups fail when the phone format doesn't match exactly
3. The `link-account` function fails with a non-2xx error for users not in the CRM
4. Several edge functions have outdated CORS headers causing issues on mobile browsers

## Solution

### 1. Enable Self-Signup on /numbers Page
Replace the placeholder "coming soon" message with actual account creation functionality.

**File: `src/pages/Numbers.tsx` (lines 289-330)**
- Replace the current `needsAccount` form that shows a toast with a working signup form
- Add password field for new account creation  
- Call `create-new-agent-account` edge function to create the account

### 2. Improve Phone Number Matching in Edge Functions
Normalize phone numbers to last 10 digits for consistent matching.

**File: `supabase/functions/simple-login/index.ts`**
- Improve phone matching to handle various formats (+1, parentheses, dashes, spaces)
- Search both profiles and applications tables for phone matches
- If found in applications but not profiles, create the profile automatically

**File: `supabase/functions/check-email-status/index.ts`**
- Enhance phone search to also check applications table
- Normalize phone to last 10 digits before searching

### 3. Fix link-account to Handle Non-CRM Users Gracefully
**File: `supabase/functions/link-account/index.ts`**
- Return a more user-friendly error message when no agent is found
- Suggest using the signup flow instead of showing a generic error

### 4. Standardize CORS Headers Across All Login-Related Edge Functions
Update CORS headers to include platform-specific identifiers for mobile compatibility.

**Files to update:**
- `supabase/functions/check-email-status/index.ts`
- `supabase/functions/setup-agent-password/index.ts`  
- `supabase/functions/create-new-agent-account/index.ts`
- `supabase/functions/agent-signup/index.ts`

**Standard CORS headers:**
```javascript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
```

## Technical Details

### Numbers.tsx Self-Signup Flow
```text
User enters phone/email
    |
    v
simple-login checks CRM
    |
    +--> Found in CRM with auth --> Password login
    |
    +--> Found in CRM without auth --> Set password flow
    |
    +--> Not in CRM --> Show signup form with:
         - Name field
         - Email field (auto-populated)
         - Phone field
         - Password field
         - Create Account button
              |
              v
         create-new-agent-account creates:
         - Auth user (email confirmed)
         - Profile record
         - Agent record (status: active, stage: evaluated)
         - Agent role
              |
              v
         Auto-login and show production entry
```

### Phone Normalization Logic
```text
Input: "+1 (978) 804-7212" or "9788047212" or "(978) 804-7212"
    |
    v
Remove all non-digits: "19788047212" or "9788047212"
    |
    v
Take last 10 digits: "9788047212"
    |
    v
Search profiles WHERE phone ILIKE '%9788047212%'
    |
    +--> If found: continue login flow
    |
    +--> If not found: search applications table
         |
         +--> If found contracted: auto-create profile + agent
         |
         +--> If not found: needsAccount = true
```

## Files Modified
1. `src/pages/Numbers.tsx` - Enable self-signup form
2. `supabase/functions/simple-login/index.ts` - Improve phone matching + auto-create from applications
3. `supabase/functions/check-email-status/index.ts` - Standardize CORS, improve phone search
4. `supabase/functions/setup-agent-password/index.ts` - Standardize CORS
5. `supabase/functions/create-new-agent-account/index.ts` - Standardize CORS
6. `supabase/functions/agent-signup/index.ts` - Standardize CORS
7. `supabase/functions/link-account/index.ts` - Better error messages

## Expected Outcome
- Users not in CRM can create accounts directly on /numbers page
- Phone number lookups work regardless of formatting
- Mobile users no longer see CORS errors
- Clear error messages guide users to the correct flow
