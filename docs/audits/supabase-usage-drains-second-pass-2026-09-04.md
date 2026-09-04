# Supabase usage drains — measured second pass — 2026-09-04

## Scope and outcome

This pass intentionally starts after the separate web-vitals/empty-outbox audit
and after MP-431's dashboard single-flight, no-op deal sync, and materialized-view
debounce. It found four additional production drains and patches each without
turning off a live business workflow:

1. The AgentLink book and its legacy snapshot mirror were wholesale rebuilt
   every 20 minutes. Both are now full-snapshot reconciliations that insert,
   update, or delete only real differences.
2. ReadyMode repeatedly rewrote its rolling 25-hour response. Its Edge worker
   now uses a change-only database upsert, and a dark source automatically backs
   off from five-minute polls to hourly recovery probes.
3. An internal cron wrote the field named `last_external_cron_run` every minute.
   That false heartbeat is removed; the external GitHub workflow remains the
   only writer.
4. The GitHub and database health checks scanned the 532 MB pg_cron history to
   find its newest row. They now use the existing monotonic `runid` primary key.

No production mutation was applied. The migration was compiled and exercised
inside an explicit transaction, then rolled back and independently checked for
residue.

## Production evidence

Measured through `bot-sql` against `xrzweoneiieddzxogewk` at 22:20–22:35 UTC.
Only aggregate counts, plans, and normalized query text were returned. The
statement window begins at the live `pg_stat_statements` reset,
2026-08-26 02:56:07 UTC.

| Signal | Measured result | Patch |
|---|---:|---|
| `agentlink_book_rebuild(jsonb)` | 455 calls; 788.5 MB WAL; 6.34M WAL records | change-only full-snapshot reconciliation |
| `agentlink_sync_snapshot_from_book()` | 455 calls; 596.6 MB WAL; 4.83M WAL records | change-only legacy mirror reconciliation |
| Current AgentLink mirror | 1,734 rows; zero rows posted in measured trailing 48h | stable runs avoid ~6,936 tuple mutations/run (~499k/day) |
| ReadyMode rolling-window upsert | 398,059 table updates; 596.3 MB WAL | server-side `IS DISTINCT FROM` upsert |
| ReadyMode health | 285 failed polls/24h; last non-empty pull 2026-08-31 16:40 UTC | 5m healthy cadence, ~hourly dark-source probe, automatic recovery |
| `refresh_sync_health()` | 13,970 calls; 8.86 MB WAL | remove erroneous internal 1m writer; preserve external writer |
| `cron.job_run_details` | 332k rows; 532 MB heap; only `runid` index | read newest row through primary key |
| Old external cron query | 366 calls; 1,881.8s; 20.38M disk blocks (~163 GB) | 0.13 ms / 4 cached blocks in live `EXPLAIN ANALYZE` |
| One live `sync_health_summary()` sample | 12.739s; 197,360 disk blocks (~1.58 GB) | runid probes plus targeted latest-row indexes |
| `insuracloud_sync_log` | 69.8k rows; 22,694 seq scans; 1.58B tuples read | latest/success/error indexes used by health view |

The AgentLink figures are not estimates from source code. Live table statistics
show 844,137 inserts + 844,134 deletes on `agentlink_book`, and 898,921 inserts +
842,634 deletes on `agentlink_deals_snapshot`, despite each table currently
holding only 1,734 rows. The two top-level rebuild statements alone produced
1.385 GB of WAL in the measured statement window.

## Behavioral contracts preserved

- AgentLink input remains a complete snapshot: rows absent upstream are still
  removed, but unchanged rows are not rewritten. New/changed rows still fire
  the existing production, license, and outbound triggers.
- A singleton `system_settings.agentlink_book_last_refreshed_at` value records a
  successful unchanged pull, and `production_book_freshness()` reads it. This
  separates source freshness from row mutation time.
- The two bulk AgentLink functions are no longer executable by anon or ordinary
  authenticated users. The local bot-sql operator and service role retain access.
- ReadyMode late dispositions, recordings, and corrected fields still update.
  Only exact repeats are suppressed. The first non-empty recovery pull restores
  five-minute polling on the next cron tick.
- The external GitHub workflow still calls `refresh_sync_health()` each tick.
  Removing the internal cron makes the `github_external_cron` health row honest.

## Verification

- `npm run check:second-pass-usage-drains` passed.
- `npm run check:rpc-args`, migration version/terminator checks,
  `check:sync-reliability`, relation checks, and both usage-drain guards passed.
- `deno check supabase/functions/readymode-sync/index.ts` passed.
- Deno suite: 32 passed, 0 failed.
- Production Vite build passed (4,237 modules).
- Rolled-back production proof compiled the complete migration, confirmed an
  unchanged 1,734-row snapshot made zero inserts/updates/deletes, proved a
  repeated ReadyMode row returned zero changes, exercised the rewired crons,
  and ran `sync_health_summary()` under a two-second assertion.
- Post-proof residue check confirmed the new RPC, synthetic ReadyMode row, and
  cron mutations were all absent after rollback.

The repository TypeScript error-count ratchet remains red at 91 versus baseline
86. Its reported new errors are in pre-existing dirty frontend work; none of the
second-pass files are TypeScript project inputs. The production build and direct
Deno typecheck are green.

## Deferred with evidence

- `applicant_login_tick()` runs 480 times/day, but its queue has no queued or
  link-ready rows and the function already avoids Edge calls when empty. It uses
  ~130 ms/call and only 1.44 MB WAL over 4,650 calls; preserving the 3-minute
  account-delivery SLA is worth more than this small database check.
- `fn_evaluate_personal_records()` averages ~749 ms every 15 minutes but emitted
  only 18 records in the statement window. Gate it on production movement only
  after MP-431 has a full-day post-release delta; changing recognition timing
  during this incident is not yet proven safe.
- pg_net's `_http_response` cleanup owns 52k calls and 3.82M ms, but it is
  extension-managed and currently has zero live rows. Its 53 MB relation bloat
  is a maintenance/vacuum decision, not an application migration.
- The existing `apex-cron-run-details-prune` job is already catching up the old
  ledger at a capped 200k rows/day. This pass fixes the hot read path and does
  not duplicate or accelerate that maintenance while the database recovers.

## Release and rollback

Apply `20260904224500_second_pass_usage_drain_controls.sql` before deploying the
ReadyMode Edge worker, then deploy the GitHub workflow. A 24-hour comparison
should show AgentLink WAL tracking real book changes, ReadyMode direct probes
near 24/day while dark, no internal `apex-sync-health-refresh-1m` job, and no new
full-scan heartbeat statement in `pg_stat_statements`.

Rollback restores the prior two function definitions and ReadyMode direct
upsert, re-schedules the internal heartbeat only if deliberately accepting its
false semantics, and changes the GitHub heartbeat query back only if a suitable
`start_time` index is added first.
