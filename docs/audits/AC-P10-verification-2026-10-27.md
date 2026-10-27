# AC-P10 — verification checkpoint, 2026-10-27

**Program verdict: UNPROVEN. Status: in_progress. Owner: codex.**

This is the inventory and verification-spine slice of P10, not a final rebuild
sign-off. Source baseline: `96c24010` from `origin/main`. The shared checkout had
unrelated tracked and untracked work; its required pull refused to rebase.
Verification ran in an isolated worktree, `/tmp/apex-ac-p10`, which successfully
completed `git pull --rebase origin main`. No other lane's changes are included.

## Re-measured inventory

`node scripts/ac-p10-inventory.mjs <catalog.json>` parses JSX with TypeScript,
uses tracked files for source inventories, and refuses an empty/failed DB
catalog. It does not turn source presence into functional proof.

| Surface | 2026-08-18 checklist | Measured now | Delta / definition |
|---|---:|---:|---|
| Route declarations | 233 | 286 | +53; includes 2 pathless declarations, not 286 unique URLs |
| Page files | 157 | 195 | +38; tracked `src/pages/**/*.tsx`, not a claim that each file is routed |
| Edge entrypoints | 241 | 244 | +3; tracked one-directory-deep `index.ts` files |
| Guard scripts | 50 | 117 | +67; tracked `scripts/check-*.mjs` |
| Test files | 45 | 233 | +188; tracked test/spec JS/TS files, including runners outside npm test |
| Public DB tables | 335 | 475 | +140; pg_class ordinary/partitioned tables in public |
| Tables with RLS enabled | 334 | 462 | +128; catalog flag, not evidence a policy denies |
| Roles | 5 | 5 | Required role matrix, not newly discovered runtime roles |

The item-level manifest contains **1,555 rows: PASS 0 / FAIL 0 / UNPROVEN
1,555** for end-to-end functional claims. These overlapping source categories
are inventory units, not 1,555 independent workflows. Successful unit/static
commands below do not silently promote every corresponding runtime surface.
The 13 tables without the RLS flag are recorded in the catalog; privileges and
exposure were not inferred from that flag alone.

## Evidence and limits

Durable evidence directory:
`/Users/samjames/business-ops/website-integrity-bot/receipts/AC-P10-2026-10-27/`.

- `inventory.md`: required item-level Surface / Item / Role / Verdict / Evidence /
  Notes table, with a specific missing-proof reason on every row.
- `inventory.json`: machine-readable inventory, counts, baseline SHA.
- `db-catalog.json`: read-only live bot-sql catalog response; no business rows,
  tokens or applicant/client data. Query:
  ```sql
  select n.nspname as schema_name,c.relname as table_name,
         c.relrowsecurity as rls_enabled
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') order by c.relname;
  ```
- `inventory-negative.log`: intentionally failed catalog input is rejected with
  `Refusing empty/failed DB catalog`; the shell asserted a nonzero exit.
  Reproduce: write `{"ok":false,"rows":[]}` to a temporary JSON file, then
  `node scripts/ac-p10-inventory.mjs <that-file>` must exit 1.
- `routes.log`: `node scripts/route-smoke.mjs` returned exit 0 for 38 public URLs.
  This is HTTP/source-registration evidence only. The script does not render
  React; it cannot establish an authenticated page or a working form.
- `tsc.log`: requested `npx tsc --noEmit` exited 0. The root config has
  `files: []` and references, so this command alone does not check the app.
  Actual referenced-project compilation is recorded separately.

## Executed command results

| Surface | Item | Role | Verdict | Evidence (command + observed output) | Notes |
|---|---|---|---|---|---|
| Inventory utility | Failed catalog rejection | local | PASS | `node scripts/ac-p10-inventory.mjs invalid-catalog.json`: exit 1, `Refusing empty/failed DB catalog`; valid live catalog produced 1,555 rows | Positive and negative paths exercised |
| TypeScript | Referenced-project compilation | local | FAIL | `npx tsc -b --noEmit --force`: exit 1, 75 TS diagnostics in `typecheck-build.log` | Equals existing `BASELINE = 75`; no baseline raised; no claim of type-clean code |
| Unit suite | Initial default-worker run | local | FAIL | `npm test`: exit 1; 2,385 passed, 11 failed, 6 TODO; `tests.log` | 10 timeout failures and one missing-element failure across GlobalSidebar, calendarPageTruth and myDealsProduction |
| Unit suite | Two-worker rerun | local | UNPROVEN | `npm test -- --maxWorkers=2`: exit 0; all 211 files, 2,396 tests passed, 6 TODO; `tests-retry.log` | Successful suite execution; not end-to-end production proof or a per-test mutation audit. The initial failures did not reproduce; resource contention is a hypothesis |
| Edge compiler | All 244 entrypoints | local | FAIL | `npm run check:deno-typecheck`: gate exit 0; 228 compile, 16 fail (all 16 baselined), zero unknown or undefined-identifier cases; 293.2s | Accepted ratchet is not clean compilation; exact slugs in `scripts/deno-typecheck-baseline.json` |
| Public routes | HTTP/source smoke | logged out | UNPROVEN | `node scripts/route-smoke.mjs`: exit 0, 38/38 URLs; `routes.log` | React view/data/actions not rendered |

Compiler reproduction: `npx tsc -b --noEmit --force`. Exact diagnostics are
preserved in `typecheck-build.log`, including the useAuth subscription mock
shape, logLeadActivity relation-type comparison, and missing declaration for
`build-landing-css.mjs`. Initial test reproduction: `npm test`; rerun command
above reduces worker concurrency without changing test assertions or timeouts.

The full existing verification spine completed: `npm run verify:core:all`,
**exit 0, all 115 links executed, zero unrun** (`verify-core.log`). This includes
`npm run build` (successful production build), 20 Deno test files, the
75/75 TypeScript ratchet, edge compiler baseline, and guards with their existing
self-tests. The successful aggregate gate does not erase the known compiler
failures recorded above. No assertions, timeouts, security controls or baselines
were loosened. Final receipt count check and `git diff --check` also succeeded.

## Remaining bounded work before final sign-off

1. Reconcile P3–P9 implementation receipts with the current ledger (P3–P9 still
   say pending; the canonical spec records some shipped slices). P9's five-role,
   five-viewport screenshots are not established by this run.
2. Exercise login → dashboard as admin, manager, agent, va_manager and va;
   capture the actual view after data settles, loading/empty/error states,
   permission denials and viewport evidence. No logged-out screenshot may stand
   in for owner proof.
3. Prove hierarchy exclusions and admin scope through authenticated RPC/RLS
   negative cases. Catalog RLS flags do not establish authorization behavior.
4. Prove application, deal, contracting and VA write paths with controlled test
   entities, read-back and cleanup receipts; verify production against current
   canonical truth objects. The old checklist's raw `agentlink_book` path is
   superseded by the program spec's production truth objects.
5. Prove notification outcomes per channel using specifically authorized test
   recipients. Do not invoke live send/blast functions just to count a 200.
6. Map each guard's successful execution to a failing fixture/mutation before
   assigning PASS under `PROVE_EVERY_FUNCTION_WORKS.md`. This slice adds an
   inventory utility, not a new merge guard or a claim that regressions are
   impossible.

The banner receipt explicitly says full sign-off is open. AC-P10 must remain
in_progress; a pushed report is not completion of these missing proof paths.
