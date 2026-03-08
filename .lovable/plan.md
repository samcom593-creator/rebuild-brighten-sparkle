

# Plan: Platform Audit Round 4 — Final Polish

## Issues Found

### 1. `Numbers.tsx` — Dead `motion` import
Line 2 imports `motion` from framer-motion but it's never used (all `motion.div` elements were removed in prior audit). Dead import.

### 2. `CourseProgress.tsx` — `motion.tr` with staggered entrance animations
Lines 648-657: Table rows use `<motion.tr>` with `initial={{ opacity: 0, x: -10 }}` and staggered delays (`index * 0.02`). This violates the "no entrance animations on data pages" standard. It also wraps `motion.tr` inside `AnimatePresence`, which can cause HTML validation issues. Replace with standard `<TableRow>`.

### 3. `AgentPipeline.tsx` — Entrance animations on data page
Lines 234-238, 342-344, 409-411, 438-440, 468-470, 500-504: Multiple `motion.div` with `initial={{ opacity: 0, y: 20 }}` entrance animations cause staggered flicker. These are data-heavy views that should render instantly per the platform standard.

### 4. `TeamDirectory.tsx` — Entrance animations
Lines 265-268, 296-300, 410-412, 432-434: Staggered entrance animations on directory cards. Same standard applies.

### 5. `DashboardAccounts.tsx` — Verify motion usage
Imports `motion` (line 2). Need to check if used for entrance animations or interactive animations.

## Changes

### 1. Remove dead import (`src/pages/Numbers.tsx`)
- Remove `import { motion } from "framer-motion"` on line 2.

### 2. Replace `motion.tr` with `TableRow` (`src/pages/CourseProgress.tsx`)
- Remove `AnimatePresence` wrapper around table rows (line 648, 840).
- Replace `<motion.tr>` with `<TableRow>`, removing `initial`, `animate`, `exit`, `transition`, `layout` props.
- Remove `AnimatePresence` from imports if no longer used elsewhere.

### 3. Remove entrance animations (`src/pages/AgentPipeline.tsx`)
- Replace all `motion.div` with `initial/animate` entrance props with plain `div`.
- Keep `AnimatePresence` + `motion.div` only for conditional reveals (collapsible sections, line 536-539) which are interactive, not entrance.

### 4. Remove entrance animations (`src/pages/TeamDirectory.tsx`)
- Replace `motion.div` entrance wrappers with plain `div`. Remove `motion` import if unused after.

### 5. Clean up `DashboardAccounts.tsx`
- Audit `motion` usage and remove entrance animations, keep interactive ones.

## Scope
- 5 files edited
- No database changes
- No new dependencies
- Removes remaining entrance animation lag across all dashboard pages

