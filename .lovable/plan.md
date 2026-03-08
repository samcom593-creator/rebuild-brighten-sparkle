

# Plan: Platform Polish Round 6 — Final Sound & Animation Sweep

## Issues Found

### 1. AgentPortal.tsx — Heavy entrance animations on data dashboard (168 motion usages)
Lines 406, 428, 445, 518, 544, 628, 641, 654, 666+: Standalone `motion.div`/`motion.section` wrappers with `initial={{ opacity: 0, y: 20 }}` on data sections (agent info bar, tab nav, production forecast, history chart, income goals, team goals, etc.). These cause staggered rendering lag. The `AnimatePresence` blocks for tab switching (lines 554, 572, 604) are interactive and should stay.

### 2. DeletedLeadsVault.tsx — Entrance animation + no sound effects
Line 187: Header wrapped in `motion.div` with entrance animation. Also has 5 toast calls with zero sound feedback (restore, permanent delete, errors).

### 3. SeminarAdmin.tsx — Dead `motion` import
Line 3: Imports `motion` but no `motion.*` elements exist in the JSX. Dead import.

### 4. AdminCalendar.tsx — No sound effects
Has 15+ toast calls for block add/update/delete, scan import, export — zero sound feedback. The `motion` usage here is legitimate (DraggableBlock for drag-and-drop, conditional recurring banner reveal).

### 5. LogNumbers.tsx — No sound effects
Has toast calls for search, agent creation, number submission — zero sound feedback. The `motion` usage is legitimate (step wizard transitions via `AnimatePresence`).

### 6. AgentPortal.tsx — No sound effects
Has toast calls for clipboard copy — no sound feedback.

## Changes

### 1. Remove entrance animations from AgentPortal.tsx
Replace ~12 standalone `motion.div`/`motion.section` entrance wrappers with plain `div`/`section`. Keep all `AnimatePresence` tab-switching blocks (lines 554, 572, 604) — those are interactive.

### 2. Fix DeletedLeadsVault.tsx
- Replace header `motion.div` (line 187) with plain `div`.
- Remove `motion` import.
- Add `useSoundEffects` + `playSound("success")` on restore/delete, `playSound("error")` on failures.

### 3. Remove dead import from SeminarAdmin.tsx
- Remove `import { motion } from "framer-motion"` on line 3.
- Add `useSoundEffects` + sound effects on add registrant, toggle attended.

### 4. Add sound effects to AdminCalendar.tsx
- Add `useSoundEffects` import and `playSound` calls alongside all toast calls (block add/update/delete/export/scan).

### 5. Add sound effects to LogNumbers.tsx
- Add `useSoundEffects` import and `playSound` calls for search results, agent creation, number submission (celebrate on submission success).

### 6. Add sound effects to AgentPortal.tsx
- Add `useSoundEffects` import and `playSound("click")` on clipboard copies.

## Scope
- 6 files edited
- No database changes
- No new dependencies
- Completes the sound effects coverage across all pages with user interactions

