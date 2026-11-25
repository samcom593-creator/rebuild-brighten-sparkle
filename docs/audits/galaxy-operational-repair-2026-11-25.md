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

## Production verification of the first release

PR #77 was merged as `0f8caac3dc1f5715b6fba721ebc6eb30c45a7c42` after the full unit suite and required verification roster passed. The production deployment applied both reporting migrations; subsequent fixed catalog reads confirmed both migration-history entries, the new cohort signature and access grants, and all eight captured reporting definitions against their approved source. No application function was executed with a substituted user identity.

The live production revision matched `0f8caac3`. Route smoke executed against that revision and passed all 38 routes. The public mobile check exercised 15 funnel/careers routes at 390×664 with no horizontal overflow. SEO checks rendered the careers metadata, public sitemap pages and external handoffs. The homepage Lighthouse audit executed and reported its configured budgets passed; its performance and blocking-time measures remain advisory on the hosted runner. These public probes do not establish private workflow coverage.

In the authorized desktop session, Finances opened the multi-carrier policy book, its carrier/status search changed the result set, and the legacy commission URL redirected to the Commissions tab. The producer profile displayed distinct carrier outcomes. The home cohort, completed-day forecast and same-applicant conversion cards loaded from the new reporting contracts. Actual advancing audio and timestamp seeks were verified for one graded call, one curated call and one published recording; each was paused afterward. Incomplete upstream coaching fragments displayed an explicit incomplete state.

Lead-pack detail search, the no-match state and reset were verified against an existing pack without changing lead assignments. The broad Marketing pool preview still timed out on the deployed release, requiring a separate query-performance repair. The live review also identified profile-only inconsistencies in missing-record wording and partial premium presentation; the follow-up aligns those with the existing Finance evidence parser. The absence of assigned leads in the authorized account limits live verification of the populated My Leads workflow.

## Follow-up from authenticated verification

Migration `20261125110000_lead_pool_preview_cost.sql` replaces the broad preview's repeated full-pool context construction with shared live eligibility checks on narrow rows and detailed context for the selected sample. Tier, state, age and lead-age filters apply before enrichment. Advanced work-history filters retain the full predicate after static narrowing, with each context computed once. The preview and assignment paths share their protection relation; no cache, longer timeout, fabricated count or relaxed hold is introduced. New internal objects explicitly deny PUBLIC, anonymous and authenticated access; the existing administrator RPC remains the entry point.

The PostgreSQL fixture compares 30 complete old/new responses, including duplicate phones, overlapping cross-pool holds, caller/outcome/time/source filters, masking and assignment protection. In a local PGlite benchmark of 200,000 synthetic rows, the original default preview took 61,662 ms and the optimized result took 1,149 ms with identical JSON. A further case with 20,000 historical items and 60,000 dial-tap events completed in 1,460 ms and retained the latest work context in the sample. These are local relative measurements, not production latency claims. Set `PGLITE_MODULE` to the installed isolated PGlite module described in the fixture header, then reproduce the optional scale run with `LEAD_POOL_BENCH_ROWS=200000 node scripts/test-lead-pool-context.mjs`; the ordinary fixture omits the benchmark variable.

The profile follow-up reuses Finance's validated policy parser and summary logic, retains known partial premium with the missing count, labels absent chargebacks as Not recorded, and derives carrier counts from the displayed policy list. Contract estimates are explicitly labeled in both profile summaries, and the profile Refresh action refreshes production and carrier evidence. The navigation audit now assigns a source-based operational relevance level to every menu and route entry; those ratings do not assert measured usage.

The follow-up release still requires the normal CI gate, recorded migration application, catalog/ACL readback and an authenticated large-pool preview with representative filters. Public smoke results alone cannot close the observed private timeout.
