# Supabase usage and outbound-flow audit — 2026-09-04

## Outcome

The measured drains were bursty production dashboard/realtime work, per-interaction
web-vital writes, and an outbox Edge worker launched every minute even when its
queue was empty. This slice fixes the latter two without delaying real outbox work,
quarantines one stale email campaign, and adds a PII-free health RPC.

The separate in-progress MP-431 migration
`20260904223000_mp431_single_flight_cache_noop_suppression.sql` already addresses
the dashboard/realtime feedback loop with single-flight caching, no-op update
suppression, and materialized-view debounce. It was present in the dirty worktree
and applied live before this audit; this slice did not edit or duplicate it.

## Production baseline

Measured through `bot-sql` against project `xrzweoneiieddzxogewk` at approximately
2026-09-04 22:06 UTC. No recipients, bodies, tokens, or other PII were returned.

| Signal | Measured result | Decision |
|---|---:|---|
| `web_vital.INP` rows, trailing 24h | 28,875 | Coalesce to one worst INP per page |
| All analytics rows, trailing 24h | 30,711 | INP alone was 94% of writes |
| Outbox cron runs, trailing 24h | 1,440 | Keep one-minute check |
| Outbox cron startup failures | 67 | Database was saturated during the dashboard storm |
| Claimable outbox events | 0 | Skip Edge invocation and automation log when empty |
| Outbox idempotency duplicates | 0 | Existing delivery safety is healthy |
| Delivery attempts, trailing 24h | 34 | 32 delivered, 2 manual-action-required |
| Stale `reissue-40d-*` pending emails | 203 | Quarantine only this never-attempted July cohort |
| Current `applicant-onboarding-v2` pending | 8 | Preserve; these are current operational mail |

`pg_stat_statements` had been collecting since 2026-08-26. In that window,
`realtime.list_changes` ran 988,156 times (23.1M ms),
`scoped_production_scoreboard` ran 29,675 times (67.7M ms), and
`apex_admin_home_dashboard` ran 19,707 times (47.9M ms). Those cumulative figures
explain the database saturation but must not be read as a trailing-24-hour rate.

## Changes

`src/shared/lib/webVitals.ts` now keeps a bounded map keyed by vital name, retains
the worst observed value, writes at most one row per vital per page, and attaches
the existing telemetry session ID. A fixed five-second window means continuous
interaction cannot defer an ever-growing batch indefinitely.

`20260904224000_supabase_usage_drain_controls.sql` adds
`run_apex_outbox_dispatch_if_pending()`. The cron still checks every minute, but
the Edge Function and `automation_run_log` are touched only when a pending/failed
event is due or a processing lease is stale. The claim predicate matches
`claim_apex_outbox_events()` and keeps the existing under-60-second delivery SLA.

The same migration changes only never-attempted, more-than-14-days-overdue
`reissue-40d-*` rows from `pending` to `skipped`, tagged with
`quarantined_stale_reissue_2026_09_04`. It does not set do-not-contact and can be
reversed selectively. Current applicant and agent-onboarding queues are untouched.

## Observability and verification

Run as Sam/admin or service role:

```sql
select public.supabase_usage_drain_health();
```

The result contains only aggregate counts: claimable/dead-letter outbox state,
duplicate idempotency keys, cron checks versus Edge launches, whether the cron is
wired to the gate, current/quarantined email queue counts, analytics/INP volume,
and cron startup failures.

After one full production day, healthy means:

- `cron_uses_pending_gate = true` and `cron_checks` remains near 1,440.
- `edge_launches` tracks minutes with real work instead of tracking every minute.
- `claimable = 0` during idle periods and duplicate idempotency keys remain zero.
- INP rows are on the same order as page sessions, not tens of thousands.
- Current onboarding mail remains present or delivers normally.

The repository guard `npm run check:supabase-usage-drains` pins all four controls,
and `src/tests/lib/webVitals.test.ts` proves a burst becomes one worst-value row.

## Rollback

Reverting the frontend file restores the prior telemetry behavior. To disable the
outbox gate while preserving delivery, alter the existing cron command back to
the prior `run_automation_job('apex-outbox-dispatcher', ...)` call. To release the
quarantined campaign, update only rows carrying the exact quarantine marker after
an operator re-approves the old campaign; do not bulk-reset all skipped outreach.
