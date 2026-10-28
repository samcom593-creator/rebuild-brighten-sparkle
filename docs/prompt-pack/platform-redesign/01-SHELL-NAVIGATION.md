# 01 · Shell: sidebar, phone nav, top bar, page headers, role homes dispatch

Paste after `00-MASTER.md`. Branch `redesign/shell`. Worktree `../rbs-shell`.

## Goal

One calm frame around every screen: a sidebar that names things the way people say them, a phone nav
that lands on the daily job for each role, a top bar that gets out of the way, and one page header the
whole app shares. After this area, no later area needs to touch the frame.

## Read first

- `docs/audits/apex-os-redesign-2026-10-05/01-nav-routes-shell.md` in full: it maps every shell file with
  line numbers and lists the defects (D-01 …). Several are fixed already (Grow renames in PR #46, MP-332
  mode allowlists, the applicant rail); re-check each one against the code before touching it.
- `src/components/layout/agentCloudNavigation.ts` (the manifest: groups, `modes`, `grant`, `matchParams`,
  `ROUTE_CRUMBS`, active rules, `filterAgentCloudNav`), `GlobalSidebar.tsx`, `SidebarLayout.tsx`,
  `TopBar.tsx`, `MobileBottomNav.tsx` (one five-slot ladder per mode), `CommandPalette.tsx`,
  `CommandHintFab.tsx`, `AuthenticatedShell.tsx`, `src/components/ui/page-header.tsx` (v6 slots:
  `primaryAction`, `secondaryActions`, `viewControls`; the legacy `actions` bag still ranks by props).
- `src/pages/Dashboard.tsx` lines 960–1140: the role-home ladder (VA ops → recruiter → real admin →
  agent → agency owner → manager → previewed admin).
- Tests that pin the shell: `src/tests/components/GlobalSidebar.test.tsx`,
  `src/tests/lib/agentCloudNavigationGuards.test.ts`, `MobileBottomNav` tests, `AgentCloudParity.test.tsx`,
  anything under `src/tests/` that imports `agentCloudNavigation`. Guards: `check:sidebar-routes`,
  `check:internal-nav-hrefs`, `check:orphan-pages`, `check:dead-internal-links`, `check:page-header-compact`,
  `check:control-labels`, `check:icon-button-labels`.

## Scope (files you may change)

`src/components/layout/**`, `src/components/command/**`, `src/components/ui/page-header.tsx` (only if a
shared change is needed for the contract), `src/pages/Dashboard.tsx` (dispatch only, not the homes), the
tests above, `docs/prompt-pack/platform-redesign/ROUTE_BOARD.md` (Pattern column), `src/data/shipped-data.ts`
and the banner count. Routes, guards and hrefs in `src/App.tsx` do not change in this area.

## Guardrails

- Routes, role gates and hrefs stay as they are. Labels, order, grouping and the phone ladders may change;
  a changed label changes the breadcrumb and the favourites label with it (they read the manifest).
- `modes` and `grant` semantics are MP-332's contract: a Pure Recruiter sees recruiting only; VAs see
  the queues they work; `sold_calls` grant items show only to holders and admins. Do not widen.
- The applicant rail (`APPLICANT_NAV`, `isApplicantViewer`) stays four links.
- KJ Vaughn's record must not appear in any roster, favourites seed or quick action.

## Required work

1. **Sidebar words and order.** Keep the six groups (Home, Sell, Grow, My Business, Learn, Team, Owner,
   Settings). Rename anything a first-timer would not understand, in the manifest only, and record each
   rename in the PR table (old → new → why). Candidates to check: "My Pipeline" vs the recruiting lists
   (the audit's "two things called Pipeline" defect; PR #46 already renamed the recruiting ones to Call list
   and New hires), "Book Flips", "Easy Resells", "Sold Calls", "Nova Pro", "Producer Profile". A name is
   right when a 70-year-old agent reads it once and knows what is behind it.
2. **Phone ladders.** Each mode's five slots must be that mode's daily verbs, in order of use, and each
   must point at the canonical path the sidebar uses (the comment at the top of `MobileBottomNav.tsx` is the
   rule). Re-derive the ladders from the manifest where possible so the two cannot drift; where a ladder
   must differ, say why in a comment. Labels at 12px minimum (the contract says 13; the five-slot bar is the
   one place 12px is accepted, and only for the tab label; state this exception in the PR). Active state is
   the gold text plus the dot, never colour alone (the label is the word).
3. **Top bar.** One row: breadcrumb (plain words from the manifest), search, notifications, support,
   role preview (admin only). Nothing else. Remove any decoration, any second row, any control under 44px.
4. **Page header, one way.** Every route in `ROUTE_BOARD.md` that still passes a legacy `actions` bag
   migrates to the explicit slots (`primaryAction`, `secondaryActions`, `viewControls`). This is mechanical
   and large; do it as its own commit per nav group so a later area can revert one group. The header's
   measured height must not grow (`check:page-header-compact`). Where a page has no single primary action,
   pass `primaryAction={null}` on purpose and say so in a comment.
5. **Role homes dispatch.** `Dashboard.tsx` keeps one ladder, documented in one comment that matches the
   code (the audit found the comment stale). Each branch renders exactly one home component. Area 04
   redesigns the homes themselves; here you only make the dispatch legible and tested.
6. **Command palette.** The static route list must be derived from the manifest (same labels, same
   gates), not a second hand-typed list. Keep the entity search. Keep ⌘K.
7. **Loading and empty frames.** The shell's skeletons and the `NotFound` page follow the contract (plain
   words, one action, no decoration).
8. **Measure.** Before and after, per role: sidebar item count, phone ladder, top bar control count,
   header height at 390 and 1440. Put the table in the PR.

## Verification

- Focused tests for the shell files, then `npm test`; `npm run typecheck:count` ≤ baseline; `npm run build`;
  `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, for every role: the sidebar open and collapsed, the
  phone nav, one page with a long title and three secondary actions (to see "More (n)"), the applicant
  rail, the NotFound page.
- Council (`11-COUNCIL-REVIEW.md`) passes all four lenses.

## Done means

- [ ] Every sidebar label passes the first-timer lens; the rename table is in the PR.
- [ ] Every phone ladder points at canonical paths and the active tab, breadcrumb and favourites agree.
- [ ] No route passes a legacy `actions` bag; `check:page-header-compact` is green.
- [ ] The role-home ladder is one tested function with a comment that matches it.
- [ ] The command palette derives its routes from the manifest.
- [ ] `ROUTE_BOARD.md` Pattern column updated for every page whose header was migrated.
- [ ] Shipped-log entry added; `SHIPPED_TOTAL` matches.

## Acceptance output (in the PR body and the report to Sam)

1. Rename table (old → new → why).  2. Files changed.  3. Verification performed, with the guard roster.
4. Council verdict table.  5. Screenshot folder.  6. Anything left for a later area, and why.
