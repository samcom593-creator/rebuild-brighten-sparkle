

# Plan: Fix Overlays, Sidebar Delay, and Overall Polish

## Issues Identified

1. **Table action buttons overlapping/bunching** — In the Pipeline expanded card view (lines 684-760 of `DashboardApplicants.tsx`), the actions row uses `flex-wrap` but contains many full-size `sm` buttons (Notes, Record, ResendLicensing, QuickEmail, QuickAssign, Instagram, Hired, Contracted, Terminate) that compete for horizontal space and overlap on medium screens.

2. **Sidebar navigation delay** — The mobile sidebar uses CSS `transition: "transform 200ms ease-out"` which is fine, but the `GlobalSidebar` imports `framer-motion` and uses `AnimatePresence` for the fullscreen toggle button. The desktop sidebar expand/collapse transition (`transition-all duration-200`) is smooth but the initial render of sidebar content (search, nav items with `useMemo`) can cause a visual stutter on slower devices.

3. **React deduplication missing** — `vite.config.ts` lacks `resolve.dedupe` for React, which can cause hook dispatcher issues and subtle rendering bugs.

4. **Excessive framer-motion on data pages** — Nearly every page wraps content sections in `motion.div` with `initial/animate` transitions, causing a visible delay ("flash") every time you navigate to a new tab. These staggered entrance animations (delay: 0.1, 0.2, 0.3, 0.4) compound into noticeable lag.

## Changes

### 1. Add React deduplication to Vite config (`vite.config.ts`)
- Add `resolve.dedupe: ["react", "react-dom", "react/jsx-runtime"]` to prevent duplicate React instances causing subtle UI bugs.

### 2. Remove staggered entrance animations from all data dashboards
Target files (all pages inside `AuthenticatedShell`):
- `src/pages/DashboardApplicants.tsx` — Remove `motion.div` wrappers with `initial/animate` around filter bar, table, and card sections. Replace with plain `div`.
- `src/pages/Dashboard.tsx` — Same treatment for stat cards and section wrappers.
- `src/pages/RecruiterDashboard.tsx` — Same.
- `src/pages/DashboardCRM.tsx` — Same for stat cards and table sections (keep the `AnimatePresence` for expand/collapse rows since that's interactive, not entrance).
- Other dashboard pages with the same pattern: `DashboardAgedLeads.tsx`, `DashboardCommandCenter.tsx`, `CallCenter.tsx`, `LeadCenter.tsx`, `GrowthDashboard.tsx`.

This eliminates the perceived "delay" when opening any dashboard tab — content renders instantly.

### 3. Fix expanded card actions overlay in Pipeline (`DashboardApplicants.tsx`)
- Lines 684-760 (expanded card actions row): Convert all action buttons to icon-only mode in the row, matching the compact table row pattern.
  - Notes → icon-only `StickyNote`
  - Record → icon-only `Mic`
  - Instagram → icon-only
  - Hired → icon-only `UserCheck`
  - Contracted → icon-only `FileCheck`
  - Terminate → icon-only `XCircle`
  - Keep `QuickEmailMenu` and `QuickAssignMenu` as `displayMode="icon"` (already set).
  - Keep `ResendLicensingButton` as-is (already icon-only `h-8 w-8`).
- Add `shrink-0` to all icon buttons to prevent compression.
- This eliminates text-label buttons competing for space in the actions row.

### 4. Reduce sidebar transition duration for snappier feel
- `SidebarLayout.tsx` line 88: Change mobile overlay `transition: "opacity 150ms"` → `"opacity 100ms"`.
- Line 99: Change mobile panel `transition: "transform 200ms"` → `"transform 120ms"`.
- `GlobalSidebar.tsx` line 267: Change `duration-200` → `duration-150` on desktop sidebar `transition-all`.
- Remove the `AnimatePresence`/`motion.div` for the fullscreen toggle button (lines 505-524) — replace with a simple CSS opacity/transform transition to avoid framer-motion overhead on the sidebar.

### 5. Ensure no overlay z-index conflicts across all dashboards
- Audit and normalize `z-index` on dropdown menus: `QuickAssignMenu` line 152 already uses `z-50`. Verify `QuickEmailMenu` dropdown content has `z-50` as well.
- `LicenseProgressSelector` dropdown content — add `z-50` if missing to prevent it rendering behind table rows.

## Scope
- ~10 page files for motion removal (mechanical find-replace of `motion.div` → `div` and removing `initial/animate/transition` props).
- 3 layout/component files for transition speed + z-index fixes.
- 1 config file for React deduplication.
- No database or backend changes.

