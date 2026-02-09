

# Dashboard Roster Alignment and Account Connection Fix

## Problems Identified

1. **Terminated agents hidden from dashboard**: The roster query filters `is_deactivated = false`, hiding terminated/deactivated agents entirely. The admin cannot see or reactivate them.

2. **Account connection (`link-account`) broken**: The edge function uses `supabaseClient.auth.getClaims(token)` which is not a standard Supabase JS client method. This likely throws an error silently, preventing agents from linking their accounts. Should use `supabase.auth.getUser(token)` instead.

3. **No license status toggle**: The dashboard roster shows a license badge but provides no way to toggle between licensed/unlicensed.

4. **No reactivate button**: Once an agent is terminated or deactivated, there's no way to bring them back from the dashboard.

5. **"Send Login" has no UX sound**: The `handleSendPortalLogin` function in `ManagerTeamView` does not play a sound effect on success.

6. **"Add Agent" link could be more direct**: The AddAgentModal works but the user wants the invite link to be copy-able with one tap.

---

## Plan

### 1. Fix `link-account` edge function (account connection)

Replace `supabaseClient.auth.getClaims(token)` with `supabaseAdmin.auth.getUser(token)` which is the correct method to verify a JWT and extract the user ID.

**File**: `supabase/functions/link-account/index.ts`

### 2. Show terminated/deactivated agents in dashboard roster

In `ManagerTeamView.tsx`:
- Remove the `.eq("is_deactivated", false)` filter from the admin query so ALL agents are fetched
- Add a third collapsible section: **"Terminated / Inactive"** for agents with `status = "terminated"` OR `is_deactivated = true` OR `is_inactive = true`
- The existing Licensed and Unlicensed sections will only show active, non-deactivated agents

### 3. Add "Reactivate" button for terminated/inactive agents

In `ManagerTeamView.tsx`:
- When an agent card is expanded and the agent is terminated/deactivated, show a **"Reactivate"** button instead of the "Remove" button
- Reactivation sets `status = "active"`, `is_deactivated = false`, `is_inactive = false`
- Play a success sound on reactivation

### 4. Add license status toggle

In `ManagerTeamView.tsx`:
- Add a toggle button in each expanded agent card that allows switching between "Licensed" and "Unlicensed"
- Updates the `license_status` column on the `agents` table
- Plays a click sound on toggle

### 5. Add UX sounds to Send Login and other actions

In `ManagerTeamView.tsx`:
- Import `useSoundEffects`
- Play `success` sound on successful "Send Login"
- Play `success` sound on reactivation
- Play `click` sound on license toggle

### 6. Add quick copy invite link

In `ManagerTeamView.tsx` header (next to the "Agency Roster" title):
- Add a "Copy Invite Link" button that copies the manager's invite URL to clipboard
- Play a `success` sound and show a toast confirmation

---

## Technical Details

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/link-account/index.ts` | Replace `getClaims` with `getUser` for JWT verification |
| `src/components/dashboard/ManagerTeamView.tsx` | Remove `is_deactivated` filter for admin; add Terminated section; add Reactivate, License toggle, UX sounds, copy invite link |

### `link-account` fix detail

```text
BEFORE: supabaseClient.auth.getClaims(token)
AFTER:  supabaseAdmin.auth.getUser(token)  // then extract user.id and user.email
```

This also removes the need for the separate `supabaseClient` instance (the anon key client used only for getClaims).

### Roster sections after fix

```text
Agency Roster (18)
  [Copy Invite Link]  [Sort dropdown]

  Licensed Agents (7)       -- expanded by default
    [agent cards with: Edit, Send Login, Add Course, Toggle License, Remove]

  Unlicensed Pipeline (8)   -- expanded by default  
    [agent cards with: Edit, Send Login, Add Course, Toggle License, Remove]

  Terminated / Inactive (3) -- collapsed by default
    [agent cards with: Edit, Send Login, Reactivate]
```

### Reactivation logic

```text
UPDATE agents SET 
  status = 'active',
  is_deactivated = false,
  is_inactive = false,
  deactivation_reason = null
WHERE id = agent_id
```

### License toggle logic

```text
UPDATE agents SET license_status = 'licensed' | 'unlicensed'
WHERE id = agent_id
```

