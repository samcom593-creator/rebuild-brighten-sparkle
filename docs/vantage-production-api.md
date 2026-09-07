# Vantage production on APEX

Vantage's read-only Agent Cloud API is mirrored into APEX starting September 1,
2026. No client names, policy numbers, or face amounts are supplied by this API.

## Live source and storage

- `https://useagentcloud.com/api/v1/whoami` verifies Vantage Financial and the
  expected organization ID and `production:read` / `producers:read` scopes.
- `/api/v1/production?start=YYYY-MM-DD&end=YYYY-MM-DD` returns premium, policy
  counts, placed premium, and producer aggregates. Dates are provider UTC dates.
- `production_external_daily_snapshots` stores one row per day under source
  `agentcloud_production_api`. Producer aggregates and placed amounts are in
  metadata; the table's existing admin-only RLS policy remains in effect.
- Verified provider totals supersede overlapping Vantage rollup entries on
  covered dates. Original canonical records and uncovered historical dates
  remain intact. API aggregate units reuse `external_daily_gap`, so no synthetic
  client policies or individual commission estimates are invented.
- The shared IMO card shows placed premium, six initial producer totals, date
  coverage, and the oldest refresh time for the displayed period. Provider
  amounts are included in the headline totals, not added a second time.

## Recurring operation

`.github/workflows/vantage-production-sync.yml` runs at minutes 7, 22, 37 and 52,
and reconciles the previous 31 days daily at 05:23 UTC. GitHub scheduling can be
delayed; the displayed verification time is the freshness evidence. It does not
depend on Sam's Mac being on. Manual workflow dispatch defaults to reconciliation.

Encrypted repository secrets:

- `VANTAGE_PRODUCTION_API_KEY`: read-only provider credential.
- `VANTAGE_SYNC_BOT_TOKEN`: existing APEX database automation credential.

The script validates organization, exact date windows, finite/nonnegative
amounts, producer uniqueness and producer-to-agency totals, then reconciles the
period response against the sum of daily responses. It only upserts after every
response passes. A provider outage preserves the previous successful snapshots;
an explicit successful zero is allowed to correct stale production. Errors fail
the job, and neither raw response bodies nor credentials are logged.

## Release evidence

- Initial September totals: $26,126.88 premium, 15 policies, $9,579.96 placed,
  six producers. APEX's own September total remained $11,554 (rounded), 8 policies.
- The initial GitHub job completed successfully:
  https://github.com/samcom593-creator/rebuild-brighten-sparkle/actions/runs/34073583832
- Production view behavior was tested transactionally with
  `scripts/proofs/vantage-production-api.sql`, then rolled back before release.
- The original view definition and a rollback script are saved at
  `/Users/samjames/business-ops/ai-orchestrator/artifacts/vantage-production-api-rollback.sql`.

The existing Supabase deployment workflow has an expired management credential
and remains unable to deploy. This integration uses the already-authorized
`bot-sql` service to apply its tested migration, and GitHub Actions for ongoing
sync. It does not replace or change existing Supabase deployment credentials.

To stop this feed, disable the Vantage production sync workflow; previously
verified totals remain visible. Use the saved rollback SQL to restore legacy
rollups if required. Do not delete canonical production records.
