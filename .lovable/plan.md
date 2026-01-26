
## Plan: Terminated Agent Leads Section in Admin Panel

### Overview
Add a dedicated "Terminated Agent Leads" section to the Admin Panel that displays all leads/applications that were assigned to agents who have been terminated. This allows admins to track orphaned leads and potentially re-engage them or reassign to active managers.

---

## Implementation Details

### 1. Create New Component: `TerminatedAgentLeadsPanel.tsx`

**Location:** `src/components/dashboard/TerminatedAgentLeadsPanel.tsx`

**Features:**
- Query leads where `assigned_agent_id` points to a terminated agent
- Display lead details: name, email, phone, status, license status, original agent name
- Show count badge of total orphaned leads
- Include actions:
  - "Reassign" - Quick action to assign lead to an active manager
  - Contact actions (email/phone)
  - "Restore Agent" link if the lead's agent can be reactivated
- Collapsible section with distinct styling (similar to terminated leads in AllLeadsPanel)

**Data Flow:**
```
1. Fetch all terminated agents (status = 'terminated')
2. Get their agent IDs
3. Query applications where assigned_agent_id is in that list
4. Display with original terminated agent's name for context
```

### 2. Modify Admin Dashboard (`DashboardAdmin.tsx`)

**Changes:**
- Import the new `TerminatedAgentLeadsPanel` component
- Add it as a new section between "Inactive Agents" and "Abandoned Applications"
- Include in the Team Overview stat cards (optional: "Orphaned Leads" count)

**Placement in UI:**
```
┌─────────────────────────────────────────┐
│ Admin Panel                              │
├─────────────────────────────────────────┤
│ [Pending Agent Approvals]                │
├─────────────────────────────────────────┤
│ [Inactive Agents]                        │
├─────────────────────────────────────────┤
│ [Terminated Agent Leads] ← NEW SECTION   │
│  - Shows leads from terminated agents    │
│  - Reassign actions                      │
│  - Contact quick actions                 │
├─────────────────────────────────────────┤
│ [Abandoned Applications]                 │
├─────────────────────────────────────────┤
│ [All Leads]                              │
└─────────────────────────────────────────┘
```

### 3. Component Design

**TerminatedAgentLeadsPanel Structure:**
```tsx
<GlassCard className="border border-orange-500/30 bg-orange-500/5">
  <Header>
    <UserX icon />
    "Terminated Agent Leads"
    <Badge>{count} Orphaned</Badge>
    <RefreshButton />
  </Header>
  
  <Table>
    <Columns: Lead Name | Contact | Status | License | Former Agent | Applied Date | Actions>
    {leads.map(lead => (
      <Row>
        - Lead info
        - "Formerly: {terminatedAgentName}" in muted text
        - Reassign dropdown to active managers
        - Contact actions
      </Row>
    ))}
  </Table>
</GlassCard>
```

### 4. Quick Reassign Feature

**Implementation:**
- Dropdown menu with list of active managers
- On selection, update `applications.assigned_agent_id` to the new manager
- Show toast confirmation
- Refresh the panel to remove reassigned lead

---

## Technical Details

### Database Queries

**Fetch terminated agents:**
```typescript
const { data: terminatedAgents } = await supabase
  .from("agents")
  .select("id, user_id")
  .eq("status", "terminated");
```

**Fetch leads from terminated agents:**
```typescript
const { data: orphanedLeads } = await supabase
  .from("applications")
  .select("*")
  .in("assigned_agent_id", terminatedAgentIds)
  .is("terminated_at", null);  // Only active leads (not terminated leads)
```

**Fetch active managers for reassignment:**
```typescript
const { data: activeManagers } = await supabase
  .from("agents")
  .select("id, user_id")
  .eq("status", "active");
  // Join with user_roles to filter managers only
```

### RLS Considerations

The existing RLS policies should allow admins to:
- Read all agents (including terminated)
- Read all applications
- Update applications for reassignment

No new RLS policies needed since admin has full access via `has_role(auth.uid(), 'admin')`.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/dashboard/TerminatedAgentLeadsPanel.tsx` | CREATE | New component for displaying orphaned leads |
| `src/pages/DashboardAdmin.tsx` | MODIFY | Import and add the new panel to the admin dashboard |

---

## UI/UX Considerations

1. **Visual Distinction**: Use orange/amber color scheme to distinguish from red (terminated leads) and yellow (pending)
2. **Empty State**: Show helpful message when no orphaned leads exist
3. **Batch Operations**: Consider adding bulk reassign capability in future
4. **Real-time Updates**: Subscribe to applications changes for live updates

---

## Expected Outcome

After implementation:
- Admins will see a dedicated "Terminated Agent Leads" section in the Admin Panel
- The section shows all leads that were assigned to now-terminated agents
- Each lead can be quickly reassigned to an active manager
- Lead count is visible at a glance for tracking purposes
- Supports the user's goal of tracking and re-engaging orphaned leads
