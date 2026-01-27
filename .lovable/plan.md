
# Fix Agent Login RLS Error - Immediate Solution

## Root Cause Found

When an existing CRM agent sets up their password for the first time:

1. Edge function calls `supabaseAdmin.auth.admin.createUser()`
2. This fires the database trigger `handle_new_user()` which auto-creates a NEW profile AND adds an 'agent' role
3. Edge function then tries to UPDATE the old profile's `user_id` to the new auth ID
4. **FAILS** because the trigger already created a profile with that `user_id` (unique constraint violation)
5. The 'role violates RLS' error happens because duplicate records are being created

## The Fix - 2 Parts

### Part 1: Update Edge Functions to Handle Trigger Behavior

The edge functions need to:
1. **Delete the auto-created profile** (created by trigger) before linking the existing one
2. **Delete the auto-created role** (if duplicate) before assigning

This requires updating both `setup-agent-password` and `create-new-agent-account` edge functions.

### Part 2: Simplify the Flow Per Your Request

When email matches CRM:
- Pre-fill name from CRM data
- Allow user to confirm/edit name + phone
- Only ask for password
- One-click setup

When email doesn't match CRM:
- Ask for name, email, password
- Create everything fresh

## Technical Changes

### File: `supabase/functions/setup-agent-password/index.ts`

**Current Problem:**
```typescript
// Creates auth user (trigger fires, creates new profile + role)
const { data: newAuthUser } = await supabaseAdmin.auth.admin.createUser({ ... });

// Then tries to update old profile - FAILS with unique constraint!
await supabaseAdmin.from("profiles").update({ user_id: newUserId }).eq("id", profile.id);
```

**Fixed Logic:**
```typescript
// 1. Create auth user (trigger fires, creates unwanted profile + role)
const { data: newAuthUser } = await supabaseAdmin.auth.admin.createUser({ ... });
const newUserId = newAuthUser.user.id;

// 2. Delete the trigger-created profile (it has newUserId)
await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);

// 3. Delete the trigger-created role (duplicate prevention)
await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);

// 4. Now safely update the EXISTING profile to link to new auth user
await supabaseAdmin.from("profiles").update({ user_id: newUserId }).eq("id", profile.id);

// 5. Add the agent role cleanly
await supabaseAdmin.from("user_roles").insert({ user_id: newUserId, role: "agent" });
```

### File: `supabase/functions/check-email-status/index.ts`

Return additional CRM data for pre-filling:
```typescript
return {
  inCRM,
  hasAuthAccount,
  agentName: profile?.full_name || null,
  agentPhone: profile?.phone || null,  // NEW - for pre-fill
  agentCity: profile?.city || null,    // NEW - optional
  agentState: profile?.state || null,  // NEW - optional
};
```

### File: `src/pages/AgentNumbersLogin.tsx`

**Update the "set-password" step:**
- Pre-fill name and phone from CRM data
- Show editable fields for user to confirm
- Only require password entry
- Make it feel like "completing" their profile, not "creating" an account

**Simplified Flow:**
```text
[Enter Email]
     ↓
[Check CRM]
     ↓
Found in CRM? → Show "Hi {Name}!" + pre-filled info + password field
Not in CRM?  → Show "Create Account" with name + password fields
```

## Files to Update

| File | Change |
|------|--------|
| `supabase/functions/setup-agent-password/index.ts` | Delete trigger-created records before linking |
| `supabase/functions/check-email-status/index.ts` | Return phone/city/state for pre-fill |
| `src/pages/AgentNumbersLogin.tsx` | Pre-fill CRM data, simplify forms |

## User Experience After Fix

**For Aisha (existing CRM agent):**
1. Goes to login page
2. Enters email: `kebbeh045@gmail.com`
3. System shows: "Welcome, Aisha! 👋" with her name pre-filled
4. She confirms her info and creates a password
5. Done - logged in and ready to enter numbers

**For new person (not in CRM):**
1. Goes to login page
2. Enters email
3. System shows: "Let's get you set up"
4. Enters name + password
5. Done - account created, logged in

## Why This Fixes the RLS Error

The error "role violates role level security" was caused by:
1. Trigger creating a duplicate profile/role
2. Unique constraints blocking the UPDATE
3. Cascading confusion in the data

By deleting the trigger-created records FIRST, we avoid all conflicts and cleanly link the existing CRM data to the new auth account.
