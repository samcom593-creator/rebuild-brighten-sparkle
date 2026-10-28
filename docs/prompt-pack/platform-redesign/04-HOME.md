# 04 · Home, per role

Paste after `00-MASTER.md`. Branch `redesign/home`. Worktree `../rbs-home`.

## Goal

The first screen after login tells each person the one thing to do today and shows the three or four
numbers that matter to them, verified, each opening its list. Everything else the home used to show stays
one tap away. Today Sam's Home stacks eleven sections; the agent home is a 5,000-line file; a section goes
blank while loading. After this area every home is one screen on a phone.

## Read first

- Run analysis **H5 (Home per role)** from `12-ANALYSIS-SESSIONS.md` first and save it: it ranks every
  signal per role and names the one next action and the numbers above the fold, with their source RPC and
  freshness.
- `docs/audits/apex-os-redesign-2026-10-05/02-home-dashboards.md`: the render order of Sam's Home with
  every data source, the stale dispatch comment, the sections that return `null` while loading
  (`ImoByAgency`), the client-side `loadDashboardSnapshot` with fourteen table reads.
- `docs/audits/apex-os-redesign-2026-10-05/03-headcount-production-data.md` §6 (the definitions table) and
  `docs/metric-registry.md`: which numbers are registered and must come from their RPC.
- Code: `src/pages/Dashboard.tsx` (dispatch; the `ExecutiveDashboard` in-file component for admin preview),
  `src/components/dashboard/AgentCloudHome.tsx` (Sam), `ScopedProductionScoreboard.tsx`,
  `OperationsCommandCenter.tsx`, `ImoByAgency.tsx`, `ProducerPulse.tsx`, `RecordsAndBounties.tsx`,
  `AyroProductionPanel.tsx`, `ReferralLinkCard.tsx` / `MyReferralLinkCard.tsx`, `JoinYourTeam.tsx`,
  `TrainingNextStep.tsx`, `WhatShippedTodayBanner.tsx`; `src/pages/AgentCommandDashboard.tsx` (agent),
  `AgencyOwnerHome.tsx`, `RecruiterHome.tsx`, `VaOpsCommandCenter.tsx`, the manager branch
  (`ManagerCommandView`), `MyDay.tsx` (`/dashboard/my-day`, Sam only), `Numbers.tsx` (`/numbers`, the
  agent's phone tab).
- Tests: `src/tests/hooks/productionRealtimeFeedbackLoop.test.ts` (the MP-431/MP-436 invalidation guards),
  every test under `src/tests/` that imports a home component, `check:realtime-invalidate-coalesce`,
  `check:realtime-feedback-loop`, `check:metric-truth`, `check:business-day-bounds`, `check:live-polling`.

## Scope

The files above and their children under `src/components/dashboard/**`, `src/pages/Dashboard.tsx`
(dispatch untouched after area 01; the branch bodies may change), new pure helpers under `src/lib/home/`,
tests, `ROUTE_BOARD.md`, the shipped log. No RPC changes: every number comes from an RPC or view the home
already calls. If H5 names a number no RPC gives, it waits for a follow-up and the tile reads "—" with the
reason, never a client-side recomputation.

## Guardrails

- Registered metrics are never recomputed in the page (`docs/metric-registry.md`); production windows use
  the Chicago helpers; recruiting "today" is the Phoenix day. `deals.posted_at` for money; `daily_production`
  never powers a tile.
- Realtime invalidations keep the feedback-loop guards. Do not add polling.
- Role homes keep their audience: a manager never sees the IMO totals an admin sees; an agent never sees
  another agent's book; VAs see their queues, not production; applicants see area 02's card.
- `ExecutiveDashboard`'s fourteen client-side reads are a defect, not a pattern: the preview home reads the
  same RPCs as Sam's Home or is replaced by Sam's Home under preview.
- Loading, unavailable, no access, true zero and stale read differently on every tile. A section never
  returns `null` because it is loading.

## Required work

1. **One shape for every home.** Header: a greeting by first name, the date, and the one gold action from
   H5 ("Start calling", "Post a deal", "Review the queue"). Then the scoreboard (3–4 tiles from H5, each a
   button to its list, "—" when unverified). Then **one** "Today" list: the people or items to act on,
   capped at eight, with "See all" to the owning page. Then one closed fold per former section ("Production
   by agency", "Records and bounties", "Trend and policy status", "Who is not selling"), header showing the
   current headline value. Nothing else above the fold.
2. **Sam's Home.** The hiring-funnel strip (area 02's helper; area 03's definitions) sits beside the
   production tiles: Applied, Reached, Booked, Showed, Contracted, First deal for the chosen window, each
   opening the Call list filtered to those people. Keep `ScopedProductionScoreboard`'s server aggregates;
   move IMO by agency, producer pulse, Ayro, records and bounties into folds; fix `ImoByAgency` to show a
   skeleton and an error line instead of nothing. The referral link card becomes one row with Copy.
3. **Agent home.** Split `AgentCommandDashboard.tsx` into the shape above with the agent's own numbers
   (today, week, month ALP from the production helpers; next client to call from area 06's rule when it
   exists, else the pipeline's due items). The 5,000 lines become components under
   `src/components/dashboard/agent/`, each under 300 lines, behaviour unchanged where it is not redesigned.
4. **Manager and agency owner homes.** Team numbers (direct team, whole downline) plus the same Today
   list for the team. Links into My Team and the Call list carry the filter.
5. **Recruiter and VA homes.** The Call list's scoreboard and its first four people, nothing about money.
   The VA ops centre keeps its queues and the Google Voice recovery action (`docs/recruiting-workspace.md`).
6. **My Day (`/dashboard/my-day`) and Numbers (`/numbers`).** Same contract. Numbers is the agent's phone
   tab: four tiles and one list, tested against the leaderboard for the same window (they must agree).
7. **The shipped banner.** Keep `WhatShippedTodayBanner`; it is how Sam sees what changed. One line,
   expandable.
8. **Measure.** Per role: sections above the fold before/after, number of requests on first paint
   (count the RPC calls in the harness mock), time to first number.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, for every role, in empty and full data, plus one
  with a failed RPC (a tile must read "—" with its reason).
- Council passes; the Owner lens checks three tiles against their lists and against the leaderboard.

## Done means

- [ ] Every role's home fits one phone screen above the fold: greeting, one gold action, ≤4 tiles, one list.
- [ ] Every former section is reachable in one tap (fold) and listed in the before→after table.
- [ ] No tile recomputes a registered metric; no section is blank while loading.
- [ ] `AgentCommandDashboard.tsx` is split; no component over 300 lines.
- [ ] Numbers agrees with Leaderboard for the same window (tested).
- [ ] H5 answer saved; shipped-log entry; `SHIPPED_TOTAL` matches.

## Acceptance output

1. Per-role table: next action, tiles, their sources.  2. Files changed.  3. Verification performed.
4. Council verdict.  5. Screenshots.  6. Numbers H5 wanted that no RPC provides yet.
