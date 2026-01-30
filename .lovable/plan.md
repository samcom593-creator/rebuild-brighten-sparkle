
## Fix Course Management & Mobile Performance Access

### Current Issues Identified

1. **Performance Breakdown hidden on mobile with no alternative access**: We just hid `TeamPerformanceBreakdown` on mobile, but now there's no way for managers/admins to view this data on their phones.

2. **Unenroll is buried in dropdown**: Currently, to unenroll someone from the course, you must click "Actions" dropdown then find "Unenroll from Course" - not intuitive.

3. **Add to Course is also buried**: The `AddToCourseButton` only appears inside the dropdown menu for agents who haven't started - needs to be more prominent.

---

## Solution

### 1. Mobile Performance Access
Add a collapsible "View Performance" button on mobile that expands to show the TeamPerformanceBreakdown. This keeps the dashboard clean by default but allows access when needed.

**Approach**: Instead of completely hiding it, wrap it in a collapsible section on mobile with a button to expand/collapse.

### 2. Visible X Button for Unenrollment
Add a small "X" button directly on each agent row in the Course Progress table for quick unenrollment - no need to open a dropdown.

### 3. Prominent "Add to Course" Button
Add a standalone "Add Agent" button in the Course Progress header that opens a dialog to select and enroll agents who aren't already in the course.

---

## Technical Changes

### File 1: `src/pages/Dashboard.tsx`

Replace the mobile-hiding logic with a collapsible toggle:

```tsx
// Instead of hiding completely on mobile:
{(isManager || isAdmin) && !isMobile && (
  <TeamPerformanceBreakdown />
)}

// Change to:
{(isManager || isAdmin) && (
  <div className="mb-6">
    {isMobile ? (
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full gap-2">
            <BarChart3 className="h-4 w-4" />
            View Performance Breakdown
            <ChevronDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4">
          <TeamPerformanceBreakdown />
        </CollapsibleContent>
      </Collapsible>
    ) : (
      <TeamPerformanceBreakdown />
    )}
  </div>
)}
```

**Imports to add**: `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`

---

### File 2: `src/pages/CourseProgress.tsx`

**Change 1**: Add X button directly on each row (lines ~525-651)

Add a visible X button for quick unenrollment on each agent row:

```tsx
// In TableCell for Actions (around line 599):
<TableCell>
  <div className="flex items-center gap-1">
    {/* Quick X button for unenroll */}
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
      onClick={() => unenrollMutation.mutate(agent.agentId)}
      disabled={unenrollMutation.isPending}
    >
      <X className="h-4 w-4" />
    </Button>
    
    {/* Existing dropdown for other actions */}
    <DropdownMenu>
      ...
    </DropdownMenu>
  </div>
</TableCell>
```

**Change 2**: Add standalone "Add Agent to Course" button in header

Add a button next to "View Full Course" that opens a dialog to select agents:

```tsx
// In header actions (around line 382):
<div className="flex gap-2 flex-wrap">
  <AddAgentToCourseDialog onSuccess={() => refetch()} />
  <Button variant="outline" size="sm" onClick={() => ...}>
    ...
  </Button>
</div>
```

---

### File 3: New Component `src/components/dashboard/AddAgentToCourseDialog.tsx`

Create a dialog component that:
1. Fetches agents in "onboarding" stage who aren't already enrolled
2. Shows a searchable list with checkboxes
3. Bulk enrolls selected agents using the same logic as `AddToCourseButton`

```tsx
// Key structure:
export function AddAgentToCourseDialog({ onSuccess }) {
  const [open, setOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  
  // Fetch eligible agents (in onboarding stage, no course progress)
  const { data: eligibleAgents } = useQuery({...});
  
  // Enrollment mutation
  const enrollMutation = useMutation({...});
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserPlus className="h-3.5 w-3.5" />
          Add to Course
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* Agent selection list with checkboxes */}
        {/* Enroll button */}
      </DialogContent>
    </Dialog>
  );
}
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Make TeamPerformanceBreakdown collapsible on mobile instead of hidden |
| `src/pages/CourseProgress.tsx` | Add visible X button for quick unenroll, integrate AddAgentToCourseDialog |
| `src/components/dashboard/AddAgentToCourseDialog.tsx` (new) | Dialog to add agents to course with multi-select |

---

## Mobile Experience After Changes

- **Dashboard**: Managers/admins see a "View Performance Breakdown" button that expands the full component when tapped
- **Course Progress**: Each agent row has a visible X button for one-tap unenrollment, plus a prominent "Add to Course" button in the header
