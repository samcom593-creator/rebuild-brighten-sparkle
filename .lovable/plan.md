

## Agent Delete Options Plan

### Overview
Replace the current single-action delete confirmation with a choice dialog that offers two options when the admin clicks "Delete":
1. **Mark as Inactive** - Keeps the agent record but marks them as inactive (soft delete)
2. **Permanently Delete** - Removes the agent and all associated records from the system

### Implementation Details

#### 1. Update the Delete Confirmation Dialog
Replace the current `AlertDialog` in `AgentQuickEditDialog.tsx` with a two-option choice screen:

**Before:** Single confirmation → Permanent delete  
**After:** Choice screen → Inactivate OR Permanent delete with secondary confirmation

#### 2. New Dialog Flow

```text
[Delete Button Clicked]
        │
        ▼
┌───────────────────────────┐
│   Choose Action Dialog    │
│                           │
│  ┌─────────────────────┐  │
│  │ Mark as Inactive    │  │ ← Sets is_inactive = true
│  │ (Hide from views)   │  │   Agent kept for records
│  └─────────────────────┘  │
│                           │
│  ┌─────────────────────┐  │
│  │ Permanently Delete  │  │ ← Removes all records
│  │ (Cannot undo)       │  │   Full data cleanup
│  └─────────────────────┘  │
│                           │
│        [Cancel]           │
└───────────────────────────┘
```

#### 3. Files to Modify

**`src/components/dashboard/AgentQuickEditDialog.tsx`**
- Add new state: `deleteStep` to track which screen is shown (`"choice"` | `"confirm_delete"`)
- Add `handleInactivate` function to set `is_inactive = true` on the agent record
- Modify the `AlertDialog` content to show:
  - **Step 1 (Choice):** Two buttons - "Mark as Inactive" and "Permanently Delete"
  - **Step 2 (Confirm Delete):** Final confirmation before permanent deletion
- Keep existing `handleDelete` function for permanent deletion (already implemented with full cleanup)

#### 4. Technical Changes

**New State:**
```typescript
const [deleteStep, setDeleteStep] = useState<"choice" | "confirm_delete">("choice");
```

**New Inactivate Handler:**
```typescript
const handleInactivate = async () => {
  setDeleting(true);
  try {
    await supabase
      .from("agents")
      .update({ is_inactive: true })
      .eq("id", agentId);
    
    toast({ title: "Agent marked as inactive" });
    onUpdate?.();
    onOpenChange(false);
  } catch (error) {
    toast({ title: "Failed to inactivate agent", variant: "destructive" });
  } finally {
    setDeleting(false);
  }
};
```

**Updated Dialog Content:**
- When `deleteStep === "choice"`: Show two action buttons
- When `deleteStep === "confirm_delete"`: Show final warning before permanent delete
- Reset `deleteStep` to `"choice"` when dialog closes

#### 5. UI Design
- **Inactivate option:** Neutral/secondary styling with `UserMinus` icon
- **Permanent Delete option:** Destructive/red styling with `Trash2` icon  
- Clear labels explaining what each action does:
  - Inactivate: "Hide from leaderboards and active views"
  - Delete: "Remove agent and all records permanently"

