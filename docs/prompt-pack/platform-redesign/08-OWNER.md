# 08 · Owner: Launch Board, Reports, Finances, Contracting, Import, Social Command, Instagram

Paste after `00-MASTER.md`. Branch `redesign/owner`. Worktree `../rbs-owner`.

## Goal

Sam's own tools, read on his phone between calls. Same contract, with the extra rule that an owner page
shows health and money as states (fresh, stale, failed, withheld), never as decoration. Two of these pages
are being built right now (MP-305 Instagram, MP-308 Social Command); this area coordinates with them
instead of rewriting them.

## Read first

- Pages: `src/pages/LaunchBoard.tsx` (`/dashboard/launch-board`, behind `ContentAccessGate`; the shipped
  log shows two declutter passes already reviewed by the council), `src/pages/BusinessAnalytics.tsx`
  (`/dashboard/analytics`, "Reports", admin and managers), `src/pages/Finances.tsx` (`/dashboard/finances`),
  `src/pages/CarrierContracts.tsx` (`/dashboard/contracting`, the "one front door" with the earlier records
  row), `src/pages/admin/XcelImport.tsx` (`/dashboard/import`), `src/pages/SocialCommandCenter.tsx`
  (`/dashboard/social-command`, MP-308, in flight), `src/pages/InstagramInbox.tsx`
  (`/dashboard/inbox/instagram`, MP-305, in flight), `src/pages/DashboardCommandCenter.tsx`
  (`/dashboard/admin`, the legacy command centre), `src/pages/DeletedLeadsVault.tsx`
  (`/dashboard/settings/deleted-leads`), `src/pages/RecruitingLinks.tsx` (`/dashboard/recruiting-links`).
- `docs/audits/apex-os-redesign-2026-10-05/impl-launch-board.md`, `impl-contracting-cases.md`,
  `03-headcount-production-data.md`; `docs/operations-runbook.md`; `docs/integration-capabilities.md`.
- Guards: `check:discord-pii`, `check:ntfy-receipt`, `check:cron-verdict-states`, `check:sync-reliability`,
  `check:supabase-usage-drains`, `check:second-pass-usage-drains`, `check:probe-timer-span`,
  `check:demo-mask-coverage`, `check:prod-write-ref-gate`, `check:unsent-receipt-marker`.

## Scope

The pages above except the two in flight, their components, pure helpers, tests, `ROUTE_BOARD.md`, the
shipped log. For `SocialCommandCenter.tsx` and `InstagramInbox.tsx`: read them, write a contract review
(what they would need to meet the screen contract, file:line) into the PR body, and do not edit them until
their owner's work has merged; then apply the contract in a follow-up commit on this branch.

## Guardrails

- Health is a state machine the guards know (`check:cron-verdict-states`): fresh, stale, failed, never
  "OK" by default. A receipt shown is one the server returned (`check:ntfy-receipt`, `check:unsent-receipt-marker`).
- Finances: estimated income is never payroll truth; every money figure carries its window and source.
- Import: preview before write; writes are additive; the page shows what will change before it changes.
- Contracting: the review is the working view; the earlier pages stay reachable from "Earlier records";
  the intake path is APEX → Google contracting sheet → private Discord; no AgentLink contracting hand-off
  (older pack rule, still true).
- Nothing in these pages posts to Discord, Slack, ntfy, Instagram or email from the harness; mock every
  transport.
- Demo masking (`check:demo-mask-coverage`): screenshots of owner pages use masked or synthetic data.

## Required work

1. **Reports.** Tiles: ALP this month, Hires this month, Active producers, Show rate (the funnel helper
   from area 02/03). One chart per question, each with its window and source line; the long tables behind
   folds and a "Table" view. Export (CSV) in More.
2. **Finances.** One statement per period; tiles: Earned, Pending, Chargebacks, Estimated next (labelled
   estimate). Folds per carrier and per agent.
3. **Contracting.** The review queue meets the row contract (carrier · agent · stage pill · age);
   detail drawer with the documents and the next action; "Earlier records" stays a fold.
4. **Import.** Three steps (choose file, preview the diff, apply), one gold button per step, the result as
   a receipt with counts the server returned.
5. **Launch Board.** Already decluttered twice; verify against the contract and fix only what fails the
   council (type floor, one gold button, folds).
6. **Legacy command centre (`/dashboard/admin`).** Either every surviving widget has a home on Sam's Home
   or Reports (then redirect this route, query preserved) or it stays as a plain list of links to those
   homes. Decide from `ROUTE_BOARD.md` and the H5 answer; write the decision in the PR.
7. **Social Command and Instagram.** Contract review only (see Scope), posted in the PR; coordinate in a
   note on the owning PRs.
8. **Measure.** Controls on first screen before/after; tiles with a visible window and source: 100%.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, as admin: each page empty, full, stale and failed.
- Council passes; the Engineer lens checks every receipt and health state against its guard.

## Done means

- [ ] Each owner page: one gold action, ≤4 tiles each with window and source, folds for the rest.
- [ ] Health reads as a state, money as an estimate where it is one; no decoration.
- [ ] The legacy command centre decision is made and implemented.
- [ ] Contract reviews for the two in-flight pages are in the PR body.
- [ ] Before→after table, screenshots, shipped-log entry, `SHIPPED_TOTAL` matches.

## Acceptance output

1. Decisions (legacy command centre; in-flight pages).  2. Files changed.  3. Verification performed.
4. Council verdict.  5. Screenshots.  6. Follow-ups once MP-305/MP-308 merge.
