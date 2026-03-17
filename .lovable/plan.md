

# Fix Draisen's Email + Verify Email Change Works

## Current State
- Draisen has **two profiles**: `a778d4e0` (email: `draien125@gmail.com`, has agent record) and `e6b92288` (email: `draisen125@gmail.com`, no agent record)
- The `update-user-email` edge function has been fixed and deployed with the `getUser` auth method
- But Draisen's auth email on user `a778d4e0` (the one with the agent record) still says `draien125@gmail.com`

## Plan

### 1. Create one-time helper edge function to fix Draisen's auth + profile email
Create `supabase/functions/fix-draisen-email/index.ts` — a small function that uses the service role key to:
- Call `supabaseAdmin.auth.admin.updateUserById("a778d4e0-...", { email: "Draisen125@gmail.com", email_confirm: true })`
- Update `profiles` table email for that user_id
- Deploy it, call it once via `curl_edge_functions`, then delete it

### 2. Verify `update-user-email` works end-to-end
After fixing Draisen's email, test the deployed `update-user-email` function by checking edge function logs to confirm no auth errors.

### 3. Clean up
Delete the one-time `fix-draisen-email` function after use.

### Files
- **New (temporary)**: `supabase/functions/fix-draisen-email/index.ts`
- **No other code changes needed** — the edge function fix from the previous message is already deployed

