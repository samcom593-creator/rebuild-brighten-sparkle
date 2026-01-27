# Fix Agent Login - COMPLETED ✅

## What Was Fixed

### Root Cause
The `handle_new_user()` database trigger was creating duplicate profiles/roles when edge functions called `admin.createUser()`, causing unique constraint violations.

### Solution Applied

1. **Edge functions now delete trigger-created records** before linking existing CRM data:
   - `setup-agent-password`: Deletes auto-created profile & role, then links existing CRM profile
   - `create-new-agent-account`: Deletes auto-created records, then creates fresh profile/agent

2. **check-email-status returns more CRM data** for pre-filling:
   - `agentPhone`, `agentCity`, `agentState` now included in response

3. **Login UI simplified with pre-filled data**:
   - CRM agents see their name & phone pre-filled
   - Just confirm info + set password
   - Non-CRM users create new account

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/setup-agent-password/index.ts` | Delete trigger records before linking |
| `supabase/functions/create-new-agent-account/index.ts` | Delete trigger records before creating |
| `supabase/functions/check-email-status/index.ts` | Return phone/city/state |
| `src/pages/AgentNumbersLogin.tsx` | Pre-fill CRM data in set-password form |

## Test Flow

1. Go to `/agent-login`
2. Enter an email that's in the CRM (e.g., `kebbeh045@gmail.com`)
3. Should see "Welcome back!" with name pre-filled
4. Confirm info, set password, log in
5. If email not in CRM, shows "Create Account" form instead
