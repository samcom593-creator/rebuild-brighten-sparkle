# §6 implementation: Recruit Stages, No Hire Left Behind, expected start

Branch `apex-os/recruit-stages-nhlb`. The migration has **not** been applied to prod. It was proven inside a transaction that rolled back (see Evidence).

## What changed

| File | Change |
|---|---|
| `supabase/migrations/20261006110000_expected_start_tracking.sql` | New `agent_start_plans` table (expected start and outcome, 1:1 with `agents`). New RPCs `set_expected_start`, `record_start_outcome`, `record_onboarding_call_outcome`, `request_onboarding_call_booking` and `onboarding_exception_facts`. The `agent_stage_moves.field` CHECK gains `expected_start` and `start_outcome`. EXECUTE on `fn_enqueue_onboarding_call_booking` is revoked from PUBLIC and anon. |
| `src/lib/onboardingExceptions.ts` | A pure derivation: facts row → open requirements (track, exact gap, why it matters, owner, waiting since, next action, resolution). |
| `src/components/onboarding/useOnboardingExceptionFacts.ts` | One query to `onboarding_exception_facts()`. Realtime on agents, onboarding_progress and contracting_intakes, coalesced at 2s, plus a 5-minute poll. |
| `src/components/onboarding/OnboardingExceptionQueue.tsx` | The queue table. Compact mode for the panel, full mode for the page with track chips, owner filter and search. One row per hire, led by its most urgent item; the other items expand underneath. |
| `src/components/onboarding/ExceptionResolution.tsx` | The direct resolution control for each requirement. |
| `src/components/onboarding/ExpectedStartControl.tsx` | Popover for the expected start date and status, plus Attended / No-show / Rescheduled. |
| `src/components/recruiting/NoHireLeftBehindPanel.tsx` | Was 4 tiles and 6 names. Now the exception queue (compact, top 8). Same export, no props, so `DashboardApplicants` is untouched. |
| `src/pages/OnboardingLadder.tsx` | Now the full exception queue. The 8-rung chain is gone (see D1/D2/D3). The "Licensed, then went inactive" list stays. "Active, never made a first sale" is folded into the queue. |
| `src/pages/RecruitPipeline.tsx` | Keeps the stage view and every action. Adds expected start (an editable chip) and an open-items count on agent rows, adds open items to the header count, uses `PageSkeleton` for loading, supports a `?q=` deep link, and replaces rose/amber/emerald literals with semantic tokens. |
| `src/tests/lib/onboardingExceptions.test.ts` | 26 tests: the derivation rules plus assertions on the migration text. |
| `src/tests/lib/hireMonitoringRecruitingIncome.test.ts` | The NHLB contract was updated to the queue. It now asserts the notification-gap tile is gone. |

No edits to App.tsx, the navigation, DashboardApplicants, types.ts, the catalogs or package.json.

## Data model

**`public.agent_start_plans`** (PK `agent_id` → `agents.id`):
- `expected_start_on date`
- `expected_start_status`, with a CHECK limiting it to `confirmed`, `likely`, `awaiting_response` or `not_attending`
- `expected_start_note`, `expected_start_set_at` and `expected_start_set_by`
- `start_outcome`, with a CHECK limiting it to `attended`, `no_show` or `rescheduled`
- `start_outcome_on`: the expected date the outcome refers to. An outcome counts as current only while it equals `expected_start_on`.
- `start_outcome_note`, `start_outcome_at` and `start_outcome_by`

RLS select uses `fn_recruit_scope_ok(null, agent_id)`. There are no write policies; only the RPCs write. Verified: a plain agent sees 0 rows and a direct INSERT gets 42501.

**Why a side table instead of new columns on `agents`.** The hire does live on `agents`, which is why the plan is keyed 1:1 on `agents.id`. But any UPDATE to `agents` has side effects, measured from `pg_trigger`:
- `update_agents_updated_at` bumps `updated_at`, and `recruit_pipeline_list` shows `coalesce(last_contacted_at, agents.updated_at)` as "last contacted". Writing an expected start onto `agents` would therefore fake a contact.
- `trg_truth_dirty` runs FOR EACH STATEMENT on every UPDATE and marks the production truth dirty.

The headcount report (03) suggested `applications.expected_start_on`. A hire's record is the agent, so `headcount_summary().projected_starts` should read `agent_start_plans`, filtered to `expected_start_status in ('confirmed','likely')` with a future date. It must never be added to current headcount.

**Actual outcome.** A start outcome lives on the plan. An onboarding call's outcome stays on the existing record, `interview_events.outcome` (`call_track='onboarding'`). That table's CHECK has no `attended`, so Attended is stored as `completed`.

**No-show never becomes departed.** None of `set_expected_start`, `record_start_outcome` or `record_onboarding_call_outcome` writes `agents.status`, `is_inactive` or `is_deactivated`. The migration test asserts this, and the rolled-back proof checked status, both flags and `updated_at` before and after a no-show: unchanged.

**Hired / active / inactive / departed / declined today.** These are documented in the migration header and not changed:
- hired: an `agents` row exists.
- active: `status='active'` and neither flag is set.
- inactive: `is_inactive`.
- departed: `is_deactivated`.
- declined: applicant side only (`rejected`, `disqualified`, Next Step `closed_lost`).

The one place two of these are conflated is `mark_no_longer_with_us`. It sets `status='inactive'`, `is_inactive` and `is_deactivated` together and never writes `deactivation_reason` (audit D8). That RPC belongs to the contracting check-in flow, so it is left as an open item rather than changed here.

**Audit.** Every expected-start or outcome write inserts an `agent_stage_moves` row (`field` = `expected_start` or `start_outcome`, `from_value` and `to_value` as `status@date`). Nothing in `src/` reads `agent_stage_moves`, so widening its CHECK breaks no reader.

## Exception model (src/lib/onboardingExceptions.ts)

The tracks run in parallel. Each requirement has explicit prerequisites (`REQUIREMENT_PREREQUISITES`), and these are tested.

| Track | Requirement keys | Waits on | Authoritative record |
|---|---|---|---|
| contracting | intake_missing, intake_review, documents_missing (E&O and EFT), carrier_pending, carrier_none | licensed, not producing (carrier: intake accepted) | `contracting_intakes`; `agents.eo_certificate_url` / `eft_ready`; the intake's E&O and EFT; `agent_documents` (eo_certificate, voided_check); `apex_carrier_contracts` plus `agent_carrier_comp` |
| licensing | license_pending, npn_comp_missing | none / licensed | `agents.license_status`, `fn_agent_licensing_ready` |
| access | account_missing, never_signed_in, profile_missing, dialer_missing | account / licensed | `agents.user_id`, `auth.users.last_sign_in_at`, `magic_login_tokens.used_at`, profile, `has_dialer_login` |
| training | training_not_started, training_incomplete | a required catalog exists | `v_training_required_completion`, `onboarding_progress` |
| start | onboarding_call_unbooked / _outcome / _no_show; start_not_set / _awaiting / _unconfirmed / _not_attending / _outcome_missing / _no_show | not producing | `interview_events` via `fn_agent_onboarding_call_booking`, `agent_start_plans` |
| production | first_deal_missing | carrier active | `agents.first_deal_at` |

The rules, each tested:
- Contracting never waits on training, Slack, the onboarding call or the expected start. A property test runs 2×2×5 combinations.
- Slack never produces an exception.
- Training completion never satisfies carrier authorization, and an accepted intake is not an appointment.
- A login is one requirement, not "onboarding complete".
- Unknown never becomes zero: no timestamp gives "unknown", and no required-training catalog gives no training verdict.
- A producer is never asked about starts, carriers, intake, documents or the dialer. A first deal is evidence of appointment, so those become records gaps rather than blocks.
- Owners are never invented: an empty value shows "Unassigned" (styled red), and contracting items say "Contracting team".
- Time waiting is measured from the receipt that opened the gap: hire for access, the later of hire and license for contracting, the intake date for carrier, last course activity for training, and the set time or date for start items.
- Last outreach is the latest real receipt from three sources:
  - `next_step_messages` with sent_at, external_id and no failure ("Next-step sms/email sent")
  - `agent_onboarding_queue` with `sent_at` and `resend_message_id` ("course email sent", etc.)
  - `magic_login_tokens` ("Login link issued")
  Queued rows never count.

## Workflow traces

- **Set an expected start** (Recruit Stages chip or queue row): ExpectedStartControl → `set_expected_start` → `auth.uid()` + `fn_recruit_scope_ok` (admin/va_manager/va all; manager in scope) → validates status and date (±365d) → upserts `agent_start_plans` → `agent_stage_moves` row → client invalidates `onboarding-exception-facts` → queue and Recruit Stages re-render.
- **Record a start outcome**: → `record_start_outcome`.
  - attended / no_show: refused before the Phoenix date. When accepted, it stamps the outcome against the current date.
  - rescheduled: moves `expected_start_on` and sets the status to `likely` (with a new date) or `awaiting_response` (without one).
  - Each outcome writes an audit row. Employment is untouched.
- **Send login link**: `send-agent-portal-login` (existing; admin and manager only, the edge function returns 403 to a VA, so the UI falls back to Open record). Confirm dialog → toast says "accepted by the email provider; delivery not confirmed". The row clears only on an actual sign-in.
- **Send booking link**: `request_onboarding_call_booking` → scope check → existing `fn_enqueue_onboarding_call_booking` → verdict shown verbatim ("queued" ≠ sent; `booking_exists` / `already_sent` / `not_licensed` explained).
- **Onboarding call outcome**: `record_onboarding_call_outcome` → only for `call_track='onboarding'`, scoped by the event's agent (admin-only when unlinked), and refused before the call time for attended/no_show.
- **Contracting / training / license items**:
  - Contracting opens `/dashboard/contracting` for admins and the agent drawer for everyone else (that route is admin-only).
  - Training opens `/dashboard/training/progress`.
  - License opens `/dashboard/recruits?q=<name>`, where `LicenseProgressSelector` lives.

## Evidence

**Rolled-back proof against prod.** The payload was `begin; <migration>; …; rollback;` through bot-sql, with roles switched via `set local role authenticated` and JWT claims:

```
facts_admin_rows: 57   facts_admin_distinct: 57 (no fan-out)   facts_va_rows: 57   facts_manager_rows: 7 (John Riley's downline)
facts_plain_agent: 42501   facts_anon: 42501 permission denied   set_start_plain_agent: 42501
set_bad_status: 22023   set_confirmed_no_date: 22023   outcome_before_plan: 22023   attended_future: 22023
set_future_confirmed/set_past_confirmed/no_show_past/rescheduled_new_date: ok
plan_after_reschedule: {"on":"2026-10-11","status":"likely","outcome":"rescheduled","outcome_on":"2026-10-05"}
rls_plans_va: 1   rls_plans_plain_agent: 0   plain_agent_direct_insert: 42501
audit_rows: expected_start:null=>confirmed@2026-10-09 | expected_start:…=>confirmed@2026-10-05 | start_outcome:none@…=>no_show@2026-10-05 | start_outcome:no_show@…=>rescheduled@2026-10-05->2026-10-11
employment_unchanged: true
enqueue_grants (inside txn): authenticated, postgres, service_role (anon/PUBLIC revoked)
```

After the rollback, prod still has no `agent_start_plans` and no `onboarding_exception_facts()`, and the `agent_stage_moves` CHECK is unchanged.

**The live derivation.** The real `buildExceptionQueue` ran over the 57 live facts rows (counts only, names never written to disk in the repo):
- 57 hires have open items. 43 are blocked from writing business.
- By track:
  - contracting 24
  - licensing 20
  - start 39
  - access 33
  - training 52
  - production 0
- Primary requirement for each hire:
  - documents_missing 18
  - license_pending 16
  - training_incomplete 12
  - intake_missing 5
  - intake_review 1
  - npn_comp_missing 1
  - account_missing 1
  - never_signed_in 1
  - onboarding_call_outcome 1
  - training_not_started 1
- Waiting time is unknown on 0 items, and 1 hire has no owner.
- The old view could name contracting as the block for 0 rows. Measured, 24 hires now show a contracting item.

**Population.** 57 hires are counted, not 83 or 84. The difference is the 26 rows whose `agents.status` is neither active nor pending, which the old view still counted (audit D5).

**Tests and checks:**
- `npx vitest run src/tests/lib/onboardingExceptions.test.ts src/tests/lib/hireMonitoringRecruitingIncome.test.ts`: 29/29.
- Mutation proof: gating the contracting block on `training_started` turned 2 tests red (D1 regression + parallel property). Reverted afterwards.
- tsc: 82 errors, the baseline.

## Open items (not done here, by design or by ownership)

1. **Apply the migration** and regenerate types and catalogs (`refresh-rpc-catalog.sh`, `refresh-rpc-column-vocabulary.sh`, column/relation catalogs). Until then `check:rpc-args` and `check:rpc-status-literals` fail only because the 5 new RPCs are absent from the snapshots.
2. **Carrier authorization has no populated record.** `apex_carrier_contracts` has 21 rows, 0 of them linked to an agent, last synced 2026-06-10. `agent_carrier_comp` has 720 rows, all `not_started`. So `carrier_none` on 18 licensed, non-producing hires is a true statement about the records. The contracting section owns the fix.
3. **E&O / EFT.** 24 licensed, non-producing hires have neither on file anywhere. The required-document set (E&O + EFT) is an assumption to confirm with Sam (audit open question 1).
4. **`cc_dispose_interview` is EXECUTE for PUBLIC and anon with no role check.** This is a security finding for the calendar/call-center owner; the new onboarding-call outcome uses its own scoped RPC instead.
5. **D8 (`mark_no_longer_with_us` collapses inactive and departed) and D10 (`set_recruit_stage` writes `onboarding_stage` outside `agent_stage_moves`) remain.** Both are owned outside this section's file set.
6. **Realtime publication.** `onboarding_progress` and `contracting_intakes` are not in `supabase_realtime` (per `scripts/realtime-coalesce-baseline.json`), so only `agents` events fire. The 5-minute poll and the invalidation after every action cover the rest. That baseline file still names the old panel's subscriptions; they are tolerated, not new.
7. **Optional cleanups:**
   - The nav label "Onboarding Ladder" (`agentCloudNavigation.ts`) could read "Onboarding queue".
   - `check:brand-literals` can lower its baseline from 509 to 508 (the page title stopped hardcoding the brand).
