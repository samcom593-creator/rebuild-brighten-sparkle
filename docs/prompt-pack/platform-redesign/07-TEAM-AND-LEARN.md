# 07 · Team and Learn: Leaderboard, My Team, Contracting review, Field Course, Training Home, Call Lab

Paste after `00-MASTER.md`. Branch `redesign/team-learn`. Worktree `../rbs-team-learn`.

## Goal

Standing and skill. The pages a new hire opens in the first month must be the plainest in the app: where do
I rank, who is on my team and what are they doing, which lesson is next. Training currently lives under two
path families and the roster pages carry the most unnamed controls in the repo.

## Read first

- Run analysis **H4 (visibility and permission map)** for these routes before touching My Team.
- Pages: `src/pages/Leaderboard.tsx` (`/dashboard/leaderboard`), `src/pages/DashboardCRM.tsx`
  (`/dashboard/team`, "My Team", including `?view=contracting`, the Contracting review VAs reach),
  `src/pages/CourseCatalog.tsx` (`/dashboard/training/sales-course`, "Field Course"),
  `src/pages/TrainingHub.tsx` (`/dashboard/training/library`, "Training Home"),
  `src/pages/TrainingHubCourse.tsx` (course detail), `src/pages/CallLab.tsx` (`/dashboard/call-lab`), and the
  recruiting-side duplicates under `/dashboard/recruiting/training/*` (`ApexTrainingEntry.tsx`,
  `CourseProgress.tsx`, `CourseContent.tsx`, `AnnuityTraining.tsx`): decide with `ROUTE_BOARD.md` which path
  is canonical and redirect the other (query string preserved, `LegacyWorkspaceRedirect`).
- `docs/audits/apex-os-redesign-2026-10-05/08-scripts-training-onboarding-email.md` (training surfaces,
  the receipt rule: completion needs a durable journey-step receipt, never inferred from an application
  status), `docs/training-system-map.md`, `docs/skool-course-blueprint.md`,
  `docs/prompt-pack/METRICS_AND_LEADERBOARDS.md` (leaderboard windows and sources).
- Guards: `check:roster-segment-placeholders`, `check:agent-name-fallback` (19 placeholder fallbacks,
  may only fall), `check:control-labels` (the roster pages are the top offenders), `check:metric-truth`.

## Scope

The pages above, components under `src/components/team/**`, `src/components/training/**`, pure helpers,
tests, `src/App.tsx` only for the training redirect, `ROUTE_BOARD.md`, the shipped log. No data changes;
training completion stays on the journey-step receipts.

## Guardrails

- Leaderboard windows: day, week (Monday), month, Chicago; `deals.posted_at`; the same helper Home and
  Numbers use, so the three agree (tested).
- Hierarchy: agent sees self, a leader sees the authorised downline, admin sees the agency. The browser
  never widens a read.
- Contracting review is read-only for VAs; writes stay with the roles that have them today.
- A lesson is complete only when its receipt exists. Progress bars read receipts, never application status.
- Departed agents (KJ Vaughn's record included) never appear on a roster, a leaderboard or a team tree
  beyond historical attribution labelled as such.

## Required work

1. **Leaderboard.** Header, a window segmented control (Today · Week · Month) in `viewControls`, three
   tiles (your rank, your ALP, gap to next), then the list: rank · name · ALP at 16px, your row pinned.
   Agency and team scopes behind one Filters. Recognition (records, bounties) in a fold.
2. **My Team.** Tiles: Active, Writing this week, Not selling 14+ days, In onboarding. Rows: name · role ·
   last deal · status pill. Detail drawer: the person's numbers, their hires, contact actions, a fold for
   access and status (role changes stay a two-step confirm). The hierarchy tree becomes a view behind More,
   drawn with indentation and plain words, collapsible per leg, never a diagram that needs a wide screen.
   Contracting review (`?view=contracting`) keeps its URL and its read-only rule; same row contract.
3. **Field Course and Training Home.** One path: Training Home lists courses as large cards with a
   progress line and one "Continue" gold button on the course in progress; Field Course is one course page
   with its lessons as rows (done · current · locked), the current one expanded with its video and one
   "Mark complete" that writes the receipt. Call Lab is reached from Training Home as a card.
4. **Redirect the duplicate training paths** to the canonical ones; update the breadcrumb map and
   `check:sidebar-routes` inputs; keep the query string.
4b. **The Team long tail** (`ROUTE_BOARD.md` group 6): `ManagerNextStepBoard` (`/dashboard/team/next-step`),
   `AgentDetail` (`/dashboard/agents/:id`), `ManagerDashboard` (`/dashboard/admin/manager`),
   `ProducerReactivation`, `InactiveAgents`, `TransferRequests`, `Announcements` (`/dashboard/community`),
   `Challenges`, `AwardsGallery`, `HallOfFame`, `Rewards`, `MyPlaques`, `BoardLive` (`/board`), `MyStrikes`,
   `TeamChat` (deprecated). `AgentDetail` becomes My Team's detail drawer (route kept for deep links).
   Next-step board, Reactivation and Inactive agents become My Team tiles and lists ("Not selling 14+
   days", "Went quiet", "Stalled") driven by one tested helper, then redirect. Recognition (Rewards, Plaques,
   Hall of fame, Awards, Challenges, Announcements) becomes one "Recognition" page reached from the
   Leaderboard's fold, each former page a section, or redirects to it. `BoardLive` stays (it is a
   screenshot surface) and meets the type floor. `TeamChat` redirects to Support desk or is removed with a
   note; its header already calls it deprecated. `TransferRequests` and `MyStrikes` meet the contract where
   they are.
4c. **The Learn long tail** (group 5): `CallLabLive`, `CallLabReport`, `TrainingHubCourse`,
   `ApexCareerToolkit` (`/dashboard/training`), `CourseProgress`, `CourseContent`, `AnnuityTraining`,
   `Scripts`, `AgentHandbook`. The course player and the Call Lab live and report pages meet the contract
   (one action, big type, progress in words). Course progress and content become the manager's view of
   Training Home behind Filters ("Show: my team's progress"). Scripts becomes a fold of the Call Lab and of
   the person panel's Call button (area 03 wires the panel). Annuity training is a course in the library.
   The handbook is a card in Training Home. The toolkit's four-stage path (licensing → certification →
   launch → first sale) becomes the progress line on Training Home for everyone, reading the same journey
   receipts.
5. **Measure.** Unnamed controls before/after per page (the ratchet must fall), taps to "Continue"
   training, taps to call a team member.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, as agent, manager, recruiter and VA: each page empty
  and full, the tree view, the contracting view, a course at 0%, 40% and 100%.
- Council passes; the Owner lens checks Leaderboard against Home and Numbers for the same window.

## Done means

- [ ] Leaderboard, Home and Numbers agree for the same window (tested).
- [ ] My Team meets the contract; the tree is a view, not the page; the control-labels ratchet fell.
- [ ] One training path; the other redirects with its query string; progress reads receipts only.
- [ ] Before→after table, screenshots, shipped-log entry, `SHIPPED_TOTAL` matches.

## Acceptance output

1. Which training path is canonical and why.  2. Files changed.  3. Verification performed.
4. Council verdict.  5. Screenshots.  6. Permission mismatches H4 found that need a server change.
