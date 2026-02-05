

# Plan: Add "Promote to Manager" Action in Command Center

## Summary

Add a simple one-click "Promote to Manager" option in the Command Center's agent dropdown menu. This allows admins to instantly promote any agent to manager status so they can be assigned leads.

---

## What Will Be Added

### 1. "Promote to Manager" Menu Option

In the Command Center's agent dropdown menu (the three dots), add a new option:
- **Icon**: Crown or Shield icon
- **Label**: "Promote to Manager"
- **Visibility**: Only show if agent is NOT already a manager
- **Action**: Inserts a `manager` role into `user_roles` table

### 2. "Demote from Manager" Option (for flexibility)

Also add the reverse action:
- **Icon**: UserMinus icon
- **Label**: "Remove Manager Role"
- **Visibility**: Only show if agent IS already a manager
- **Action**: Deletes the `manager` role from `user_roles` table

### 3. Manager Badge

Show a small badge next to agent names who are managers for quick identification.

---

## User Flow

1. Open Command Center
2. Find any agent in the leaderboard
3. Click the three dots menu
4. Click "Promote to Manager"
5. Agent immediately becomes a manager and can be assigned leads

No complicated invite links. No separate pages. Just one click.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/DashboardCommandCenter.tsx` | Add promote/demote menu items, fetch manager status, handle role updates |

---

## Technical Implementation

### Step 1: Fetch Manager Status for Each Agent

When fetching agents, also check if they have the manager role:

```typescript
// In the query, also fetch user_roles
const { data: managerRoles } = await supabase
  .from("user_roles")
  .select("user_id")
  .eq("role", "manager");

// Add isManager flag to each agent
const managerUserIds = new Set(managerRoles?.map(r => r.user_id) || []);

// When mapping agents, add:
isManager: managerUserIds.has(agent.user_id)
```

### Step 2: Add Promote Handler

```typescript
const handlePromoteToManager = async (agent: AgentWithStats) => {
  // Get the user_id for this agent
  const { data: agentRecord } = await supabase
    .from("agents")
    .select("user_id")
    .eq("id", agent.id)
    .single();
  
  if (!agentRecord?.user_id) {
    toast.error("Could not find user account for this agent");
    return;
  }
  
  // Insert manager role
  const { error } = await supabase
    .from("user_roles")
    .insert({ user_id: agentRecord.user_id, role: "manager" });
  
  if (error) {
    if (error.code === "23505") { // Unique constraint violation
      toast.info("This agent is already a manager");
    } else {
      toast.error("Failed to promote agent");
    }
    return;
  }
  
  toast.success(`${agent.fullName} is now a Manager!`);
  refetch();
};
```

### Step 3: Add Demote Handler

```typescript
const handleDemoteFromManager = async (agent: AgentWithStats) => {
  const { data: agentRecord } = await supabase
    .from("agents")
    .select("user_id")
    .eq("id", agent.id)
    .single();
  
  if (!agentRecord?.user_id) {
    toast.error("Could not find user account for this agent");
    return;
  }
  
  // Remove manager role
  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", agentRecord.user_id)
    .eq("role", "manager");
  
  if (error) {
    toast.error("Failed to remove manager role");
    return;
  }
  
  toast.success(`${agent.fullName} is no longer a Manager`);
  refetch();
};
```

### Step 4: Update Dropdown Menu

Add new menu items in the dropdown:

```tsx
<DropdownMenuContent align="end" className="bg-popover">
  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedAgent(agent); }}>
    <Pencil className="h-4 w-4 mr-2" />
    Edit Profile
  </DropdownMenuItem>
  
  {/* NEW: Promote/Demote Manager */}
  <DropdownMenuSeparator />
  {agent.isManager ? (
    <DropdownMenuItem onClick={(e) => { 
      e.stopPropagation(); 
      handleDemoteFromManager(agent); 
    }}>
      <UserMinus className="h-4 w-4 mr-2" />
      Remove Manager Role
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem onClick={(e) => { 
      e.stopPropagation(); 
      handlePromoteToManager(agent); 
    }}>
      <Crown className="h-4 w-4 mr-2" />
      Promote to Manager
    </DropdownMenuItem>
  )}
  
  <DropdownMenuSeparator />
  {/* Existing items... */}
</DropdownMenuContent>
```

### Step 5: Add Manager Badge

Show a badge next to manager names:

```tsx
<span className="font-medium truncate">{agent.fullName}</span>
{agent.isManager && (
  <Badge className="text-xs bg-teal-500/10 text-teal-600 border-teal-500/30 shrink-0">
    Manager
  </Badge>
)}
```

---

## RLS Considerations

The existing RLS policy on `user_roles` allows admins to manage all roles:

```sql
Policy: "Admins can manage all roles"
Command: ALL
Using Expression: has_role(auth.uid(), 'admin'::app_role)
```

This means only admins can promote/demote managers, which is the correct behavior.

---

## UI Preview

After implementation, the dropdown will look like:

```text
+---------------------------+
| Edit Profile              |
+---------------------------+
| Promote to Manager ⭐     |  ← NEW
+---------------------------+
| Email Login Link          |
| Copy Login Link           |
+---------------------------+
| Remove from Pipeline      |
+---------------------------+
```

And for existing managers:

```text
+---------------------------+
| Edit Profile              |
+---------------------------+
| Remove Manager Role       |  ← Shows instead
+---------------------------+
| Email Login Link          |
| Copy Login Link           |
+---------------------------+
| Remove from Pipeline      |
+---------------------------+
```

---

## Expected Outcomes

After implementation:
1. **One-click promotion** - Click on any agent → three dots → "Promote to Manager"
2. **Instant effect** - Agent immediately becomes a manager and can be assigned leads
3. **Manager badge** - Easy to see who's already a manager in the leaderboard
4. **Reversible** - Can demote if needed (Remove Manager Role option)
5. **Admin-only** - Only admins can see and use this feature (enforced by RLS)

