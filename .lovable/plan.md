

# CRM Visual Refresh -- Kill the Dark Space, Add Life

## Problem
The CRM has too much dark empty space, flat cards, and monotone styling. The quick stats bar is plain boxes, section headers are barely styled, empty states are bare italic text, and the expanded rows use a dull `bg-muted/30` background. Overall it feels like a spreadsheet, not a premium management tool.

## Changes

### 1. Quick Stats Bar -- Gradient glass cards with accent colors
Replace the flat `border bg-card` boxes with gradient-backed glass cards, each with its own accent glow and a subtle animated pulse on the count. Add a progress ring or mini bar showing the proportion of total.

### 2. Section Headers -- Richer backgrounds with gradient accents
Replace the pale `bg-primary/5` headers with stronger gradient fills (e.g., `bg-gradient-to-r from-primary/10 via-primary/5 to-transparent`). Add a colored left stripe glow effect and a subtle shimmer on the count badge.

### 3. Agent Rows -- Subtle alternating tints + hover glow
Add alternating row tinting (`even:bg-muted/20`), a left-border accent matching the section color on hover, and a smooth scale micro-animation on hover. Make stale agents more visually distinct with a soft red left border glow.

### 4. Empty States -- Illustrated empty state
Replace bare italic text with a centered icon + message + subtle call to action styling (e.g., a Users icon with "No agents in this stage yet" and a soft gradient background).

### 5. Expanded Row -- Card-in-card feel with accent border
Replace `bg-muted/30` with a proper card look: `bg-card/80 backdrop-blur` with a left accent border matching the section, rounded inner corners, and a subtle shadow lift. Add divider lines between the two columns.

### 6. Page Header -- Background glow + subtitle polish
Add the `BackgroundGlow` component behind the header area for the premium radial gradient effect. Upgrade the subtitle with animated counters for agent/stale counts.

### 7. Filter Bar -- Glass styling
Wrap filters in a glass container with rounded corners and a soft border, so they feel integrated rather than floating loose.

### 8. Avatar improvements
Add a subtle ring/border around avatars matching the section accent color. Add a tiny online-status-style dot for agents who logged numbers today.

---

## Technical Details

**File: `src/pages/DashboardCRM.tsx`**

All changes are contained in this single file:

- Import `BackgroundGlow` from `@/components/ui/BackgroundGlow`
- Quick stats: change from `px-3 py-2 rounded-lg border bg-card` to gradient glass cards with colored top borders and slight shadows
- Section headers: richer gradient backgrounds, glow stripe, badge shimmer
- Table rows: add `even:bg-muted/15` alternating, hover left-border accent, stale agent red-left-glow
- Empty states: icon + styled message in a gradient box
- Expanded row wrapper: `bg-card/80 backdrop-blur-sm border-l-2` with section accent color
- Page container: add `relative` + `<BackgroundGlow accent="teal" intensity="subtle" />` at top
- Filter bar: wrap in `glass rounded-xl p-3` container

No new files, no new dependencies, no database changes.

