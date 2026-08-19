# APEX ⇄ Agent Cloud — Redesign Parity Matrix (living)

Verdicts: PASS / FAIL / UNPROVEN. Nothing is marked PASS without evidence.

| Capability (Agent Cloud benchmark) | APEX today | Verdict | Next |
|---|---|---|---|
| Breadcrumb topbar + greeting | GlobalSidebar topbar (breadcrumb) | FAIL (no greeting/purpose line pattern) | Phase 3 shell |
| One-line purpose subtitle per page | PageHeader supports subtitle | PASS (pattern) / FAIL (copy discipline) | per-page |
| Semantic policy-status tiles | none (status scattered) | FAIL | Phase 6 Production/Retention |
| AI briefing (plain-language, refresh) | Ask APEX exists (chat) | FAIL (no briefing panel) | Phase 6 |
| Next Best Actions w/ priority pills | Today priorities feed (tonight) | PASS v1 | polish |
| Setup checklist widget | none | FAIL | Phase 7 |
| Insurance calendar (lapse/beneficiary/anniversary) | CalendarPage (interviews-centric) | FAIL | Phase 6 |
| Document review queue w/ expiry | none (contracting docs unmanaged) | FAIL | Phase 5 |
| Carrier directory | CarrierContracts page | CHROME-ONLY | Phase 5 |
| Invite an agent (one link) | /start-contracting PROVEN (email leg delivered 15s) | PASS backend / FAIL surface polish | Phase 5 |
| Accent/branding settings | none in-app (tokens in code) | FAIL | Phase 7 |
| Sample-data mode | none | FAIL (nice-to-have) | backlog |
| Retention dashboard | none | FAIL | Phase 6 |
| Commission reconciliation | BookReconciliation exists | CHROME-ONLY | Phase 6 |
| Live data everywhere | yes — 92% tokened, live queries | PASS (with truth-flicker FAIL: $0 during book rebuild) | fix in Phase 3 |
| Role-scoped nav | partial (roles exist, nav shared) | FAIL | Phase 3 |
| Mobile queue usable | untested this cycle | UNPROVEN | Phase 9 |

## Program → execution machinery
The full spec is persisted at `~/business-ops/master-prompts/301-agent-cloud-rebuild.md`.
Phases are queued in `~/business-ops/website-integrity-bot/ledger/sam-punch-list-backlog.jsonl`
as AC-P3…AC-P10 so headless workers + next sessions drain them in order.
