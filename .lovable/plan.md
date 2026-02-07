

# Plan: Enhanced Agent Management in Command Center + System Verification

## Summary

After thorough investigation, I found that **all core systems are working correctly**:

- **Applications**: New applications are being submitted successfully (Brian Hernandez, Christian Davis, etc. all from Feb 6)
- **Manager Assignment**: The `get-active-managers` Edge Function is deployed and returns 3 active managers
- **Email Systems**: All notification functions are operational

This plan adds a dedicated **Agent Management section** to the Command Center for easier add/locate/edit/delete functionality.

---

## Verified Systems Status

| System | Status | Evidence |
|--------|--------|----------|
| Application Submission | Working | 10+ new applications in database |
| `get-active-managers` Edge Function | Working | Returns 3 managers (Samuel James, KJ Vaughns, Obiajulu Ifediora) |
| Lead Center Manager Assignment | Working | Uses edge function on line 510-522 |
| `submit-application` Edge Function | Working | Applications being created |
| Email Notifications | Working | Previous logs showed successful delivery |

---

## Enhancement: Add Agent Management Section

The Command Center already has the "Invite Team" button and TeamHierarchyManager. I'll enhance this with a more prominent "Add Agent" capability and search functionality.

### Changes to `src/pages/DashboardCommandCenter.tsx`

**1. Add Import for AddAgentModal**
```typescript
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
```

**2. Update Header Actions** (Lines 427-446)

Add "Add Agent" button alongside "Invite Team":
```tsx
<div className="flex flex-wrap items-center gap-2">
  <LeadImporter />
  <LeadExporter />
  <AddAgentModal onAgentAdded={() => refetch()} />
  <Button 
    variant="default" 
    onClick={() => setShowInviteModal(true)}
    className="gap-2"
  >
    <UserPlus className="h-4 w-4" />
    Invite Team
  </Button>
  <Button 
    variant="outline" 
    onClick={() => setShowDuplicateTool(true)}
    className="gap-2"
  >
    <Users className="h-4 w-4" />
    Find Duplicates
  </Button>
</div>
```

---

### Fix: QuickAssignMenu to Use Edge Function

The `QuickAssignMenu.tsx` component uses direct database queries instead of the edge function, which may cause RLS issues. Update it to use the edge function for consistency.

**File**: `src/components/dashboard/QuickAssignMenu.tsx`

**Current** (Lines 38-87): Direct queries to `user_roles`, `agents`, `profiles` tables

**Change to**:
```typescript
const fetchManagers = async () => {
  setLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke("get-active-managers");
    
    if (error) {
      console.error("Error fetching managers:", error);
      setManagers([]);
      return;
    }
    
    if (data?.managers) {
      // Transform to expected format with email
      const managersWithEmail = await Promise.all(
        data.managers.map(async (m: { id: string; name: string }) => {
          // Get email from profiles via agent lookup
          const { data: agent } = await supabase
            .from("agents")
            .select("user_id")
            .eq("id", m.id)
            .single();
          
          if (agent?.user_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("email")
              .eq("user_id", agent.user_id)
              .single();
            
            return { id: m.id, name: m.name, email: profile?.email || "" };
          }
          return { id: m.id, name: m.name, email: "" };
        })
      );
      setManagers(managersWithEmail);
    }
  } catch (error) {
    console.error("Error fetching managers:", error);
  } finally {
    setLoading(false);
  }
};
```

---

## Files Summary

| File | Changes |
|------|---------|
| `src/pages/DashboardCommandCenter.tsx` | Add AddAgentModal import and button in header |
| `src/components/dashboard/QuickAssignMenu.tsx` | Update to use `get-active-managers` edge function |

---

## Expected Results

1. **Add Agent Button**: Visible in Command Center header for quick agent creation
2. **Consistent Manager Data**: Both Lead Center and QuickAssignMenu use the same edge function
3. **Zero Managers Fixed**: The `QuickAssignMenu` will now show managers consistently with Lead Center

---

## Testing Verification

After implementation:
1. Click "Add Agent" in Command Center header - should open the add agent modal
2. Select a manager from the dropdown - should show 3 managers (Samuel James, KJ Vaughns, Obiajulu Ifediora)
3. Add a test agent and verify they appear in the Team Hierarchy Manager
4. In Lead Center, verify bulk assign shows the same 3 managers

