# AC-P3 — scoreboard truth states and KPI primitive

This is a shipped slice, not full P3 sign-off. MP-301 v2 already records the shell as shipped. Inspection found the current scoreboard discarded its cached totals whenever a subsequent refresh failed, and interpreted a successful null response as an unlinked producer profile.

Changes: extract the existing tile unchanged into `src/components/ui/kpi-stat.tsx`; use the existing `QueryState` primitive around scoreboard content and its commission footer; preserve successful cached data with its read timestamp and failed-refresh label; distinguish initial loading, initial error and null response; replace the unconditional Live badge with the actual request state. No database, calculation, hierarchy or data-source changes.

| Item | Verdict | Evidence |
|---|---|---|
| Loading does not show invented totals/profile diagnosis | PASS | scoreboardQueryStates.test.tsx; test fails against original source |
| Failed refresh retains $12,345 fixture and dated stale notice; Retry recovers | PASS | actual QueryClient refetch and retry, scoreboardQueryStates.test.tsx; original source fails |
| Null response is unavailable, not an unlinked-profile claim | PASS | scoreboardQueryStates.test.tsx; original source fails |
| First read error does not invent totals | PASS | scoreboardQueryStates.test.tsx; original source fails |
| Existing scoreboard and realtime tests | PASS | 14 tests across three files pass |
| Required `npx tsc --noEmit` | PASS | exit 0; root config has no source files, so this alone is not app type proof |
| Vite production build | PASS | npm run build exit 0 |
| Authenticated live role and viewport render matrix | UNPROVEN | Not run in this slice |
| Complete P3 primitive adoption and shell acceptance | UNPROVEN | QueueRow, DetailDrawer, ProgressStepper and full shell review remain open |

Regression proof: temporarily restored HEAD's scoreboard source, ran the new four-case suite, observed four failures / exit 1, restored the implementation. The old implementation loses the confirmed totals and never renders a stale timestamp on refresh failure. Final tests and guard outputs are saved in the local receipt directory referenced by the backlog ledger.

Existing unrelated changes in Sam's shared checkout were preserved. Work is isolated at `/tmp/apex-ac-p3`. AC-P3 remains `in_progress`; resume from this slice, do not repeat the extraction or change production calculations.
