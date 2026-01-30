

# Merge Admin Panel + Command Center & Streamline Navigation

## Overview
The Admin Panel and Command Center currently serve overlapping purposes - both manage agents, track performance, and provide admin controls. Merging them into a single, streamlined "Command Center" will eliminate navigation confusion and create one authoritative control hub.

## Changes Summary

### 1. Remove MiniLeaderboard from Sidebar
The "Top Recruiters" widget in the left sidebar will be removed to declutter the navigation and keep focus on the main content area.

**File:** `src/components/layout/GlobalSidebar.tsx`
- Remove the `MiniLeaderboard` import (line 28)
- Remove the component rendering (line 295): `{!isCollapsed && <MiniLeaderboard />}`

### 2. Streamline Navigation Items
Reduce sidebar clutter by:
- Removing "Admin Panel" as a separate nav item (since Command Center will absorb its functionality)
- Keeping "Command Center" as the primary admin hub

**File:** `src/components/layout/GlobalSidebar.tsx`
- Remove the "Admin Panel" nav item from the navigation array (line 131)
- Keep "Command Center" as the single admin destination

### 3. Merge Admin Panel Features into Command Center
The Command Center will absorb key Admin Panel features:

**Features to merge from Admin Panel:**
| Feature | Current Location | Action |
|---------|------------------|--------|
| Pending Agent Approvals | Admin Panel | Move to Command Center |
| Team Hierarchy Manager | Admin Panel | Move to Command Center |
| Manager Account Invites | Admin Panel | Move to Command Center |
| Bulk Lead Assignment | Admin Panel | Move to Command Center |
| Manager Invite Links | Admin Panel | Move to Command Center (collapsible) |
| Lead Reassignment | Admin Panel | Move to Command Center (collapsible) |
| Collapsible sections (Inactive, Terminated, Abandoned, All Leads) | Admin Panel | Move to Command Center (keep collapsible) |
| Lead Import/Export | Admin Panel | Move to Command Center header |

**Command Center features to keep:**
- Summary stats cards (Total ALP, Active Agents, Producers, Needs Attention)
- Time period filters (Today, Week, Month, Custom)
- Search and quick filters
- Production leaderboard with agent actions
- Recognition Queue
- Course Progress Panel
- Agent Profile Editor
- Duplicate Merge Tool

### 4. New Command Center Layout (Top to Bottom)

```text
┌─────────────────────────────────────────────────────┐
│  HEADER: Command Center + Import/Export buttons    │
├─────────────────────────────────────────────────────┤
│  STATS: Total ALP | Active | Producers | Attention │
├─────────────────────────────────────────────────────┤
│  PENDING APPROVALS (if any exist)                  │
├───────────────────────────────────┬─────────────────┤
│  TIME FILTERS + SEARCH            │                 │
├───────────────────────────────────┤ RECOGNITION     │
│  QUICK FILTERS                    │ QUEUE +         │
├───────────────────────────────────┤ COURSE          │
│  PRODUCTION LEADERBOARD           │ PROGRESS        │
│  (sorted by production)           │                 │
├───────────────────────────────────┴─────────────────┤
│  TEAM HIERARCHY MANAGER                             │
├─────────────────────────────────────────────────────┤
│  MANAGER INVITES + BULK ASSIGNMENT (side by side)  │
├─────────────────────────────────────────────────────┤
│  INVITE LINKS + LEAD REASSIGNMENT (collapsible)    │
├─────────────────────────────────────────────────────┤
│  COLLAPSIBLE: Inactive | Terminated | Abandoned    │
└─────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/layout/GlobalSidebar.tsx` | Remove MiniLeaderboard component and import, remove "Admin Panel" nav item |
| `src/pages/DashboardCommandCenter.tsx` | Add all Admin Panel features: pending approvals, team hierarchy, manager invites, bulk assignment, lead import/export, collapsible sections |
| `src/pages/DashboardAdmin.tsx` | Redirect to Command Center (simple redirect page) |

---

## Technical Implementation Details

### GlobalSidebar.tsx Changes
1. Remove import: `import { MiniLeaderboard } from "@/components/dashboard/MiniLeaderboard";`
2. Remove render: `{!isCollapsed && <MiniLeaderboard />}` (around line 295)
3. Remove from navItems array:
```typescript
// REMOVE this line:
{ icon: Shield, label: "Admin Panel", href: "/dashboard/admin", roles: ["admin", "manager"] }
```

### DashboardCommandCenter.tsx Changes
Add imports and integrate:
- `TeamHierarchyManager` component
- `AdminManagerInvites` component  
- `BulkLeadAssignment` component
- `ManagerInviteLinks` component
- `LeadReassignment` component
- `LeadImporter` and `LeadExporter` components
- `TerminatedAgentLeadsPanel`, `AbandonedLeadsPanel`, `AllLeadsPanel` with Collapsible wrappers
- Pending agent approval logic and UI

### DashboardAdmin.tsx Changes
Replace entire file with a simple redirect:
```typescript
import { Navigate } from "react-router-dom";

export default function DashboardAdmin() {
  return <Navigate to="/dashboard/command" replace />;
}
```

---

## Expected Result

1. **One unified admin hub** - Command Center becomes the single destination for all admin operations
2. **Cleaner sidebar** - No more "Top Recruiters" widget or duplicate admin links
3. **Streamlined workflow** - Everything an admin needs in one scrollable page
4. **No broken links** - Old `/dashboard/admin` route redirects to Command Center

