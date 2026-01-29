
# Fix Login Loop on iPhone Safari/PWA

## Problem Summary
Users on iPhone Safari/PWA are stuck in a login loop on `/numbers`. The specific user (phone `9788047212`) is not in the CRM, so the system correctly shows the "Create Account" form. However, after account creation, the login either fails or the agent data doesn't load properly, causing a loop back to the login screen.

## Root Causes Identified

### 1. Agent Query Fails After Account Creation
In `loadAgentData()`, the query uses a strict foreign key join:
```typescript
.select("id, profile:profiles!agents_profile_id_fkey(full_name)")
.eq("user_id", userId)
```
If the `profile_id` on the agent record doesn't match correctly, this join returns `null`, causing `isAuthenticated` to stay `false` and showing the login form again.

### 2. iOS Safari Magic Link OTP Issues  
The `verifyOtp()` method used for passwordless login can fail silently on iOS Safari due to cookie/storage restrictions in WebKit. When OTP verification fails, the session isn't set, causing a loop.

### 3. Missing Auth State Persistence Check
After `signInWithPassword` succeeds in the signup form, the `onAuthStateChange` listener triggers `loadAgentData`, but if the agent query fails (see point 1), the user gets stuck.

## Solution

### Fix 1: Make Agent Query More Resilient
**File: `src/pages/Numbers.tsx`**

Update `loadAgentData` to query the agent without the strict join, then separately fetch the profile name:

```typescript
const loadAgentData = async (userId: string) => {
  try {
    // Query agent first without the join
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, profile_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (agentError) throw agentError;

    if (agent) {
      setAgentId(agent.id);
      
      // Separately fetch profile name if profile_id exists
      if (agent.profile_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", agent.profile_id)
          .maybeSingle();
        setAgentName(profile?.full_name || "Agent");
      } else {
        // Fallback: get name from user's profile by user_id
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", userId)
          .maybeSingle();
        setAgentName(profile?.full_name || "Agent");
      }
      
      setIsAuthenticated(true);
    } else {
      // No agent record - show signup
      setAgentId(null);
      setIsAuthenticated(false);
    }
  } catch (error) {
    console.error("Error loading agent data:", error);
    // On error, still allow them to try the signup flow
    setAgentId(null);
    setIsAuthenticated(false);
  } finally {
    setLoading(false);
  }
};
```

### Fix 2: Add Password-Based Login Fallback for iOS
**File: `src/pages/Numbers.tsx`**

After successful account creation, skip the OTP-based simple login and use password login directly since we already have the password:

The current flow already does this correctly:
```typescript
const { error: signInError } = await supabase.auth.signInWithPassword({
  email: newEmail.trim().toLowerCase(),
  password: newPassword,
});
```

This bypasses the OTP flow that causes issues on iOS.

### Fix 3: Add Error Recovery for Failed Agent Load
**File: `src/pages/Numbers.tsx`**

If a user is authenticated but has no agent record, show a clear message and offer to create one:

After the `loadAgentData` function, add logic to detect "authenticated but no agent" state and guide them to create an agent record.

### Fix 4: Ensure create-new-agent-account Sets Correct Foreign Keys
**File: `supabase/functions/create-new-agent-account/index.ts`**

Verify the agent record is created with the correct `profile_id` reference:
- Current code creates profile first, then agent with `profile_id: newProfile.id` ✓
- This looks correct, but add logging to confirm the IDs match

## Files to Modify

1. **`src/pages/Numbers.tsx`**
   - Fix `loadAgentData` query to not rely on strict FK join
   - Add fallback profile name resolution
   - Add better error handling with console logs for debugging

2. **`supabase/functions/create-new-agent-account/index.ts`**
   - Add more detailed logging to trace the profile_id and agent creation
   - Verify the IDs are being linked correctly

## Technical Details

### Current Query (Problematic)
```typescript
// This fails if agents_profile_id_fkey join doesn't resolve
.select("id, profile:profiles!agents_profile_id_fkey(full_name)")
```

### Fixed Query (Resilient)
```typescript
// Query agent independently, then fetch profile separately
.select("id, profile_id")
// Then:
.from("profiles").select("full_name").eq("id", agent.profile_id)
```

## Expected Outcome
- New users on iPhone can create accounts and immediately start entering numbers
- The login loop is eliminated by using password-based auth after signup
- Even if the profile join fails, the user can still access the production entry form
- Better logging helps diagnose any remaining issues
