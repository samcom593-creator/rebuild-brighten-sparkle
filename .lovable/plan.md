
Goal
- Fix the “navigation center” freeze where clicks stop working and the only recovery is a full page reload.
- Make navigation and dashboard/leaderboard interactions resilient (no UI lockups), while keeping refresh/realtime fast.

What I found (from code review already loaded in this chat)
- The “Command Center” page (`src/pages/DashboardCommandCenter.tsx`) is very heavy:
  - It fetches all agents, then fetches all `daily_production` rows for a date range, then aggregates in JS.
  - It also creates its own realtime channel (`command-center-live`) that refetches (debounced 1000ms).
  - It renders many large sub-panels and long lists.
- You already have a proven “singleton realtime channel + debounced update” pattern (`src/hooks/useProductionRealtime.ts`), but Command Center does not use it.
- There are console warnings about refs (ApplicationToast / AnimatedCounter). These are not the freeze root-cause, but they are indicators of component patterns that can cause extra work and unstable UI behavior when combined with heavy pages.

Likely root cause(s)
- Main-thread saturation: Command Center does large client-side aggregation + renders large lists + multiple heavy panels. When realtime triggers or state updates hit, the UI thread can become unresponsive long enough that clicks “don’t work”.
- Duplicate realtime subscriptions / refetch storms: having multiple separate channels across pages (and possibly multiple mounted-heavy pages/components) can lead to frequent re-renders and expensive query refetches.
- “Invisible overlay” edge case: a stuck portal/overlay (Radix menus/dialogs/sheets) can capture pointer events after navigation if not cleaned up correctly. This feels like “the site is frozen” but is actually “clicks are blocked”.

Implementation plan (fix + harden)
Phase 0 — Reproduce and lock down the exact failure mode
1) Add a lightweight “Freeze/Long Task” diagnostic (development + optionally production-safe)
   - Track:
     - route changes (start/end times)
     - long tasks (PerformanceObserver for “longtask”)
     - repeated rapid state updates (basic counters for refetch triggers)
   - When the app detects UI thread stalls (e.g., >2s long tasks or navigation that doesn’t complete in N seconds), show a non-blocking banner with:
     - “App is busy, still loading…”
     - a “Recover” button (soft recovery first, full reload only if needed)
   - This gives us proof of whether the problem is CPU lockup vs. click-blocking overlay.

Phase 1 — Stop realtime/refetch storms (highest impact)
2) Centralize `daily_production` realtime to a single shared channel
   - Replace the per-page channel in `DashboardCommandCenter.tsx` with the existing singleton hook pattern (`useProductionRealtime`).
   - Ensure other production-driven dashboards/leaderboards also use the singleton hook instead of creating their own channels.
   - Outcome: only one websocket subscription for `daily_production` across the entire app, with a single debounced “refetch requested” signal.

3) Debounce and dedupe refetch triggers more aggressively for heavy pages
   - Keep global debounce at ~300ms–1000ms depending on page weight.
   - Add “in-flight” protection: if a refetch is already running, don’t start another (or queue one trailing refetch).
   - Outcome: no piling up of refetch work that blocks the UI.

Phase 2 — Remove the biggest CPU bottleneck (server-side aggregation)
4) Stop downloading and aggregating all raw `daily_production` rows in the browser for Command Center
   - Move aggregation to the backend (database-side) so the client fetches pre-aggregated per-agent totals:
     - total_alp, total_deals, total_presentations, last_activity_date for the date range.
   - Implementation options:
     A) Database view / SQL function (preferred for performance and simplicity)
     B) Backend function that queries and aggregates server-side
   - Then Command Center does:
     - Query agents (light fields)
     - Query aggregated stats (already grouped per agent)
     - Merge maps client-side (cheap)
   - Outcome: dramatically smaller payloads and much less JS work, especially for “month” and “custom” ranges.

Phase 3 — Prevent “clicks don’t work” overlays
5) Global overlay cleanup on route change
   - On every route change:
     - close mobile sidebar overlay
     - ensure any “sheet/dialog/menu” portals are closed (where possible via state)
     - as a last resort (only if we detect click-blocking): remove stray `pointer-events: none/auto` locks on the body/html that were left behind by an interrupted overlay animation.
   - Outcome: navigation can’t get “stuck behind” an invisible overlay.

6) Make sidebar navigation more resilient
   - Add a small “navigation lock” so rapid repeated clicks don’t queue multiple route transitions.
   - Add immediate visual feedback on click (active state + subtle loading indicator) so it never feels like the click didn’t register.

Phase 4 — Clean up noisy warnings that can hide real issues
7) Fix ref warnings for:
   - `src/components/landing/ApplicationToast.tsx`
   - `src/components/ui/animated-counter.tsx` (used in CareerPathwaySection)
   - Make them `forwardRef` compatible or remove the pattern that causes ref injection.
   - Outcome: cleaner console so real errors stand out; reduces risk of ref-related edge behavior in animation wrappers.

Phase 5 — Verification: “every button works” regression pass
8) End-to-end test checklist (manual, targeted)
   - Desktop + Mobile
   - Key routes:
     - Dashboard
     - Command Center (/dashboard/command)
     - Applicants/Pipeline
     - CRM
     - Course Progress
     - Agent Portal
   - Actions:
     - Switch routes rapidly via sidebar
     - Open/close dropdown menus, dialogs, sheets
     - Change date ranges and filters in Command Center
     - Trigger realtime updates (log a production entry) and verify UI updates without stutter/freeze
   - Add a temporary “QA mode” toggle to show internal timing (optional) while we confirm the fix.

Files/components expected to change (implementation)
- src/pages/DashboardCommandCenter.tsx
  - remove local realtime channel, use shared realtime hook
  - refactor data fetching to use aggregated stats (stop pulling all daily_production rows)
  - add in-flight refetch guard
- src/hooks/useProductionRealtime.ts (may extend to support multi-table or configurable debounce)
- src/components/layout/SidebarLayout.tsx and/or src/components/layout/GlobalSidebar.tsx
  - route-change overlay cleanup + navigation resilience
- src/components/landing/ApplicationToast.tsx
- src/components/ui/animated-counter.tsx
- (Backend/database) add aggregation helper (view or function) to return per-agent stats per date range

Risk management / rollout
- Implement in stages: Phase 1 + Phase 2 should eliminate freezes even if overlay issues remain.
- Keep diagnostics for one iteration; once stable, we can keep them minimal or behind a dev flag.

What I will need from you during verification (after implementation)
- Confirm whether the freeze happens mostly on:
  - Desktop or mobile
  - Command Center specifically, or any dashboard page
  - When filters/date range are changed, or just when clicking sidebar navigation

Success criteria
- You can click between navigation items repeatedly without a lockup.
- Command Center loads and filters without causing the whole app to become unresponsive.
- Realtime updates do not cause stutters or “freeze until reload”.
