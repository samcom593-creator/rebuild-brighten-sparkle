# APEX Target Architecture

## Decision

Keep React 18/Vite, Supabase Auth/PostgreSQL/Storage/Edge Functions, and Vercel. Evolve the running system through reversible, additive slices instead of replacing it. PostgreSQL owns identity relationships, workflow state, permissions, metrics, and the transactional outbox. React renders authorized commands and queries; it does not call vendors or calculate canonical business metrics.

```mermaid
flowchart LR
  U[Agent / manager / assistant / owner] --> UI[React workspaces]
  UI --> AUTH[Supabase Auth]
  UI --> RPC[Authorized SQL RPCs]
  UI --> Q[Read models and RLS views]
  UI --> S[Private evidence storage]
  RPC --> DB[(PostgreSQL canonical + legacy data)]
  RPC --> O[(Transactional outbox)]
  O --> W[apex-outbox-dispatcher]
  W --> D[Discord adapter]
  W --> A[AgentLink adapter]
  W --> K[Skool/manual-action adapter]
  W --> SC[Evidence scan/manual review]
  W --> CE[Email provider]
  W --> SMS[Verified SMS gateway or device fallback]
  WB[Protected comp workbook] --> CS[Signed comp sync adapter]
  CS --> DB
  DB --> M[Metric definitions + production ledger]
  M --> Q
  H[/healthz + /readiness] --> DB
```

## Boundaries

- **UI:** accessible forms, canonical navigation, permission-aware presentation, saved-state recovery, explicit delivery status.
- **Domain:** identity resolution, premium annualization, allowed deal transitions, effective-dated hierarchy/comp, metric definitions.
- **Application:** RPC commands that validate authorization and atomically persist business state plus audit/outbox records.
- **Infrastructure:** PostgreSQL, Storage, cron, Edge Functions, Vercel handlers, structured/redacted logs.
- **Integrations:** capability-driven adapters. A vendor limitation produces `manual_action_required`, never a fabricated success.

## Reliability contract

1. The command writes the authoritative record first.
2. The same transaction appends immutable history, audit context, and one idempotent outbox event.
3. Workers atomically claim events with `FOR UPDATE SKIP LOCKED`.
4. Each destination records an attempt and external receipt.
5. Retryable failures use bounded exponential backoff; terminal/exhausted failures move to dead letter.
6. UI receipts distinguish saved business state from downstream delivery state.

## Deployment contract

- `/healthz` proves the server can answer; it has no optional vendor dependency.
- `/readiness` proves required configuration, database reachability, and required migration version.
- Optional vendors appear in Admin/System Health and do not restart healthy first-party services.
- Migrations are applied in timestamp order, backed up first, and verified before enabling the native submission UI in production.
- Rollback disables new entry points/functions first. Additive tables and columns stay in place until reconciliation proves safe removal.

## Environment separation

Use separate local/staging/production Supabase projects, Vercel environments, storage buckets, webhook destinations, and encryption/signing secrets. Never point a local or preview build at production by default. Server-only keys must not use the `VITE_` prefix.

## Observability

Correlate every native submission, outbox event, and delivery attempt by UUID. Emit only identifiers, statuses, timing, and redacted error classes. Required operator views are database/migration state, build version, outbox lag, delivery failure/dead-letter count, worker heartbeat, integration capabilities, and recovery action.
