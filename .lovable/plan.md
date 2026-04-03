

# Team Hierarchy Visual Overhaul + Auto-Crop Profile Pictures

## Summary
Redesign the Team Hierarchy page with premium dark fintech styling (glow effects, animated entrances, role-specific ring colors, connecting lines) and add client-side canvas auto-crop to center-crop uploaded profile photos to a square before uploading.

## Changes

### 1. `src/pages/TeamHierarchy.tsx` — Visual overhaul
- **Role-specific avatar rings**: Admin = gold glow ring, Manager = green glow ring, Agent = subtle border
- **Animated stagger entrance**: Each node fades/slides in with staggered delay using framer-motion
- **Connecting tree lines**: CSS `border-left` vertical lines with `border-bottom` horizontal connectors at each depth level (replaces plain `marginLeft`)
- **Stat cards upgrade**: Add pulse-glow effect, animated counters, gradient backgrounds per role
- **Node hover effects**: Glassmorphic hover with subtle scale transform and glow shadow
- **Role badges**: Colored pill badges ("Admin", "Manager", "Agent") instead of just icons
- **Search**: Add focus glow ring effect on the search input
- **Header**: Add a subtle gradient text effect on the title
- **Expand/collapse**: Smooth rotate animation on chevron icons (180deg transition)
- **Empty avatar fallback**: Gradient background matching role color

### 2. `src/components/dashboard/AvatarUpload.tsx` — Auto-crop to square
- After file selection, draw the image onto an HTML5 Canvas
- Calculate the largest centered square crop (min of width/height)
- Export as 512x512 JPEG blob at 0.9 quality
- Upload the cropped blob instead of the raw file
- No external library needed — pure Canvas API

### 3. `src/components/ui/glass-card.tsx` — No changes needed (already supports glow)

## Technical Details
- Auto-crop uses `createImageBitmap` or `Image()` + canvas `drawImage(img, sx, sy, sSize, sSize, 0, 0, 512, 512)`
- Tree connector lines use `relative`/`absolute` positioning with `before`/`after` pseudo-elements via Tailwind arbitrary values
- Stagger animation: parent `motion.div` with `staggerChildren: 0.05`, each child as `motion.div` with `initial={{ opacity: 0, x: -12 }}` 

## Files Modified
- **`src/pages/TeamHierarchy.tsx`** — Full visual redesign with effects
- **`src/components/dashboard/AvatarUpload.tsx`** — Add canvas auto-crop before upload

