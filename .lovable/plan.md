

# Polish LogNumbers UX + Highlight Sidebar Link

## Changes

### 1. Highlight "Log Numbers" in Sidebar
In `GlobalSidebar.tsx`, give the "Log Numbers" nav item a special visual treatment -- a glowing gradient background with a pulsing dot or accent border so it stands out from all other links. This makes it immediately obvious where agents go to submit numbers.

### 2. Upgrade LogNumbers Production Form to Use BubbleStatInput
The production step (lines 643-692) currently uses raw `<Input>` fields with tiny labels. The `CompactProductionEntry` component already uses the polished `BubbleStatInput` component with emoji icons, animated borders, and active indicator dots. Replace the raw inputs with `BubbleStatInput` to match.

Current (raw inputs):
- Small label + plain Input in a 2-col grid
- No emoji, no animation on fill

After (BubbleStatInput):
- Emoji-decorated bubble cards with animated borders
- Active indicator dot when filled
- Consistent with CompactProductionEntry

### 3. Improve Submit Button
Upgrade from a plain button to a gradient button with larger size, shadow, and hover animation -- matching the premium style used in `CompactProductionEntry`.

### 4. Better Section Spacing and Visual Hierarchy
- Add `mt-6` between Deal Amounts and Activity Stats sections
- Make the border separator more visible
- Ensure the deal entry section has breathing room

## Files to Modify

- **`src/components/layout/GlobalSidebar.tsx`** -- Add special styling to the "Log Numbers" nav item (glowing accent, distinct background)
- **`src/pages/LogNumbers.tsx`** -- Replace raw Input grid with `BubbleStatInput` components, upgrade submit button, improve spacing

