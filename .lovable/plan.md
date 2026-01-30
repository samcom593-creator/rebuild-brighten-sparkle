

# Add Merge Button to Team Hierarchy Manager

## Issue

The `DuplicateMergeTool` component exists (`src/components/admin/DuplicateMergeTool.tsx`) and works perfectly - it allows both manual and automatic duplicate detection/merging. However, there is **no button in the Team Hierarchy Manager to open this tool**.

Currently, the Team Hierarchy Manager only has:
- Bulk selection checkboxes
- "Soft Remove" and "Permanently Delete" in the floating action bar
- Per-agent dropdown with "Edit Profile" and "Remove from Pipeline"

The merge functionality is completely hidden from users.

---

## Fix

Add a "Merge Duplicates" button to the Team Hierarchy Manager that opens the existing `DuplicateMergeTool` dialog.

**File to Modify:** `src/components/dashboard/TeamHierarchyManager.tsx`

### Changes

1. **Import the DuplicateMergeTool component** at the top of the file
2. **Add state** for controlling the merge dialog: `const [showMergeTool, setShowMergeTool] = useState(false);`
3. **Add a "Merge" button** to the header area (next to the refresh button)
4. **Add the DuplicateMergeTool component** at the bottom of the JSX with proper props
5. **Also add "Merge with..." option** in the per-agent dropdown menu for quick access

### Implementation Details

**Button Location:** In the header row alongside the refresh button (line ~486-497), add:
```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => setShowMergeTool(true)}
>
  <Merge className="h-3.5 w-3.5 mr-1.5" />
  Merge
</Button>
```

**Import to add:**
```tsx
import { DuplicateMergeTool } from "@/components/admin/DuplicateMergeTool";
import { Merge } from "lucide-react";
```

**Component to add (before closing `</>`)**:
```tsx
<DuplicateMergeTool
  open={showMergeTool}
  onClose={() => setShowMergeTool(false)}
  onMergeComplete={() => {
    fetchHierarchy();
    setShowMergeTool(false);
  }}
/>
```

---

## Summary

| File | Change |
|------|--------|
| `src/components/dashboard/TeamHierarchyManager.tsx` | Import DuplicateMergeTool, add state, add Merge button in header, render the dialog |

## Result

- A visible "Merge" button appears in the Team Hierarchy header
- Clicking it opens the existing merge tool with both:
  - **Manual Merge**: Search and select agents manually to merge
  - **Auto-Detect**: View automatically detected duplicates by email/phone/name
- After merging, the hierarchy refreshes automatically

