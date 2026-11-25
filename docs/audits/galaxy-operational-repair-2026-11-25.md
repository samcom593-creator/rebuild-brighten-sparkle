# Galaxy operational repair — 2026-11-25

## Decision and scope

The owner reported that producer profiles collapsed outcomes into Submitted, call training could not play reliably, lead searches were weak, forecasts and conversion rates were misleading, and finance balances implied zeros without payment evidence. This repair follows those workflows from the database contract to the visible controls. It is based on main `d0302b334f7264ed214f8aaca5d174ef3fc3fc63` and preserves existing authentication, row visibility, private media buckets and historical production attribution.

Code and test validation are release prerequisites. They do not establish that a private signed-in workflow or a migration works in production. The release must also verify the served revision, database migration history and authenticated UI results.

## Implemented behavior

| Workflow | Change | Evidence boundary |
| --- | --- | --- |
| Producer profiles | Canonical profile and drawers share a searchable carrier policy book with distinct paying, in-force, pending, declined/not-taken, at-risk, ended, chargeback and unknown states. Preserve literal carrier status and source observation dates. | Generic active or issued status does not prove payment. Contradictory terminal classifications remain unknown/conflicted. A lapsed policy does not automatically become a chargeback. |
| Issued, paid and placement | Add a dated native-application cohort to the production scoreboard and Finances. Match outcomes through persisted deal identity, canonical writer and carrier. Show evidence coverage and unresolved records. | Distinct applications remain distinct even when placeholder policy numbers repeat. No total paying-status placement rate is asserted until the entire denominator has supported payment evidence. |
| Finances | Open the personal policy book first, with searchable multi-carrier status rows, carrier-recorded chargebacks and separate debt observations. Keep dated commission payments, open ledger entries and contract estimates in Commissions. Preserve commission bookmarks. | Missing receipts read Not recorded/Unavailable, not an asserted cash balance of zero. Partial estimates show Incomplete, a known subtotal and excluded-record counts. Carrier portal hierarchy totals remain separate from personal policy totals. |
| Production dashboards | Use canonical server aggregates, distinct personal/downline/agency scopes and a disclosed month run rate based on completed Phoenix days. | Require three completed production days; exclude future native timestamps. Submitted annual premium is not earned income. Goal percentages are user assumptions rather than an assumed default contract. |
| Conversion reporting | Separate dated activity counts from recorded outcomes for the same first-application recruiting cohort. Keep provider-call sale dispositions within their own call sample. | Producer-record creation is not automatically a completed hire. A sale disposition is not a linked paid-policy conversion. Unsupported required-call forecasts are withheld. |
| Call training | Resolve authorized audio availability before offering playback, bound signer and media-load stalls, retry once automatically and offer an explicit retry. Preserve requested timestamp, playback intent and account isolation. | A grade or provider recording reference does not establish playable published audio. Signer authentication and private storage access are unchanged. |
| Lead worklists | Always-visible search; normalized phone and text matching; state, pack and status filters; results/reset; 25-row pages; work mode follows the selected cohort. Advanced manager filters validate ranges and keep preview/assignment parity. | Existing calling-hour, DNC, hold, routing and assignment restrictions remain. Bounded review feeds explicitly disclose their scope. |
| Navigation | Align actual role/grant visibility across sidebar, command palette and mobile navigation; add a contextual admin policy-review entry; preserve canonical profile/commission destinations. | The complete route inventory is a source audit, not a claim that every page was exercised live or that an unreferenced route is unused. |

See [the complete navigation audit](galaxy-navigation-and-workflow-audit-2026-11-25.md) for all 304 routes, 47 menu entries, purpose, access and retained limitations.

## Live diagnosis before this release

Fixed read-only database diagnostics checked source coverage and reporting definitions. Diagnostic output was encrypted before entering public CI logs; no private key, credentials, client text or plaintext business totals are included in this repository. No diagnostic read changed production data or impersonated a user.

The diagnostics found differing carrier outcomes in the source, chargeback records outside the separate commission ledger, a carrier observation freshness gap, and no dated payment receipts in the inspected commission-payment feed. Those findings justify explicit source distinctions and freshness labels; they do not justify manufacturing missing payments or relinking policies by a guessed number match.

The inspected published recording inventory had stored audio. In the authorized desktop browser, actual advancing playback and timestamp seeking were observed for one graded call, one curated team call and one published training recording on the pre-repair release. The reported playback failure was not reproduced in that browser session. The retry/availability changes address verified source failure paths, but post-release browser verification remains necessary.

A live coaching panel also displayed isolated character fragments. The historical upstream writer iterated a scalar string as a list and discarded the remainder before storage. Missing advice cannot be recovered by joining the retained letters; intact content should render normally and incomplete content must be identified honestly. The running upstream writer and regeneration require independent confirmation.

## Database deployment

Apply through the existing protected-main Supabase deployment workflow, in order:

1. `20261125100000_producer_status_and_run_rate.sql`
2. `20261125101000_home_cohort_conversion.sql`

Both migrations use transactions. Existing-function edits require exact verified source markers and abort if the live contract differs. Do not preapply the home patch and then replay it without migration-history reconciliation. Confirm that earlier tracked migrations are already recorded before the workflow's `--include-all` operation.

The new `production_policy_cohort` RPC is recorded in the catalog with migration-declared provenance. After deployment, verify its exact signature, authenticated/service grants and anonymous denial from the live catalog. Existing home and production caches can delay visible changes until their normal expiry.

## Release verification requirements

Focused regression tests cover financial evidence, identity changes, carrier status conflicts, native application identity, run-rate boundaries, same-cohort conversion, playback recovery, lead filters/pagination and navigation permissions. Local production build and the forced TypeScript project graph passed during preparation. Final-commit `npm test` and `npm run verify:core:all` remain the authoritative CI gate; changed navigation also requires `check:private-surfaces` and the normal commit hook.

After merge, verify the actual Apply migrations step and the served application revision. Then check the personal policy book, commission bookmark, producer profile, cohort card, home conversion/run rate, lead search/filter reset and training playback in the authorized account. A green workflow whose probe skipped or never matched the served revision is insufficient.

## Remaining source limitations

Current carrier outcomes depend on a successful authorized carrier ingest. A frontend release cannot supply a newer observation when that upstream refresh is blocked. Commission cash requires a dated payment source; carrier premium status and modeled contract estimates cannot substitute for one. Record the actual remaining source blockers in the release result instead of declaring the whole operation complete from build status alone.
