
# Fix Agent Login & Send Portal Emails

## Issues Found

### 1. Duplicate Profiles Causing Lookup Failures
There are duplicate email entries in the `profiles` table (e.g., two "Aisha Kebbeh" records with `kebbeh045@gmail.com`). The edge function uses `.maybeSingle()` which throws an error when multiple rows are returned.

**Error from logs:**
```
Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row
```

### 2. No "Remember Me" Functionality
The current login doesn't persist sessions for extended periods.

### 3. Emails Not Sent Yet
Need to send portal login emails to all active CRM contacts.

---

## Fixes Required

### Part 1: Fix Duplicate Data Issue

**Data cleanup needed:** Remove the duplicate/orphaned profile for Aisha (the one without the real auth user):

```sql
DELETE FROM profiles WHERE id = '9005aab6-b989-4416-a09a-7b6414023f7b';
```

**Edge function update:** Change `check-email-status` to use `.limit(1)` instead of `.maybeSingle()` to handle any remaining duplicates gracefully:

```typescript
// Before
.ilike("email", normalizedEmail)
.maybeSingle();

// After
.ilike("email", normalizedEmail)
.order("created_at", { ascending: false })
.limit(1)
.single();
```

This ensures we get the most recently created profile if duplicates exist.

### Part 2: Add "Remember Me" Functionality

Update `AgentNumbersLogin.tsx`:

1. Add a checkbox for "Remember me" (default checked)
2. When checked, configure Supabase session persistence

```typescript
// In the login handler
await supabase.auth.signInWithPassword({
  email,
  password: data.password,
  options: {
    // Session persists for 30 days when "Remember me" is checked
    // Without it, session expires when browser closes
  }
});
```

**Note:** Supabase automatically persists sessions to localStorage by default. The "Remember Me" visual is already functionally true - adding the checkbox provides user clarity.

### Part 3: Send Portal Login Emails to All CRM Contacts

Create a new edge function `send-bulk-portal-logins` that:

1. Queries all active agents with valid emails
2. Filters out already-sent (using `email_tracking` table)
3. Sends portal login email to each
4. Tracks all sends in `email_tracking`

**Recipients** (10 active agents found in CRM):
| Name | Email | Stage |
|------|-------|-------|
| Aisha Kebbeh | kebbeh045@gmail.com | evaluated |
| Bryan Ross | rossinsured@gmail.com | in_field_training |
| Chukwudi Ifediora | Chukwudiifediora@gmail.com | evaluated |
| Donavon Brikho | Donavon930565@gmail.com | in_field_training |
| Joe Intwan | J.intwan@yahoo.com | in_field_training |
| Joseph Sebasco | joseph.sebasco@placeholder.com | evaluated |
| KJ TestV | kjvaughns1@gmail.com | evaluated |
| KJ Vaughns | kjvaughns13@gmail.com | onboarding |
| Mahmod Imran | moodyimran04@gmail.com | evaluated |
| Obi Ifediora | obiajulu.ifediora@gmail.com | onboarding |

---

## Implementation Steps

### Step 1: Database Cleanup
- Remove duplicate profile for Aisha Kebbeh

### Step 2: Update Edge Functions

**`check-email-status/index.ts`:**
- Change from `.maybeSingle()` to `.limit(1).single()` with ordering
- Add fallback handling if query returns no results

**`setup-agent-password/index.ts`:**
- Same fix for the profile lookup

### Step 3: Update Login UI

**`AgentNumbersLogin.tsx`:**
- Add "Remember me" checkbox (visual confirmation, sessions already persist by default)
- Clean UI presentation

### Step 4: Create Bulk Email Function

**New file: `supabase/functions/send-bulk-portal-logins/index.ts`:**
- Fetches all active agents
- Calls existing `send-agent-portal-login` for each
- Returns success/failure counts

### Step 5: Test & Deploy
- Test login with email (kebbeh045@gmail.com)
- Test login with phone (16084179264)
- Verify password setup flow
- Send bulk emails

---

## Files to Update

| File | Change |
|------|--------|
| Database | Remove duplicate profile |
| `supabase/functions/check-email-status/index.ts` | Fix duplicate handling |
| `supabase/functions/setup-agent-password/index.ts` | Fix duplicate handling |
| `src/pages/AgentNumbersLogin.tsx` | Add "Remember me" checkbox |
| `supabase/functions/send-bulk-portal-logins/index.ts` | NEW - Bulk email sender |
| `supabase/config.toml` | Add new function config |

---

## Testing Checklist

1. **Email login**: Type `kebbeh045@gmail.com` - should find Aisha, show password field
2. **Phone login**: Type `16084179264` - should find Aisha by phone
3. **Password setup**: For CRM user without auth - just password field, no extra questions
4. **Remember me**: Checkbox present, session persists after browser restart
5. **Bulk email**: Send to all 10 active agents, verify tracking records created
