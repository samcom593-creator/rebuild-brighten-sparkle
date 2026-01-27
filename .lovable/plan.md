

# Team Hierarchy Manager - Admin Dashboard Enhancement

## Problem Identified

Your dashboard's "Team Production" card is missing agents because:

1. **Caden and Ruby are not in the database** - They need to be added as agents first
2. **Duplicate admin records** - You have two agent entries (one active, one deactivated) which can cause confusion in hierarchy lookups
3. **No admin tool exists** for quick hierarchy management - currently requires direct database edits

## Current Data State

| Agent Name | Status | Reports To | Notes |
|------------|--------|------------|-------|
| Samuel James | Active | (none) | Your primary active agent record |
| Samuel James | Deactivated | (none) | Old duplicate record |
| Aisha Kebbeh | Active | Samuel James | Already correctly linked |
| KJ Vaughns | Active | Samuel James | Correctly linked |
| Obi Ifediora | Active | Samuel James | Correctly linked |
| Bryan Ross | Active | Samuel James | Correctly linked |
| **Caden** | **NOT FOUND** | - | Needs to be added |
| **Ruby** | **NOT FOUND** | - | Needs to be added |

## Solution: Team Hierarchy Manager Component

Create a new admin tool that allows quick hierarchy fixes and bulk reassignments.

### 1. Create Hierarchy Manager Component

**New File: `src/components/dashboard/TeamHierarchyManager.tsx`**

Features:
- View all agents with their current manager assignment
- Dropdown to reassign any agent to a different manager
- "Assign All to Me" button for admins
- Shows orphaned agents (no manager assigned)
- Filter by manager to see each team
- Bulk reassignment capability

### 2. Add to Admin Dashboard

**Modify: `src/pages/DashboardAdmin.tsx`**

Add a new "Team Hierarchy" section with the manager component.

### 3. Update DownlineStatsCard for Admin

**Modify: `src/components/dashboard/DownlineStatsCard.tsx`**

For admins, show **ALL active agents** production instead of just direct reports.

### 4. Data Cleanup Required

Will need to run a database update to:
- Reactivate your correct admin agent record OR ensure the active one is used
- Ensure all agents point to the correct `invited_by_manager_id`

---

## UI Design

```text
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️ Team Hierarchy Manager                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  🔍 Filter: [All Managers ▼]     [🔄 Assign All to Me]  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  Agent Name          │ Email               │ Reports To    ││
│  ├──────────────────────┼─────────────────────┼───────────────┤│
│  │  Aisha Kebbeh        │ kebbeh045@gmail.com │ [Samuel ▼]    ││
│  │  KJ Vaughns          │ kjvaughns13@...     │ [Samuel ▼]    ││
│  │  Obi Ifediora        │ obiajulu.ifediora...│ [Samuel ▼]    ││
│  │  ⚠️ Chukwudi Ifediora │ Chukwudi...        │ [Obi ▼]       ││
│  │  ⚠️ KJ TestV          │ kjvaughns1@...     │ [KJ Vaughns ▼]││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ⚠️ 2 agents report to sub-managers                            │
│  [📊 Flatten All Hierarchies to Admin]                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/dashboard/TeamHierarchyManager.tsx` | **Create** | New admin tool for hierarchy management |
| `src/pages/DashboardAdmin.tsx` | **Modify** | Add Hierarchy Manager section |
| `src/components/dashboard/DownlineStatsCard.tsx` | **Modify** | Admin sees all agents, not just direct reports |

---

## Technical Implementation

### TeamHierarchyManager Component

```typescript
// Key features:
// 1. Fetch all active agents with their current manager
// 2. Fetch all managers for dropdown options
// 3. Allow reassignment with one click
// 4. "Assign All to Me" bulk action for admin
// 5. Show nested hierarchy (agents under managers under admin)

interface AgentHierarchyEntry {
  id: string;
  name: string;
  email: string;
  managerId: string | null;
  managerName: string | null;
  isManager: boolean;
}

// Reassign agent function
const reassignAgent = async (agentId: string, newManagerId: string | null) => {
  await supabase
    .from("agents")
    .update({ invited_by_manager_id: newManagerId })
    .eq("id", agentId);
};

// Bulk reassign to admin
const assignAllToAdmin = async (adminAgentId: string) => {
  await supabase
    .from("agents")
    .update({ invited_by_manager_id: adminAgentId })
    .neq("id", adminAgentId)
    .eq("is_deactivated", false);
};
```

### DownlineStatsCard Admin Enhancement

```typescript
// For admins, fetch ALL active agents, not just direct reports
if (isAdmin) {
  const { data: allAgents } = await supabase
    .from("agents")
    .select("id")
    .eq("is_deactivated", false)
    .neq("id", currentAgent.id);
  
  agentIds = allAgents?.map(a => a.id) || [];
} else {
  // Managers still see only their direct reports
  const { data: downlineAgents } = await supabase
    .from("agents")
    .select("id")
    .eq("invited_by_manager_id", currentAgent.id)
    .eq("is_deactivated", false);
  
  agentIds = downlineAgents?.map(a => a.id) || [];
}
```

---

## Database Fix (One-Time)

After implementation, you'll use the new tool to:

1. Click "Assign All to Me" to flatten hierarchy
2. Or manually reassign specific agents using dropdowns

For Caden and Ruby - they need to be added via the CRM's "Add Agent" functionality first, then they'll appear in the hierarchy manager.

---

## Benefits

1. **Visual Hierarchy Control** - See exactly who reports to whom
2. **One-Click Fixes** - Reassign agents without SQL
3. **Admin Global View** - See ALL production, not just direct reports
4. **Orphan Detection** - Easily spot agents without managers
5. **Bulk Actions** - Flatten hierarchy with one button

