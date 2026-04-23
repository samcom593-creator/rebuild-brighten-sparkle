# CHANGELOG

One line per master-prompt section shipped.

## 2026-04-23

- **Section 3** — deal status sync live. `agentlink_live_pull` now refreshes status on ON CONFLICT, `trg_deal_status_transition` fires commission_ledger + retention alerts, 263 → 343 stale submitted (upstream `null` status is Agent Link's reality, see `docs/metric_audit.md`).
- **Section 5** — commission engine. Seeded 80% baseline for every active agent × every active carrier. 38 unscheduled agents → 0. `commission_ledger` populated with 100+ rows, $44,772.83 pending. Integration test **PASSES**.
- **Section 8** — cron cleanup. Killed `agentlink-commissions-pull`, `agentlink-book-refresh`, `agentlink-appointments-refresh` (endpoints don't exist upstream). Added `stale-submitted-alert`, `orphan-deal-audit`, `commission-ledger-reconcile`, `churn-calc`, `webhook-health-check` with unified `job_runs` observability.
- **Section 6** — Discord router. Single `public.discord_route(event_type, entity_id, channel, body)` entrypoint, per-channel webhook routing (sales/retention/hiring/leadership/system), 60-min dedup, CST timestamps.
- **Section 7** — `/apply` VSL video fully removed. `/setup` admin page added (10 live checks, green/amber/red). Backfill guards on all Discord INSERT triggers.
- **Section 4** — first pass: `MyCommissions` rebuilt to read `commission_ledger` directly. `docs/metric_audit.md` scaffolded with per-widget source-of-truth and remaining TODO list.

## 2026-04-22

- Agent Link cookie-auth sync built (Chrome cookie decrypt path documented in `~/.claude/projects/-Users-samjames/memory/apex_agent_link_live_pull.md`).
- `agentlink_live_pull()` pg_net driver, 30-min cron, populated 530 deals.
- Leaderboard + Rewards UI pages shipped.
- SMS-via-carrier-email-gateway fan-out (Twilio-free).
- Self-running automations: morning huddle, hiring bottleneck alert, auto-advance stale applications, onboarding drip, hot streak amplifier, slump detection, licensing nudge, data quality audit.
