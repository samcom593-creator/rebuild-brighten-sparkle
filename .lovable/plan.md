

# Fix Update Email Function & Change Draisen's Email

## Problem
The `update-user-email` edge function uses `anonClient.auth.getClaims(token)` (line 53) — an experimental method that isn't reliably available in the Deno Supabase client. This causes the function to fail silently with an auth error, making email changes not work from the CRM, Dashboard Accounts, or Profile Settings.

## Fix

### 1. Replace `getClaims` with `getUser` in the edge function
In `supabase/functions/update-user-email/index.ts`:
- Remove the `anonClient` creation and `getClaims` call (lines 48-61)
- Replace with `supabaseAdmin.auth.getUser(token)` which is the standard, reliable method to verify a JWT and extract the user ID
- This is much simpler — just verify the token and get `user.id` from the result
- Remove the unused `anonClient` entirely

### 2. Update Draisen's email directly via SQL
Run a query to update:
- `profiles` table: change email from `draien125@gmail.com` to `Draisen125@gmail.com` for user_id `a778d4e0-0eb1-4651-8cf9-f107f59dfc9f`
- Auth user: update via `supabaseAdmin.auth.admin.updateUserById` — but since we can't call that from SQL, we'll use the fixed edge function after deploy, OR update the profile directly and use the admin API through a one-time migration

### Files
- **Edit**: `supabase/functions/update-user-email/index.ts` — replace `getClaims` with `getUser`
- **DB migration**: Update Draisen's email in profiles table + auth

