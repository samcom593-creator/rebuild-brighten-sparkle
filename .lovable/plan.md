

# Admin Panel Overhaul - Structure, Layout, and Full Control

## Summary
The user wants a complete reorganization of the Admin Panel to prioritize day-to-day workflow efficiency. The key changes are:

1. **Fix zoom/density issue** - Everything looks too zoomed in
2. **Move rarely-used sections to the bottom** (collapsible)
3. **Remove unnecessary sections** 
4. **Make Team Hierarchy the primary focus with full edit control**
5. **Enhance Team Hierarchy with comprehensive agent management capabilities**

---

## Section Reorganization

### Current Order (problematic):
1. Header
2. Pending Agent Approvals
3. Inactive Agents
4. Terminated Agent Leads
5. Abandoned Applications
6. All Leads
7. Team Overview Stats
8. Search
9. Agent Management Table (redundant)
10. Team Hierarchy
11. Manager Account Invites
12. Bulk Lead Assignment
13. Quiz Questions
14. Manager Invite Links / Lead Reassignment
15. Needs Attention / Fastest Growers

### New Order (optimized for admin workflow):

**Top Priority (Daily Actions):**
1. Header (condensed)
2. Team Overview Stats (compact)
3. Pending Agent Approvals (if any)
4. **Team Hierarchy Manager** (EXPANDED - now primary section)
5. Manager Account Invites
6. Bulk Lead Assignment
7. Manager Invite Links / Lead Reassignment

**Bottom (Collapsible - Rare Access):**
8. Inactive Agents (collapsible)
9. Terminated Agent Leads (collapsible)
10. Abandoned Applications (collapsible)
11. All Leads (collapsible)

### Sections to REMOVE:
- Agent Management Table (redundant - Team Hierarchy handles this)
- Needs Attention widget
- Fastest Growers widget
- Quiz Questions Admin (will be moved to course settings later)

---

## UI Density Fix

The "zoomed in" feeling comes from:
- Large padding values (`p-6` everywhere)
- Large gaps (`gap-6`, `gap-8`)
- Large text sizes (`text-3xl` for header)

**Fixes:**
- Reduce header title to `text-2xl`
- Reduce section padding from `p-6` to `p-4`
- Reduce gap values from `gap-6/8` to `gap-4`
- Make stats cards more compact

---

## Enhanced Team Hierarchy Manager

The Team Hierarchy needs to become the **central control hub** for agent management. Currently it only shows:
- Agent name
- Email
- Onboarding stage (read-only)
- Course progress
- Reports To (editable)

### New capabilities needed:

| Field | Current | Enhancement |
|-------|---------|-------------|
| Name | Display only | Link to full profile editor |
| Email | Display only | Editable inline |
| Phone | Not shown | Add and show |
| Instagram | Not shown | Add and show |
| Onboarding Stage | Badge (read-only) | **Dropdown to change step** |
| Manager | Dropdown (works) | Keep as is |
| Actions | None | Add 3-dot menu with Edit/Fire options |

### Implementation:
1. Add a 3-dot dropdown menu on each agent row with:
   - **Edit Profile** → Opens enhanced `AgentProfileEditor` 
   - **Remove from Pipeline** → Opens `DeactivateAgentDialog`

2. Make the "Stage" column an inline dropdown to quickly change onboarding stage

3. **Enhance AgentProfileEditor** to include:
   - Instagram handle field
   - Onboarding stage selector
   - Manager reassignment dropdown
   - Password reset button
   - All fields the admin needs

---

## Collapsible Sections

For bottom sections (Inactive, Terminated, Abandoned, All Leads):
- Wrap each in a Collapsible component
- Show count badge in header
- Default to collapsed
- One click to expand/collapse

```tsx
<Collapsible open={showInactive} onOpenChange={setShowInactive}>
  <CollapsibleTrigger className="w-full">
    <div className="flex items-center justify-between p-4">
      <span>Inactive Agents</span>
      <Badge>{inactiveCount}</Badge>
      <ChevronDown className={cn("h-4 w-4 transition", showInactive && "rotate-180")} />
    </div>
  </CollapsibleTrigger>
  <CollapsibleContent>
    {/* Existing inactive agents content */}
  </CollapsibleContent>
</Collapsible>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/DashboardAdmin.tsx` | Complete restructure: reorder sections, remove Agent Management table, remove Needs Attention, remove Fastest Growers, remove Quiz Questions, add collapsible wrappers for bottom sections, reduce padding/gaps |
| `src/components/dashboard/TeamHierarchyManager.tsx` | Add 3-dot menu with Edit Profile and Remove from Pipeline actions, make onboarding stage editable via dropdown, add integration with AgentProfileEditor and DeactivateAgentDialog |
| `src/components/admin/AgentProfileEditor.tsx` | Add Instagram handle field, add onboarding stage selector, add manager reassignment dropdown, add password reset capability |

---

## Expected Result

1. **Less "zoomed in"** - Tighter spacing, more content visible at once
2. **Team Hierarchy is #1** - First major section after pending approvals
3. **Full control from one place** - Edit any agent field, change stage, fire, reassign manager all from Team Hierarchy
4. **Rarely-used sections collapsed** - Inactive, Terminated, Abandoned, All Leads are at the bottom and collapsed by default
5. **No clutter** - Removed Agent Management table (redundant), Needs Attention, Fastest Growers, Quiz Questions

