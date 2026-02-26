

# Fix Schedule Bar Mobile Usability

## Problem
The Schedule Bar ("urgent" banner) at the top of all authenticated pages is too cramped on mobile. The tap targets are small, the dismiss X buttons are hidden behind hover states (which don't exist on touch), and the chevron arrow isn't obviously tappable.

## Changes

### File: `src/components/layout/ScheduleBar.tsx`

**1. Increase mobile tap target size**
- Change the collapsed bar height from `py-1.5` to `py-2.5` on mobile (min 44px tap target)
- Make the chevron arrow animated (bouncing) so users know it's tappable

**2. Make dismiss X always visible on mobile**
- The dismiss X currently uses `opacity-0 group-hover:opacity-100` which doesn't work on touch devices
- Add logic: on mobile, always show the X button (opacity-100) instead of hiding it behind hover

**3. Increase pill tap targets on mobile**
- Change the schedule item pills from `px-3 py-1` to `px-3 py-2` on mobile so they're easier to tap
- Increase the X dismiss button from `h-4 w-4` to `h-6 w-6` on mobile

**4. Animate the chevron arrow**
- Add a subtle bounce animation to the ChevronDown when collapsed, signaling it's interactive

### No other files need changes
The ScheduleBar is rendered in `AuthenticatedShell.tsx` inside the `SidebarLayout`, which already handles mobile header spacing (`pt-16`). The banner itself just needs better touch targets.

## Technical Details

All changes are in `src/components/layout/ScheduleBar.tsx`:
- Use the existing `isMobile` boolean to conditionally apply larger padding/sizing
- Replace `group-hover:opacity-100` with always-visible on mobile using `isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"`
- Add `animate-bounce` class to the chevron icon when `!expanded`

