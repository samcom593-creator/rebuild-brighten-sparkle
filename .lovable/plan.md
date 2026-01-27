
# Fix Agent Login Flow - Simplified Email-First Experience

## Problems Identified

1. **Password Reset Fails**: The `send-password-reset` function uses `generateLink` which requires users to already exist in Supabase Auth. But most CRM agents have placeholder UUIDs (like `a1111111-...`) without real auth accounts.

2. **Login UX is Wrong**: Current flow asks for email+password upfront. Users want:
   - Enter email first
   - If email matches CRM → let them set a password and log in (first-time setup)
   - If email doesn't match → let them create a new account on the spot

3. **No Create Account Button**: Current page says "Contact your manager" instead of allowing self-signup.

## Solution Overview

Create a smart, email-first login flow with 4 states:

```text
[Enter Email] 
     ↓
[Check CRM & Auth]
     ↓
┌────────────────────────────────────────┐
│                                        │
▼                                        ▼
Email in CRM,                      Email NOT in CRM
Auth account exists                     │
│                                       ▼
▼                                  [Create New Account]
[Enter Password]                   Name + Email + Password
│                                       │
│    ┌───────────────────┐              │
│    │                   │              │
▼    ▼                   │              │
Email in CRM,            │              ▼
NO Auth account          │         [Create Agent + Auth]
│                        │              │
▼                        │              │
[Set First Password]     │              │
│                        │              │
▼                        │              │
[Create Auth Account  ◄──┘              │
 Link to Existing Agent]                │
│                                       │
└───────────────────────────────────────┘
                    │
                    ▼
            [Logged In → /apex-daily-numbers]
```

## Technical Changes

### 1. Rewrite AgentNumbersLogin.tsx (Complete Overhaul)

**New Component States:**
- `step: "email" | "password" | "set-password" | "create-account"`
- `crmMatch: Profile | null` (if email found in profiles table)
- `hasAuthAccount: boolean` (if email found in auth.users)

**New Flow Logic:**
1. User enters email → click "Continue"
2. Check if email exists in `profiles` table (public RLS allows checking by email for authenticated users only - need edge function)
3. Check if email exists in `auth.users` (via Supabase client sign-in attempt or edge function)
4. Based on results:
   - **CRM match + Auth exists** → Show password field
   - **CRM match + No auth** → Show "Set Password" form (first-time setup)
   - **No CRM match** → Show "Create Account" form (name + email + password)

### 2. Create `check-email-status` Edge Function

Check if an email exists in CRM and/or auth, without exposing sensitive data:

```typescript
// Returns: { inCRM: boolean, hasAuthAccount: boolean, agentName?: string }
```

This function will:
- Query `profiles` table for email match
- Query `auth.users` (via admin API) for email match
- Return status flags (not sensitive data)

### 3. Create `setup-agent-password` Edge Function

For first-time password setup (CRM user without auth account):

```typescript
// Input: { email: string, password: string }
// Logic:
// 1. Verify email exists in profiles table
// 2. Create Supabase auth user with that email
// 3. Update the existing agent record to link user_id
// 4. Return success (user can now log in)
```

### 4. Create `create-new-agent-account` Edge Function

For users not in CRM who want to create an account:

```typescript
// Input: { email: string, password: string, fullName: string, phone?: string }
// Logic:
// 1. Create Supabase auth user
// 2. Create profile record
// 3. Create agent record (onboarding_stage: 'evaluated', status: 'active')
// 4. Add 'agent' role
// 5. Return success
```

### 5. Update Password Reset Logic

Fix `send-password-reset` to handle both cases:
- **User exists in auth** → Generate recovery link (current logic)
- **User in CRM but no auth** → Send "Set up your password" email instead (same flow as first-time setup)

| File | Change |
|------|--------|
| `src/pages/AgentNumbersLogin.tsx` | Complete rewrite with email-first flow |
| `supabase/functions/check-email-status/index.ts` | New - check CRM/auth status |
| `supabase/functions/setup-agent-password/index.ts` | New - first-time password for CRM users |
| `supabase/functions/create-new-agent-account/index.ts` | New - self-signup for non-CRM users |
| `supabase/functions/send-password-reset/index.ts` | Update to handle "no auth account" case |
| `supabase/config.toml` | Add new function configs |

## After Implementation

1. User clicks link → sees **email-only** input field
2. Enters email → system checks CRM + auth
3. **If in CRM with account**: enters password → logs in
4. **If in CRM without account**: sets password → account created → logs in
5. **If not in CRM**: enters name + password → new account created → logs in
6. Password reset works for all cases

## Security Considerations

- Email check function returns minimal info (boolean flags only)
- Password setup requires valid email in CRM
- All auth operations use service role key server-side
- RLS still enforced for data access after login
