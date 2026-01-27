
# Simplify Agent Login - Password-Only for CRM Agents

## Problems to Fix

1. **Login asks too many questions** - CRM agents are asked to confirm name/phone when all we need is a password
2. **No phone login support** - Agents want to type their phone number OR email  
3. **Edge functions may not be deployed** - No logs found, suggesting deployment issues
4. **Managers need dual capability** - Log their own numbers + log for team members

## Solution

### Part 1: Simplify the Set-Password Flow

**Current flow for CRM agents:**
- Enter email → See form with 4 fields (Name, Phone, Password, Confirm Password)
- User complaint: "Why are you asking all these damn questions?"

**New flow for CRM agents:**
- Enter email or phone → We find them in CRM
- Show "Welcome, [Name]!" with their name displayed (read-only)
- Only show ONE field: Password
- Remove confirm password (it's friction, not security for a numbers app)
- One-click to set password and log in

### Part 2: Add Phone Number Login

Update `check-email-status` edge function to:
1. Accept `identifier` instead of just `email`
2. If identifier looks like a phone (digits, dashes, parentheses), search by phone
3. If identifier looks like an email, search by email
4. Return the matched profile's email (for auth) + display info

### Part 3: UI Changes to AgentNumbersLogin.tsx

| Step | Current | New |
|------|---------|-----|
| Email input label | "Email" | "Email or Phone" |
| set-password form | 4 fields + confirm | Just password field |
| set-password display | Editable name/phone | Read-only "Welcome, {Name}!" banner |
| create-account form | 4 fields | Keep 3 fields (Name, Password, Confirm) - phone optional |

### Part 4: Edge Function Updates

**`check-email-status/index.ts`:**
```typescript
// Change from { email } to { identifier }
const { identifier } = await req.json();

// Detect if it's a phone or email
const isPhone = /^[\d\s\-\(\)\+]+$/.test(identifier) && identifier.replace(/\D/g, "").length >= 10;

if (isPhone) {
  // Normalize phone and search profiles by phone
  const normalizedPhone = identifier.replace(/\D/g, "");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, user_id, full_name, email, phone, city, state")
    .or(`phone.ilike.%${normalizedPhone}%`)
    .maybeSingle();
  // Return email from profile for auth
} else {
  // Existing email search logic
}
```

**`setup-agent-password/index.ts`:**
- Remove fullName and phone from required params (CRM already has this data)
- Only require email + password

### Part 5: Manager Logging Capability

The current `/agent-portal` already allows managers to view it (via `isAdminViewing` flag). For logging on behalf of team members:
- Add a dropdown in `ProductionEntry.tsx` (only visible to managers)
- When manager selects a team member, log production for that agent
- Default to logging for themselves

## Files to Update

| File | Change |
|------|--------|
| `src/pages/AgentNumbersLogin.tsx` | Simplify set-password step, add phone input support |
| `supabase/functions/check-email-status/index.ts` | Support phone lookup, return email for auth |
| `supabase/functions/setup-agent-password/index.ts` | Remove name/phone params, only require password |
| `src/components/dashboard/ProductionEntry.tsx` | Add manager dropdown to log for team |

## New User Experience

**For Aisha (existing CRM agent):**
1. Goes to `/agent-login`
2. Types her phone number: `(555) 123-4567`
3. System finds her in CRM, shows: "Welcome back, Aisha!"
4. She types a password (just one field)
5. Clicks "Set Password & Log In"
6. Done - she's in and can log numbers

**For a manager logging for their team:**
1. Manager logs in normally
2. Opens Agent Portal or Daily Numbers page
3. Sees dropdown: "Logging as: [Myself ▼]"
4. Can select any team member to log numbers for them
5. Submits - production saved for selected agent

## Technical Notes

- Phone matching uses regex to strip formatting and compare last 10 digits
- The email from CRM is used for Supabase Auth (phone is just for lookup)
- Managers see their team via existing `invited_by_manager_id` relationship
- All existing CRM data (license status, onboarding stage) is preserved
