
# Collapsible Sidebar with Full-Screen Toggle

## What You're Getting

A persistent arrow/chevron button on the sidebar that:
- **Collapses** the sidebar to give you full-screen content on any page
- **Expands** it back when you need navigation
- Works smoothly with animation
- Remembers your preference (localStorage)

---

## Current State

The sidebar is:
- **Fixed at 256px (w-64)** on desktop
- **Only slides in/out on mobile** via hamburger menu
- **No way to collapse on desktop** - always takes up screen space

---

## Implementation

### Visual Design

```text
EXPANDED (Current):                    COLLAPSED (New):
+----------+-------------------+       +---+------------------------+
| [Logo]   |                   |       |   |                        |
| -------- |                   |       |[<]|     FULL SCREEN        |
| [<] Nav  |    CONTENT        |       |   |       CONTENT          |
| Items    |                   |       +---+------------------------+
|          |                   |
+----------+-------------------+
     ^
     |
  Collapse arrow
```

### Collapse Button Placement

A small chevron button positioned at:
- **Bottom of the sidebar header** (next to APEX Financial logo)
- Or as a **floating edge button** on the sidebar's right border

When collapsed:
- Sidebar shrinks to ~56px (icon-only mode) OR hides completely
- A small expand arrow appears at the left edge
- Main content expands to full width

---

## Technical Changes

### File: `src/components/dashboard/DashboardLayout.tsx`

**Add:**
1. New state: `sidebarCollapsed` (boolean)
2. Toggle button with `ChevronLeft` / `ChevronRight` icons
3. Dynamic width classes: `w-64` (expanded) vs `w-14` (collapsed)
4. Conditional text hiding when collapsed (icons only)
5. Animated transitions for smooth expand/collapse
6. LocalStorage persistence for user preference

**Behavior:**
- When collapsed on desktop: show only icons, hide text labels
- MiniLeaderboard hidden when collapsed
- User info section condensed to just avatar
- Keyboard shortcut: `Ctrl/Cmd + B` to toggle

### Layout Changes

```typescript
// Current
<aside className="w-64 ...">

// New
<aside className={cn(
  "transition-all duration-300",
  sidebarCollapsed ? "w-14" : "w-64"
)}>
```

### Main Content Adjustment

```typescript
// Current
<main className="lg:pl-64 ...">

// New  
<main className={cn(
  "transition-all duration-300",
  sidebarCollapsed ? "lg:pl-14" : "lg:pl-64"
)}>
```

---

## Collapsed State Details

| Element | Expanded | Collapsed |
|---------|----------|-----------|
| Logo | "APEX Financial" | Crown icon only |
| Nav Items | Icon + Label | Icon only (with tooltip) |
| MiniLeaderboard | Visible | Hidden |
| User Info | Name + Email | Avatar only |
| Theme Toggle | Visible | Hidden |
| Sign Out | Text + Icon | Icon only |
| Collapse Button | `«` arrow | `»` arrow |

---

## Interaction Details

1. **Click the arrow** → Sidebar collapses/expands with smooth animation
2. **Hover on collapsed icons** → Tooltip shows the label (e.g., "Dashboard")
3. **Keyboard shortcut** → `Ctrl+B` / `Cmd+B` toggles sidebar
4. **Persistence** → State saved to localStorage, restored on page load
5. **Mobile unchanged** → Hamburger menu still works as before

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/DashboardLayout.tsx` | Add collapse state, toggle button, dynamic widths, tooltips |
| `src/components/dashboard/MiniLeaderboard.tsx` | Add `collapsed` prop to hide when sidebar is collapsed |

---

## Summary

This gives you the ability to push the sidebar in on any screen (Dashboard, Command Center, CRM, etc.) for maximum content space, while keeping the navigation always accessible via a single click or keyboard shortcut.
