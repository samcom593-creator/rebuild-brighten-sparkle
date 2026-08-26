# APEX live production repair — 2026-08-26

## Outcome

The production database now reports `$7,151` across `3` policies for the
2026-08-26 America/Phoenix business date. The dashboard RPC was verified under
Samuel James's admin identity and returned a four-day selling streak.

## Verified Vantage sales

| Producer | Annual premium | Source |
| --- | ---: | --- |
| Pranav Kodali | $4,020 | Vantage Discord daily sales |
| Marquay Vaughns | $2,037 | Vantage Discord daily sales |
| Marquay Vaughns | $1,094 | Vantage Discord daily sales |

## Repair

- Added `production_external_deals` for named, policy-level external sales.
- Added service-role-only `ingest_external_production_deal` with deterministic
  source-reference idempotency.
- Included named external deals in the canonical production ledger.
- Reconciled external rows one-for-one when matching AgentLink rows arrive, so
  later synchronization does not double-count them.
- Added real-time invalidation for CRM, home, scoreboard, and IMO-by-agency
  surfaces.

## Verification

- Production migration applied and recorded as `20260826162500`.
- `crm_today_production()` as Samuel James admin: `$7,151`, `3` policies,
  `4`-day streak, business date `2026-08-26`.
- Focused production reconciliation tests: 6/6 passed.
- Production TypeScript/Vite build: passed.

## Remaining integration dependency

AgentLink synchronization is live, but its current feed ends on 2026-08-25.
Continuous ingestion of future Discord-only Vantage sales still requires the
Discord bot/application credential to be connected to the ingestion worker.
The new table and idempotent RPC are ready for that worker.
