
## Plan: Enhance "Your Team" Section for Agency-Wide View + Unlicensed Pipeline

### Problem Summary
The current "Your Team" section (`ManagerTeamView`) only shows direct reports (`invited_by_manager_id === currentAgent.id`). For admins, it needs to:
1. Show **all agents in the agency**
2. Display who each agent's manager is (if not direct report)
3. Add a **collapsible section for unlicensed agents** to view the unlicensed pipeline

---

### Implementation

#### 1. Update ManagerTeamView Data Fetching

Modify `fetchTeamData()` to fetch differently based on role:

- **Admin**: Fetch ALL agents (not deactivated), including their manager info
- **Manager**: Keep current behavior (only direct reports)

```typescript
// For admins: fetch all agents with manager info
if (isAdmin) {
  const { data: allAgents } = await supabase
    .from("agents")
    .select(`
      id, user_id, status, onboarding_stage, created_at, license_status,
      invited_by_manager_id,
      inviting_manager:agents!invited_by_manager_id(
        id,
        profile:profiles!agents_profile_id_fkey(full_name)
      )
    `)
    .eq("is_deactivated", false);
}
```

#### 2. Add Manager Name to TeamMember Interface

```typescript
interface TeamMember {
  // ... existing fields
  licenseStatus: "licensed" | "unlicensed" | "pending";
  managerName: string | null; // New field - shows who their manager is
  isDirectReport: boolean;    // New field - true if invited_by_manager_id matches current user
}
```

#### 3. Split Display into Licensed and Unlicensed Sections

Create two collapsible sections:

```text
+------------------------------------------+
| Your Team (12)                    [Sort] |
+------------------------------------------+
| [Collapsible] Licensed Agents (8)        |
|   - Agent A (Week: $5k | Month: $12k)    |
|   - Agent B - Manager: Obi [badge]       |
|   ...                                    |
+------------------------------------------+
| [Collapsible] Unlicensed Pipeline (4)    |
|   - Agent C (Onboarding)                 |
|   - Agent D (Training) - Manager: Sam    |
|   ...                                    |
+------------------------------------------+
```

#### 4. Add Manager Badge for Non-Direct Reports

For admins viewing agents who are not their direct reports:

```tsx
{!member.isDirectReport && member.managerName && (
  <Badge variant="outline" className="text-xs">
    Manager: {member.managerName}
  </Badge>
)}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/ManagerTeamView.tsx` | Add license filtering, manager info display, collapsible sections |

---

### UI Changes

**For Admins:**
- Two collapsible sections: "Licensed Agents" and "Unlicensed Pipeline"
- Each agent shows their manager's name if not a direct report
- Both sections are expandable, defaulting to Licensed open and Unlicensed collapsed

**For Managers:**
- Same two-section layout for their direct reports only
- No manager badge needed (all are direct reports)

---

### Technical Details

1. **Query Enhancement**: Use Supabase's relationship syntax to join the manager's profile name in a single query
2. **Filtering Logic**: Split `sortedMembers` into `licensedMembers` and `unlicensedMembers` arrays
3. **Collapsible Component**: Use existing `Collapsible` from Radix UI
4. **Sorting**: Apply same sort options to both sections independently
