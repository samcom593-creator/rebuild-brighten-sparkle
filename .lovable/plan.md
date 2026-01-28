

## Add Phone Number Editing to Leaderboard

### Overview
Currently, the phone field in the Agent Edit Dialog is only visible when creating a new profile for agents without logins. You need to be able to view and edit phone numbers for **all** agents directly from the leaderboard edit dialog.

### What Will Change

#### AgentQuickEditDialog Updates
1. **Add a dedicated Phone field** visible for ALL agents (not just those without logins)
2. **Pre-fill the phone field** from the linked profile data when the dialog opens
3. **Save phone number changes** - when saving, update both:
   - The agent's linked profile (if they have one)
   - Handle agents without profiles gracefully

### Implementation Details

**File: `src/components/dashboard/AgentQuickEditDialog.tsx`**

1. Add a new Phone Number input field below the Display Name field that shows for all agents:
   - Shows current phone if one exists
   - Allows editing regardless of login status
   - Includes proper phone icon styling

2. Update `handleSaveName` function to also save the phone number:
   - If agent has a `profile_id`, update the `profiles` table with the new phone
   - Show appropriate toast messages

3. Keep the existing phone field in the "Create Profile" section (for new profiles), but also add a standalone editable phone field for existing profiles

### UI Layout (After Changes)

```
┌─────────────────────────────────┐
│ Current Agent Info Card         │
├─────────────────────────────────┤
│ Display Name: [_____________]   │
│ Phone:        [📞____________]  │  ← NEW: Always visible
├─────────────────────────────────┤
│ Create Profile section          │  ← Only for agents without login
│ (keeps existing phone field)    │
├─────────────────────────────────┤
│ Merge section                   │
├─────────────────────────────────┤
│ [Delete]  [Cancel] [Save]       │
└─────────────────────────────────┘
```

### Technical Changes

1. **New phone input** - Add between Display Name and Create Profile sections
2. **Update save function** - Modify `handleSaveName` to include phone update:
   ```typescript
   // If agent has a profile, update phone there
   if (agentData?.profile_id) {
     await supabase
       .from("profiles")
       .update({ phone: phone.trim() || null })
       .eq("id", agentData.profile_id);
   }
   ```

3. **Button label change** - Rename "Save Name" to "Save Changes" since we're saving more than just the name

