

# Make the "Merge Duplicates" Button Prominent and Always Visible

## Problem
The "Merge All Duplicates" button exists in the Aged Leads page but is hidden when there are no detected duplicates (`duplicateMap.size === 0`) and blends in with other small header buttons when visible. The user wants a clear, easy-to-tap button that's always accessible.

## Changes

### File: `src/pages/DashboardAgedLeads.tsx`

1. **Move the Merge Duplicates button out of the header row** -- Place it as a prominent standalone element below the stats row (or as a highlighted banner) so it stands out visually.

2. **Always show the button** -- Remove the `duplicateMap.size > 0` conditional. When there are no duplicates, show it in a disabled/muted state with "No Duplicates" text. When duplicates exist, show it with a pulsing badge and bold styling.

3. **Make it visually distinct:**
   - Full-width banner-style button below the stats cards
   - Gradient background (amber/orange) when duplicates exist
   - Animated badge showing the count
   - Larger text and icon size so it's immediately noticeable
   - When no duplicates: show a green checkmark with "No Duplicates Found" in a subtle card

4. **Remove the admin-only restriction** -- Allow managers to also see and use the merge button (since managers can manage their assigned aged leads).

## Technical Details

**Current code (line 447-452):**
```
{isAdmin && duplicateMap.size > 0 && (
  <Button onClick={handleAutoMergeDuplicates} size="sm" variant="outline" className="gap-1.5 text-amber-500 ...">
    <AlertTriangle className="h-3.5 w-3.5" />
    Merge {duplicateMap.size} Duplicates
  </Button>
)}
```

**New approach:** Remove the button from the header `div` (line 447-452). Add a new section between the stats row and the filters bar (between lines 492 and 494) showing a full-width merge card:

- When `duplicateMap.size > 0`: A prominent amber/orange gradient card with a large "Merge All Duplicates" button, showing the count in a pulsing badge, with a brief description like "X duplicate leads detected -- merge to keep only the newest records"
- When `duplicateMap.size === 0`: A subtle green card saying "No duplicates detected"
- Both states use `motion.div` for smooth entry animation

