# Migration and Backfill Plan

Status: local implementation only. No migration in this slice has been applied to production.

## Before authorization

1. Capture a database backup/PITR restore point and record its timestamp.
2. Apply the three additive migrations to an isolated staging project in order: `20260811220000`, `20260811221000`, `20260811222000`.
3. Deploy `apex-outbox-dispatcher` with staging-only secrets and `APEX_CONTACT_DRY_RUN=true`.
4. Run the acceptance matrix and reconcile legacy counts before enabling routes.
5. Obtain owner approval for the exact migration/function/deploy commands.

## Identity backfill

- Populate `people` and `external_identities` in bounded batches.
- Match by validated external ID, PA/NPN, verified normalized email, then phone plus corroborating name/state.
- Never match on name alone. Put collisions and orphan references in a review report.
- Preserve every legacy ID and source hash; do not rewrite legacy history.

## Production backfill

- Native APEX deals enter the new ledger only through approved status transitions.
- Legacy/AgentLink deals remain authoritative until a reviewed one-to-one mapping exists.
- Reconcile deal count, annual premium/ALP, writing agent, manager, carrier, status, and `posted_at` by month before switching a dashboard read model.
- A mismatch blocks promotion; it is never hidden with a compensating aggregate.

## Compensation import

- Hash and version the approved workbook.
- Reject duplicate change IDs, missing identity mappings, overlapping effective dates, unapproved rows, and invalid rates.
- Website roles receive read-only access; service role is the only writer.

## Contact migration

- The Licensed Inbox resolves recipients server-side. Do not backfill message content.
- Existing contact logs remain intact. New actions link to logs through `contact_action_id`.
- Before enabling SMS, verify consent and carrier data; missing carrier stays `fallback_required`.

## Rollback

Rollback is feature-first and non-destructive: disable the new global actions/routes, stop the dispatcher schedule, and redeploy the last known-good web/function release. Leave additive columns/tables in place so accepted provider receipts and audit history are not lost. Drop new objects only if staging proves they contain no production records and the owner approves a separate destructive change.

## Reconciliation evidence

Store batch counts, collision reports, before/after metric totals, outbox lag, dead-letter count, and restore-point identifier with the release receipt. A local build is not migration evidence.
