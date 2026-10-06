# §10 Contracting: carrier cases (implementation note)

Branch `apex-os/contracting-cases`. Migration `supabase/migrations/20261006100000_contracting_carrier_cases.sql` is **not applied**. It was proven against prod inside a rolled-back transaction (see Evidence).

## What changed
- **Data**: one case per (agent, carrier). Built on the live upstream `agentlink_roster.carriers`, filtered to live canonical non-placeholder agents. The tracking layer holds only what AgentLink cannot know. There is no copy of the status and no parallel contracting database.
- **UI**: new **Cases** tab at `/dashboard/contracting/cases` (admin, va_manager, va; same guard as `/ethos`), rendered by `CarrierCasesWorkspace`. `ReadyToWriteCard` is added to `AgentProfileDrawer` and to both `ProducerProfile` views (any agent, and the viewer's own profile).
- **Shared hooks touched (minimal)**: `src/App.tsx` (+1 route line); `src/pages/CarrierContracts.tsx` (mode, nav item, title/subtitle, render); `AgentProfileDrawer.tsx` and `ProducerProfile.tsx` (import plus one card line each).

## Data model
| Object | Kind | Purpose |
|---|---|---|
| `v_contracting_carrier_cases` | view, `security_invoker=true`, no direct grants | One row per (agent, carrier). Includes lifecycle, blocker plus its source, waiting_on, owner plus owner_source, verification source/date/evidence, `days_in_state` with a lower-bound flag, `presubmit_missing[]`, and `q_*` queue booleans. |
| `contracting_case_tracking` | table, RLS (staff read), unique (agent_id, carrier_name) | Owner, next action, follow-up date, waiting-on and blocker overrides, note, carrier stage (`carrier_review`/`approved`), close plus reason, and manual verification (CHECK: source **and** evidence required). |
| `contracting_case_events` | table, append-only (trigger refuses UPDATE/DELETE) | Before/after of every staff change, plus `agentlink_status_changed` rows written by the sync observer. |
| `agentlink_carrier_status_observations` | table | When each (AgentLink person, carrier) status was first seen. Seeded rows are flagged `observed_since_is_lower_bound`. |
| `trg_observe_agentlink_carrier_statuses` | AFTER INSERT/UPDATE OF carriers on `agentlink_roster` | Records status changes. It is wrapped in EXCEPTION so it can never roll back the sync. |
| `contracting_carrier_cases(p_agent_id)` | RPC, SECURITY DEFINER | Without an argument it returns cases in `fn_contracting_checkin_scope()`. With an agent id it returns that agent's cases if the caller has that scope or passes `apex_can_read_agent()`, which covers self and upline. |
| `contracting_update_case(p_agent_id, p_carrier, p_patch)` | RPC, SECURITY DEFINER | Scope comes from `fn_contracting_checkin_scope` (admin, va, va_manager, manager-of-agent). Verify, unverify, carrier_stage and close are restricted to staff. Unknown keys are refused, and every change is logged before/after. |
| `contracting_case_owner_options()` | RPC | Lists internal staff and manager accounts for the owner picker. |
| `contracting_case_history(p_agent_id, p_carrier)` | RPC, SECURITY DEFINER, same scope as the writer | Returns the last 50 events for the dialog's History: staff changes with actor names, plus AgentLink sync status changes. |
| `contracting_exception_digest()` | RPC (staff) | Returns cases and people per queue plus the 5 oldest per queue. `system_settings.contracting_digest_enabled='false'`. **No sender is wired.** |

### Lifecycle map (`src/lib/contractingCases.ts` and the SQL block between `lifecycle-map:start/end`)
| AgentLink status | Lifecycle | Derived blocker | Waiting on |
|---|---|---|---|
| active | Verified Ready to Write (source "AgentLink sync" plus synced_at) | none | none |
| submitted | Submitted | none | carrier |
| ready_to_contract | Ready to Submit | none | staff |
| requested | Not Started | upline approval | upline |
| pending_upline_assignment | Setup / Documents | missing comp/upline | upline |
| incomplete_profile | Setup / Documents | missing documents | agent |
| issue | Additional Requirements | carrier issue | staff |
| jail | Additional Requirements | carrier issue | staff |
| rejected | Declined | none | none |
| anything else | Unknown (needs review) | none | staff (Support queue, never approved) |

Carrier Review and Approved are only reachable as a staff-recorded carrier stage while AgentLink says `submitted`. Closed is a staff action with a reason, and it is refused on an AgentLink-active contract. A manual Verified Ready to Write needs a source and an evidence reference, and it is refused while AgentLink shows rejected/issue/jail. The AgentLink "active" status always wins.

### Queues (decided in SQL; counts are carrier cases, with people counted separately; queues overlap)
| Queue | Rule |
|---|---|
| Agent Action | waiting on the agent |
| Staff Action | waiting on staff or the upline |
| Support | access, agency, release, existing-relationship or carrier-issue blockers, or an Unknown status |
| Carrier Review | Submitted or Carrier Review |
| Follow-Up Due | follow-up date is on or before today (Phoenix) |
| Ready to Submit | lifecycle is Ready to Submit |
| Verified | lifecycle is Verified Ready to Write |

The "terminal" lifecycles (verified, declined, closed) leave every action queue. Departed people drop out of the view entirely: `contracting_checkins.left_at`, inactive or deactivated agents, and roster exclusions are all excluded. Their tracking and event history is kept.

## Workflow trace
Staff opens a Cases row and clicks **Update**. The dialog calls `contracting_update_case`. Authorization comes from `fn_contracting_checkin_scope`, with per-key staff gating. The RPC upserts `contracting_case_tracking` and inserts a `contracting_case_events` row with before/after. The query invalidates and the row moves queue, because the `q_*` columns are recomputed. History appears in the dialog from the events log.

On the sync side, an `agentlink_roster` write fires the trigger. It updates the observation and logs an event only when a status actually changes. Adding a note never resets the age.

## Evidence
All of the following ran against prod in **one transaction that was rolled back**. Afterwards `to_regclass` of the new objects was null and the trigger and flag were absent.
- View: 208 cases across 25 people. By lifecycle: verified 103, submitted 45, setup/docs 22, not started 17, declined 12, ready 7, additional reqs 2, unknown 0. `verified_without_source` = 0. Match basis (people): agentlink_id 14, email 8, name 3.
- Queues: agent 13 cases / 2 people, staff 35/18, support 2/2, carrier review 45/19, ready 7/5, verified 103/22, follow-up 0.
- As Sam (admin): 208 rows. Assigning owner, follow-up and carrier stage gave lifecycle `carrier_review`, owner "Samuel James" (assigned), and follow-up due true. Verify without evidence was **refused**. Verify with source and evidence gave Verified, source "Carrier portal". Verify on a rejected carrier was **refused**. Unknown key `status` was **refused**. Editing events as owner was **refused** (append-only trigger). The digest returns `enabled=false`.
- As a VA: 208 rows through the RPC. A direct SELECT on the view is refused.
- As a plain agent: the all-cases list returns 0 rows (empty scope). Their own profile returns 6 carriers. The digest and update are **refused**.
- History RPC as Sam → `verify:staff:Samuel James, update:staff:Samuel James`; as a plain agent → **refused**.
- History RPC: as Sam it returns `verify:staff:Samuel James, update:staff:Samuel James`. As a plain agent it is **refused**.
- Trigger: a sync write changing one carrier `active→issue` produced an observation with `previous=active`, `lower_bound=false`, and one `agentlink_status_changed` event.
- Tests: `npx vitest run src/tests/lib/contractingCases.test.ts src/tests/components/CarrierCasesWorkspace.test.tsx` gives 20/20. The parity test was mutation-proven: changing `jail` to verified in the SQL block made 2 tests fail.
- `tsc -b --force`: 82 errors, the same as the baseline.

## What remains / honest limits
- **Coverage**: only 25 of 57 strict-active agents link to an AgentLink roster entry (14 by `al_user_id`, 8 by email, 3 by name). Agents with no AgentLink link have no cases. They still appear in the existing check-in and audit surfaces. Name and email links are labelled in the UI and fail the `identity` pre-submission check.
- **days_in_state**: there is no upstream history. Ages are lower bounds ("≥ Nd") from the seed time until the trigger sees a real change.
- **Pre-submission check** covers identity, NPN (and mismatch), agency approval, upline and comp level. Carrier-specific requirements are not in any record and still need a human.
- **Notifications** (John Ray, reminders, escalation) are **not built**. The digest is data-only behind a flag that defaults off. Miguel Ramirez has no `agents` row, so there is nothing to exclude. Aisha Kebbeh is live with no newer evidence, so nothing was reopened.
- **Catalogs**: `check:rpc-args` and `check:rpc-status-literals` fail only because `contracting_carrier_cases`, `contracting_update_case`, `contracting_case_owner_options` and `contracting_case_history` are not in the regenerated catalogs yet. `types.ts` was not edited (casts are used).
