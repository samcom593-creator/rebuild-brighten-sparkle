# APEX OS — Build State

**Read this file before making changes.** Restart-safe progress record per §7.

**Last updated:** 2026-08-17

---

## Completed

- **Phase Zero audit** — `docs/AUDIT.md`. All figures measured against the working
  tree and the live Supabase project, not estimated.
- **Decision records** — `docs/DECISION_LOG.md` (DEC-001…004).
- **Assumptions** — `docs/ASSUMPTIONS.md` (A-001…007).
- **Traceability matrix** — `docs/REQUIREMENT_TRACEABILITY_MATRIX.md`.
- **Production repair (pre-directive, same session):** 34 edge functions bumped off
  a dead `esm.sh@2.50.0` pin (commit `59be24d0`). `send-notification` had been
  returning 500 on 903/903 calls; verified 10×200 / 0×500 on live traffic after.
  Web push VAPID keypair generated and configured; `get-vapid-public-key` 500→200.

## Verified this session

| Check | Result |
|---|---|
| `send-notification` live traffic | 10×200, 0×500 (was 903×500, 0×200) |
| `poke-pusher`, `metricool-sync` | 200 |
| `get-vapid-public-key` | 200, serves the generated key |
| Edge function deploys | 34/34, 0 failures |
| Pre-commit guards on `59be24d0` | 8/8 passed |

## Not started

Everything in directive §10–§27 beyond the audit. Specifically: tenant entity,
role split, entitlements, tenant switcher, branding editor UI, workforce model,
service packages, automation engine, KPI registry, AI layer, public marketing site.

## Slice 1 — brand/config foundation — **DONE**

- `src/config/brand.ts` — typed `Brand`, `APEX_BRAND` defaults, `resolveBrand(tenant?)`
  seam, `showsPoweredBy()`. Tenants cannot escalate their own branding tier:
  `brandingMode` is deliberately excluded from `TenantBrandOverrides`.
- `scripts/check-brand-literals.mjs` — baseline ratchet at **540**, comment-aware.
- `src/config/__tests__/brand.test.ts` — 7 tests.
- Wired into `verify:core` and `.husky/pre-commit`.

**Proven, not assumed:**

| Proof | Result |
|---|---|
| Guard on 3 new literals in code | FAIL, exit 1, counted +3 |
| Guard on 5 literals in a comment | PASS, exit 0, count unchanged |
| Mutation of `resolveBrand` | 3 of 7 tests FAIL |
| Restored | 7/7 pass, guard green |

**Baseline correction worth remembering.** The audit first reported 760 brand
literals. That regex had no word boundaries and scanned comments, so it counted
`ApexLink` substrings and documentation. True chain: 760 raw → 625 word-bounded → 551 in code → **540 excluding tests**. The baseline is 540. A ratchet anchored to an inflated number
silently absorbs real regressions, which is the failure this guard exists to
prevent — so it would have been the bug inside its own cure.

## Exact next task

**Slice 2 — migrate call sites to `resolveBrand()` in waves**, dropping the 540
baseline each wave. Highest leverage first: shared layout, nav, auth screens,
email templates, document/PDF export.

**Do not** begin tenant scoping (section 10) until the tenant entity and an
isolation-test harness exist — see DEC-002.

**Do not** begin tenant scoping (§10) until the tenant entity and an isolation-test
harness exist — see DEC-002.

## Blockers requiring the owner

| Blocker | Needed |
|---|---|
| Public "active agents" definition | choose 8 (Skool) / 12 (30d production) / 42 (contracted) — see DEC-004 |
| Off-machine backup of `business-ops` | Dropbox is 100% full; 166 files carry applicant PII, so a private GitHub push is the owner's call |
| Discord contracting channel | webhook URL, or a non-empty bot token |
| 3 Skool members absent from APEX | emails for Lorenzo Farfan, Jontay T, Billy Kalonji |

## Known open UI items (not fabricated as done)

- **`AgentCommandDashboard` is dark-only.** Panels hardcode `text-white` on
  `slate-950`; children use `text-slate-300`. Token-swapping the surfaces with a
  regex would leave child text unreadable in light mode — worse than the
  gradients. Needs a real redesign of the page's colour contract (§18).
- 37 gradients / 35 `backdrop-blur` / 32 `rounded-3xl` remain, now diffuse.
- 79 raw `<button>` elements bypass the shared `Button`.
- 203 fixed pixel widths (`w-[NNNpx]`) — the main mobile-overflow risk.
- The per-route 12-field table (§3) is **not produced**: it needs 6 viewports ×
  2 themes × 3 branding modes, and the branding modes need the tenant entity.

## Repository hazards

- **Multiple automated workers commit here.** Never `git add -A`. Use
  `git commit --only <paths>`. An in-flight worker currently holds uncommitted
  `requireAuth`/`ctx.auth` changes in `ai-lead-insights`, `notify-notes-added`,
  `notify-stage-change`, `score-applicant`, plus `check-overdue-tasks`,
  `system-health-check`, `deno.lock`, `docs/operations-runbook.md`,
  `scripts/sync-functions-config.sh`.
- `npx tsc --noEmit` exits 0 on zero files (root tsconfig has `files: []`). The real
  type check is `scripts/check-tsc-error-count.mjs`, measured at ~881s. CI owns it.

## Commands to resume

```bash
cd /Users/samjames/projects/rebuild-brighten-sparkle
git pull --rebase origin main
cat docs/BUILD_STATE.md
npm run verify:core        # guards
```
