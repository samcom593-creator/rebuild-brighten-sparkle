# Website clarity overhaul: implementation receipt (2026-10-09)

Live: https://apex-financial.org (My Team at /dashboard/team, Launch Board at /dashboard/launch-board)

## Shipped
- `fb2e7809` My Team: Priority 1 first, one summary strip, one view switch, one toolbar, working roster plus Production view, one URL-held person drawer, failed reads shown as their own state.
- `afbd5da4` Launch Board: Needs finishing, Film next (three picks, filters, edit, dismiss with Undo, own idea), tickable filming pack, Remake a winner from measured results. Migration `20261009160000` (applied live and recorded).
- Shared: PageHeader no longer emits an unkeyed-list warning; a div-in-p on Home fixed.

## Timing rule (My Team)
Not activated. `clock_basis` is `unset`, so nobody is shown overdue and the page says why. Proposed thresholds are configured: Aflac and Ethos due soon on day 3, red from day 4; first contract and AgentLink due soon on day 4, red from day 5. An admin confirms the clock start on /dashboard/team.

## Moved, merged, removed
- Roster: 13-column table (1,300px minimum) replaced by a working view and a Production view; cards below xl.
- Expanded-row checklist and the follow-up dialog: merged into one detail drawer.
- Contracting call list: now a view beside Roster, no longer a panel above everything. Roster health, engagement and brand leads: folded at the bottom.
- Production tiles: one flat strip, same definitions.
- Header tiles on the Launch Board: hidden below tablet width.

## Verification
- Unit and component tests: about 180 new across My Team and the Launch Board. Mutation proofs: 9 on My Team and 16 on the Launch Board, each turning a test red (the Launch Board run found one gap, now closed).
- Database: contracting 33/33 (with a 1,200-person case), content picks 19/19, both rolled back.
- Live API check as a real admin: 12/12 on synthetic rows, deleted afterwards; the login it created was ended.
- Repo gate (`verify:core`) green on each commit; CI green on each commit.
- Rendered checks at 390, 820 and 1500 px, light and dark: no page-level sideways overflow on 15 workspaces.

## Limits
- A rendered check of every authenticated page was not done; 15 main workspaces were swept for overflow, console errors and failed requests, and the two redesigned pages were inspected by eye.
- The clock-start question for My Team is still unanswered, so no overdue flag is live.
- Not verified: ticking a real contracting milestone or recording a real contact on production (deliberately not done; covered by rolled-back database tests and fakes).
- `src/tests/pages/recoveryCommandContract.test.ts` belongs to another worker's unfinished Recovery Command route and fails until they wire it.
