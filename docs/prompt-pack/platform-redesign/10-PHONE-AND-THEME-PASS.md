# 10 · Phone and theme pass across everything

Paste after `00-MASTER.md`, after areas 01–09 have merged. Branch `redesign/phone-theme-pass`.

## Goal

Sam runs the business from his phone. After the areas land over several days, walk every route once
more at 390px, dark and light, and fix everything that drifted: a wrapped header, a clipped pill, a
sideways scroll, a 12px label, a light-theme contrast miss, a sticky bar that hides a save button.

## Read first

- `00-MASTER.md` section 3 (type, size, colour) and section 7 (verify).
- `ROUTE_BOARD.md`: every route marked `NEW`; `REDIRECT` rows are skipped.
- `src/index.css`: the theme tokens, the `@media (max-width: 640px)` block (the audit of the header found
  an `!important` rule there once undoing a compaction; read that block in full), the reduced-motion block,
  `safe-area-bottom`.
- `scripts/check-theme-literals.mjs` and `scripts/data/theme-literals-baseline.txt` (the ratchet of
  hard-coded theme literals; it may only fall), `check:hex-in-jsx-style`, `check:control-font`.

## Scope

Any page or component file, for layout, spacing, type size and theme fixes only. No behaviour changes, no
copy changes beyond fixing a truncation, no data changes. If a fix needs behaviour, write it up for the
owning area instead.

## Required work

1. **The matrix.** Extend the harness so one script renders every `NEW` route for every role that sees it,
   at 390×844 and 1440×900, dark and light, typical state. Save under one folder, named
   `<route>__<role>__<width>__<theme>.png`. Open every one.
2. **Phone checks, per screenshot.** No horizontal scroll (`document.documentElement.scrollWidth <= 390`,
   assert it in the script). Header one or two lines, never three. Primary action visible without
   scrolling, or in a sticky bottom bar above the phone nav (the nav is 64px plus safe area; nothing may
   sit under it). Every tap target 44px (measure the smallest button's bounding box in the script and print
   any below 44). Smallest text 13px except the five-slot nav labels (12px). Pills and chips wrap, never
   clip. Tables that do not fit become cards (the worklist's rule) or scroll inside their own container
   with the name column pinned.
3. **Theme checks.** In light, every muted text passes 4.5:1 on its background; every border is visible;
   no element relies on a dark-only token. In dark, no pure white blocks, no light-only shadows. Fix with
   tokens only; a literal hex or a theme-specific class pair is a last resort and must lower, not raise,
   the theme-literals baseline.
4. **Motion.** Nothing loops. Transitions 120–200ms. `prefers-reduced-motion` honoured
   (`check:reduced-motion-config`).
5. **Record.** A table in the PR: route, role, width, theme, what was wrong, the fix, the file:line.

## Verification

- The matrix script prints zero violations (scroll width, tap targets, text size).
- `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Council, with the First-timer and Engineer lenses weighted; the Owner lens confirms no number moved.

## Done means

- [ ] Every `NEW` route has its four phone/desktop × dark/light screenshots in the PR folder.
- [ ] Zero violations from the matrix script.
- [ ] Theme-literals baseline equal or lower.
- [ ] Shipped-log entry; `SHIPPED_TOTAL` matches.
