
## Plan: Perfect the Add Agent Functionality

### Problem Summary
The current Add Agent modal has several issues preventing it from working reliably:
1. **Empty Manager Dropdown**: Managers without agent records (like KJ Vaughns) don't appear
2. **RLS Blocking Inserts**: Client-side inserts fail because RLS policies require matching user IDs
3. **Missing Agent Records**: Some managers exist in `user_roles` but don't have corresponding `agents` table entries

---

### Solution Overview

We will create a dedicated backend function to handle agent creation and fix the dropdown to include all managers properly.

---

### Implementation Steps

#### Step 1: Create Backend Function for Agent Creation
Create a new edge function `add-agent` that uses the service role key to bypass RLS and properly create:
- Auth user (with random password)
- Profile record
- Agent record linked to the specified manager
- Agent role in user_roles
- Optional initial note

**New file:** `supabase/functions/add-agent/index.ts`

#### Step 2: Fix Manager Dropdown Logic
Update the modal to use the existing `get-active-managers` edge function instead of client-side queries. This edge function already uses the service role key and can see all managers.

Alternatively, fix the client-side query to also include admins who have the manager role.

**File to modify:** `src/components/dashboard/AddAgentModal.tsx`

#### Step 3: Create Missing Manager Agent Records
Run a database fix to create agent records for managers who are missing them:
- KJ Vaughns (user_id: 75b17131-...)
- Obiajulu Ifediora (user_id: 80010a1e-...)

#### Step 4: Add License Status Selection
Add a license status selector to the form (Licensed/Unlicensed/In Progress) since agents may be at different stages.

#### Step 5: Add Optional Fields
- City/State fields for location
- Instagram handle field
- Onboarding stage selector (for admins)

---

### Technical Details

**Edge Function Logic:**
```text
1. Receive: firstName, lastName, email, phone, managerId, licenseStatus, notes, startDate
2. Normalize email
3. Check if profile already exists (return error if duplicate)
4. Create auth user with service role
5. Create profile record
6. Create agent record with invited_by_manager_id = managerId
7. Add 'agent' role to user_roles
8. Create initial note if provided
9. Trigger welcome email
10. Return success with new agent ID
```

**Form Improvements:**
- Show loading state while fetching managers
- Show "No managers available" message if dropdown is empty
- Add email validation
- Add phone number formatting
- Pre-select current user's manager (for managers adding to their own team)

---

### Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/add-agent/index.ts` | Create - New edge function |
| `src/components/dashboard/AddAgentModal.tsx` | Modify - Use edge function, improve UI |

### Database Fixes (One-Time)
Create agent records for managers missing them so the dropdown shows all available managers.

---

### Expected Outcome
- Add Agent button works reliably for admins and managers
- All managers appear in the dropdown
- Proper error handling with clear messages
- New agents receive welcome email and can be tracked in CRM
