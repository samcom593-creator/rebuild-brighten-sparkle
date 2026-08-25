# Live APEX dashboards and workflows — Codex audit

Date: 2026-08-25 UTC
Task: `ai-20260825T055157Z-audit-and-finish-every-live-apex-das-15cf`
Lane: review; Claude owns implementation and final approval

## Verdict

The routes build and respond, but the goal is not ready to call finished. One P0 authorization chain permits anonymous use of service-role production and account-provisioning functions. Production money also has four conflicting live answers, 63 nominally live queries poll about once every 208 days, the training leader view omits agents who never started, and interview state is split across two write policies and two operational ledgers.

The contracting intake implementation has good durable-delivery primitives and passing tests, but production contains zero intake or destination-receipt rows. A concurrent uncommitted migration attempts a bulk roster reconciliation that will enqueue real Sheet and Discord delivery. It must not be deployed as part of an otherwise safe dashboard migration without an explicit preview and outbound approval.

No production writes, deployments, emails, Discord posts, or Sheet writes were performed during this audit.

## Coverage and live verdict

| Surface | Verdict | Evidence |
|---|---|---|
| Admin home dashboard | Partial, pending patch | Deployed source still uses `agentlink_book`; an uncommitted migration changes home to `v_production_unified`. |
| Daily personal/team numbers | Fail | Public service-role write path; manual ledger disagrees with unified production by $82.5K in a seven-day sample. |
| Contracting Sheet/Discord | Unproven live | 0 `contracting_intakes`, 0 destination receipts; settings exist; scoped deal Discord outbox has 49 delivered rows, but that is a different provider path. |
| Recruiting/onboarding | Partial | 126/129 queued onboarding messages sent; the remaining 3 are correctly cohort-blocked, but the agent-required training card points at a staff-only route. |
| Interviews/follow-ups | Fail | 229 past open events, 127 both past/open and unmatched; legacy disposition endpoint bypasses the canonical transition policy. |
| Training | Fail | 27 canonical roster agents, 16 with progress against active modules, 11 never started; the leader RPC omits all 11. |
| Leaderboard/postable board | Fail | Headline is 59 / $85,062.12; listed rows sum to 76 / $197,592.48 because the list adds 17 / $112,530.36 of unclaimed production. Unified MTD is 66 / $93,960.48. |
| Route/build health | Pass with debt | Production smoke passed 37 routes; Vite build passed; raw TypeScript check reports pre-existing project errors and the ratchet check was still running at handoff. |

## P0 — anonymous service-role production and provisioning chain

### Evidence

- `supabase/config.toml:244-245`, `308-309`, and `142-143` set `verify_jwt = false` for `create-agent-from-leaderboard`, `log-production`, and `notify-production-submitted`.
- `supabase/functions/log-production/index.ts:9-20` creates a service-role client without authenticating the request. Its search returns agent and application name/email/phone data (`:37-125`), its load action reads any supplied agent/date (`:129-144`), and submit overwrites any supplied agent/date (`:146-203`).
- `supabase/functions/create-agent-from-leaderboard/index.ts:30-50` accepts a caller-supplied existing agent ID with no caller validation. It can create/link an auth user, reactivate the agent, grant the agent role, mint a magic-login token, and send email (`:67-280`).
- `supabase/functions/notify-production-submitted/index.ts:45-54` also has no caller validation and can send client-authored push/email notifications to Sam and a manager (`:56-177`).
- Safe live probes, with no credentials and non-mutating invalid/short bodies, returned HTTP 200 from `log-production` and HTTP 400 from `create-agent-from-leaderboard`, proving both reach application code anonymously.
- `src/pages/LogNumbers.tsx:197-210` does not even match the provisioning function: the UI omits required `agentId`, while the function response omits the `agentId` the UI requires. The new-agent branch cannot succeed through the UI.

### Required fix

1. Set all three functions to JWT verification and independently authenticate inside the function. Do not treat the gateway setting as the authorization policy.
2. Normal agents may load/write only their canonical agent row. Managers may access their verified downline. Broad search and account provisioning must be admin-only.
3. Make provisioning one explicit request/response contract and add a role-bound contract test. Do not reactivate an existing agent merely because its ID was submitted.
4. Move notification creation behind the accepted server-side submit and derive agent/name/totals server-side. The client must not be able to select recipients or author reported money.

### Acceptance

Anonymous calls return 401; an agent receives 403 for another agent; a manager is limited to downline; admin provisioning returns the created/linked agent ID; no search response exposes application PII outside the authorized recruiting scope; notification replay is idempotent.

## P1 — production truth is split across four ledgers

### Live evidence

For the current August window:

- `v_production_unified`: 66 policies / **$93,960.48**.
- `leaderboard_book_hero`: 59 policies / **$85,062.12**.
- `leaderboard_board` named rows plus “Unclaimed production”: 76 policies / **$197,592.48**.
- `daily_production`, 2026-08-18 through 2026-08-24: 14 closes / **$104,433.72**, versus 15 policies / **$21,902.52** in `v_production_unified` for the same dates.
- `daily_production` also contains two future-dated production rows (2026-08-28 and 2026-09-01) totaling $2,886.96, inherited from deal effective dates rather than the day activity was logged.

### Root cause

- `supabase/migrations/20260823120000_apex_home_dashboard.sql:49-63` reads raw `agentlink_book`; the uncommitted `20260825060000_home_daily_production_truth.sql:33-56` fixes the home function only.
- `supabase/migrations/20260823050000_leaderboard_ghost_collapse.sql:17-75` reads raw `agentlink_book` and deliberately appends the ghost total. `leaderboard_book_hero` filters roster exclusions, so its headline cannot reconcile with those rows.
- `src/pages/AgentCommandDashboard.tsx:926` and `:1010` still aggregate `v_agentlink_book_scoped`; `supabase/migrations/20260820190000_finances_overview_rpc.sql:52-86` still builds estimates from raw `agentlink_book`.
- `supabase/migrations/20260420021223_98c8f610-65ea-482f-8d73-65e81c0510fa.sql:223-240` writes deal money into `daily_production`, while `log-production` later upserts the same row with client-entered ALP and closes. Either path can overwrite or inflate the other.
- The post-submit leaderboard and production email both rank/summarize `daily_production.aop`, so an agent sees a different scoreboard immediately after submission than on the main leaderboard.

### Required fix

Use `v_production_unified` as the sole ledger for ALP/policy counts across home, production, command dashboards, leaderboards, and any clearly labeled production estimates. Keep `daily_production` authoritative only for activity fields such as presentations, pages called, and referrals. Remove money/close inputs from the generic activity upsert or split the table so the client cannot overwrite deal-derived columns. Make every headline the exact sum of the displayed rows; if unclaimed production remains visible, include it in the headline and include native deals in both.

Add one cross-surface SQL contract for a fixed Phoenix date window and fixtures covering a native deal, an AgentLink deal, a duplicate, a roster-excluded agent, an unclaimed row, and a future effective date.

## P1 — “live” polling is effectively disabled

There are 63 occurrences in 28 source files of:

```ts
refetchInterval: 300_000 * 60_000
```

That is 18,000,000,000 ms, approximately 208 days, not five minutes. It affects `BusinessAnalytics`, `DashboardToday`, `AgentCommandDashboard`, manager/VA boards, recruiting widgets, health alerts, and next-step queues. `src/pages/Dashboard.tsx:981` is one direct example.

Replace the expression with a named five-minute constant or `300_000`, verify realtime-backed queries separately, and add a static guard that rejects multiplied millisecond literals. Test with fake timers that a representative live query refetches after five minutes.

## P1 — training excludes the people most in need of follow-up

- Live canonical roster: 27 agents.
- Active modules: 4.
- Roster agents with progress against those modules: 16; never started: 11; complete: 7.
- `supabase/migrations/20260823090000_apex_training_roster_scope.sql:91-105` starts its aggregate from `onboarding_progress`, so the 11 agents with no row disappear rather than count as not started.
- The nudge function repeats the same inner aggregation at `:154-170`; it cannot nudge someone who never started.
- `src/components/training/RequiredOnboardingResources.tsx:28-32` tells every agent that `$50K/month producer training` is required, but links to `/dashboard/recruiting/training/content`. `src/App.tsx:474` limits that route to admin/manager/VA roles.

Start the rollup and nudge list from the scoped roster and left join progress. Count zero-row agents as not started and rank null activity first. Point the required resource at an agent-accessible course/library target; do not weaken the staff content-management gate. Add regular-agent and zero-progress roster tests.

## P1 — interviews have two transition policies and two ledgers

- The current command center uses `interviews-pipeline`, with scoped roles, stage/action allowlists, optimistic versioning, and activity receipts.
- The still-deployed `interviews-outcome` function accepts any authenticated admin/manager/VA and updates any supplied `hh_applicants` ID through service role. It does not enforce VA ownership, legal state transitions, version preconditions, or canonical activity receipts. Its no-show mapping also differs from the canonical endpoint.
- `assistant-add-interview` writes `manual_interview_entries`, then performs a best-effort mirror into `hh_applicants`. Mirror failure is only returned as a warning; there is no durable reconciliation outbox, and no token-scoped idempotency/rate limit.
- Live state: 252 `interview_events`; 229 past and still open; 136 unmatched to an application; 127 both past/open and unmatched. `manual_interview_entries` has 83 past rows, all application-linked, none confirmation-stamped, and no assistant-token rows. `hh_applicants` has 319 active rows, 302 at `appointment_set`.

Retire `interviews-outcome` or make it call the same authorization/transition primitive as `interviews-pipeline`. Make assistant ingestion idempotent and durable, and reconcile `manual_interview_entries`, `hh_applicants`, and `interview_events` through one canonical interview identity. After code is fixed, run a reviewed data-repair plan for the 229 open past events; do not bulk-disposition them automatically.

## P1 — contracting delivery is implemented but not proven in production

The current five-field intake, idempotency key, honeypot/rate-limit checks, destination receipts, and Sheet/Discord adapters have passing tests. Required setting keys exist. Production nevertheless has zero `contracting_intakes` and zero `contracting_intake_deliveries`, so neither provider has a real receipt to verify.

The uncommitted `supabase/migrations/20260825060000_home_daily_production_truth.sql:149-241` combines an unrelated home-dashboard function change with a one-time active-roster intake backfill and inserts queued outbox events. Applying it will cause external delivery. Split this into:

1. a side-effect-free home/truth migration;
2. a read-only contracting reconciliation preview reporting eligible, invalid, duplicate, already-delivered, and by-destination counts;
3. a separately approved execution migration/job with a capped first batch, idempotency proof, and receipt verification.

Do not use existing roster members as silent substitutes for a real recruit intake unless the business owner explicitly approves that outbound.

## P2 follow-ups

- `AgentCloudHome.windowFor` uses today minus 30/90 through tomorrow-exclusive, producing 31/91 calendar dates for labels “Last 30/90 days” (`src/components/dashboard/AgentCloudHome.tsx:63-64`).
- `BoardLive` ignores the RPC error and renders zeros (`src/pages/BoardLive.tsx:64-81`). The postable board must fail visibly rather than publish a false zero.
- Agent identity selection is inconsistent: `TrainingPathPanel` and `Dashboard` take the newest agent row, while `MyDeals` takes the oldest. Live data has one duplicated `user_id` pair, currently not two active rows, but all consumers should use the canonical resolver.
- Only 4 of 15 legacy onboarding modules are active. This is not itself an error, but the required-resource list and tracked completion path should be one declared curriculum.
- The onboarding email queue has 129 rows: 126 sent and 3 intentionally blocked because the agent is unlicensed. Those three will be retried until attempt 5 and remain operational noise; record a terminal `skipped_wrong_cohort` state or remove invalid queued rows through a reviewed repair.
- The home date/RPC query has no periodic refetch. If “live” means unattended display, add the same named polling policy used elsewhere.

## Review of concurrent uncommitted changes

Present during the audit and not authored or modified by this worker:

- `supabase/migrations/20260825060000_home_daily_production_truth.sql`
- `src/components/dashboard/AgentCloudHome.tsx`
- `src/pages/StartContracting.tsx`
- `src/tests/components/StartContracting.test.tsx`
- `scripts/check-native-deals.mjs`

The home switch to unified production and explicit Phoenix daily cards are directionally correct. The Discord CTA has a focused test. These changes do not close the P0 functions, Daily Numbers write collision, leaderboard mismatch, training omission, interview split, or 208-day polling. The migration's external-delivery backfill is a release blocker until separated and explicitly approved.

## Verification performed

- Targeted Vitest: 10 files, 138 tests passed, covering contracting UI/delivery/intake/guard, protected routes, training nav, AgentCloud parity, interview pipeline contract, and deal truth.
- `npm run build`: passed.
- `npm run smoke:prod`: 37/37 routes passed, including `/start-contracting`, `/training`, and `/apex-daily-numbers`.
- Passed guards: metric truth, native deals, function contracts at baseline, sync reliability, Discord PII, sidebar routes, internal navigation, and migration versions.
- Raw `npm run typecheck:fast`: failed with the repository's existing broad TypeScript error set. The authoritative `npm run check:tsc-error-count` ratchet passed at 222/222 errors, so this worktree introduced no error-count regression while the baseline debt remains.
- Read-only production REST checks confirmed book freshness through 2026-08-24 and last import at 2026-08-25T05:50:31Z.

## Verification blockers

- The configured bot-SQL token returns Unauthorized; the existing service credential was used read-only instead.
- No in-app browser instance is available, so authenticated role-by-role visual QA could not be performed. Route smoke validates HTTP shells, not signed-in content, responsive layout, or interaction behavior.
- Contracting has no production intake/delivery receipt. A real end-to-end proof would send to external systems and was intentionally not attempted.

## Claude implementation order

1. Contain the three public production/provisioning functions and add negative authorization tests.
2. Separate the outbound contracting backfill from the home migration; do not deploy the backfill without explicit approval.
3. Unify production money/policy counts and remove money from the manual activity write path; enforce cross-surface reconciliation.
4. Fix the 63 polling expressions and add a guard.
5. Fix training zero-progress inclusion and agent resource access.
6. Collapse interview writes onto the canonical transition and reconciliation path.
7. Re-run targeted tests, full guard ratchet, build, production route smoke, then authenticated admin/manager/agent/VA browser QA before deploy.
