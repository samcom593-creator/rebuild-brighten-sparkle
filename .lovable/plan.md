
# Fix: Course Tracking Not Working for Invited Agents

## Problem Identified

After tracing the complete flow, I found a **critical gap** in the agent invitation system:

### What's Happening Now
1. Manager adds agent via "Invite Team" modal
2. Modal creates a **random UUID** for `user_id` and stores it in `profiles` and `agents` tables
3. Magic link is generated pointing to that agent
4. **Agent clicks the link → FAILS** because no actual auth account exists in Supabase's `auth.users` table
5. The `verify-magic-link` function tries to look up the user by ID but finds nothing
6. Agent cannot log in, so course progress cannot be tracked to them

### Why Course Tracking Breaks
The `OnboardingCourse.tsx` page looks up the agent by:
```typescript
// Line 28-32 in OnboardingCourse.tsx
const { data } = await supabase
  .from("agents")
  .select("id")
  .eq("user_id", user.id)  // ← This user.id comes from Supabase Auth
  .maybeSingle();
```

Since there's no auth user, `user.id` is never set, so the agent record can't be found.

---

## The Fix

Update the `InviteTeamModal` → call an edge function that:
1. **Creates an actual Supabase auth user** using `auth.admin.createUser()`
2. Uses that real `user.id` for the profile and agent records
3. Then generates the magic link

### Implementation

**1. Create new edge function: `create-new-agent-account`**

This function will:
- Create an auth user with a random password (they'll use magic links)
- Return the real `user.id`
- Be called from the InviteTeamModal before creating profile/agent records

**2. Update `InviteTeamModal.tsx`**

Change from:
```typescript
const newUserId = crypto.randomUUID();
```

To calling the edge function:
```typescript
const { data } = await supabase.functions.invoke("create-new-agent-account", {
  body: { email, fullName }
});
const newUserId = data.userId;  // Real auth user ID
```

---

## File Changes

| File | Change |
|------|--------|
| `supabase/functions/create-new-agent-account/index.ts` | **New** - Creates auth user and returns real user ID |
| `src/components/dashboard/InviteTeamModal.tsx` | Call edge function instead of `crypto.randomUUID()` |

---

## Technical Details

### New Edge Function: `create-new-agent-account`

```typescript
// Uses admin API to create actual auth user
const { data: authUser, error } = await supabaseAdmin.auth.admin.createUser({
  email: email.toLowerCase().trim(),
  email_confirm: true,  // Skip email confirmation
  password: crypto.randomUUID(),  // Random password - they'll use magic links
  user_metadata: { full_name: fullName }
});

return { userId: authUser.user.id };
```

### Updated InviteTeamModal Flow

```
1. Call create-new-agent-account → get real user.id
2. Create profile with real user.id
3. Create agent with real user.id
4. Generate magic link (now verify-magic-link will find the user)
5. Agent clicks link → logs in → course tracks to their profile
```

---

## Why This Fixes Course Tracking

After the fix:
1. Agent has a **real Supabase auth account**
2. When they click magic link, `verify-magic-link` finds their auth user
3. They get logged in with a valid session
4. `OnboardingCourse.tsx` can now find their agent record via `user.id`
5. Progress is saved to `onboarding_progress` table with correct `agent_id`
6. Admin can see their progress in Course Progress dashboard

---

## Summary

The root cause is that invited agents never get an actual authentication account created. The modal was just creating database records with fake UUIDs. The fix creates a real Supabase auth user so the entire login and course tracking flow works correctly.
