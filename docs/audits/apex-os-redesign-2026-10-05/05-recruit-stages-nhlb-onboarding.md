# 05 — Recruit Stages, "No Hire Left Behind", and the onboarding ladder

Domain mapper report for the APEX OS redesign (brief §6, plus the parts of §5/§7/§9 that touch the hire ladder).
Repo `rebuild-brighten-sparkle` @ `4ea291c8` (main). Live DB `xrzweoneiieddzxogewk`, measured 2026-10-05 via Supabase MCP `execute_sql` (read-only). Read-only mapping; nothing in the repo was changed except this file.

Conventions: `rows` = database rows, `people` = distinct canonical agents (`canonical_agent_id IS NULL`, not a placeholder, not deactivated/inactive). "live canonical" = that predicate. Anything not measured is marked **unmeasured**.

---

## 1. What exists

### 1.1 Routes and pages

| Route | Component | Guard (App.tsx) | Notes |
|---|---|---|---|
| `/dashboard/recruits` | `src/pages/RecruitPipeline.tsx` ("Recruit Stages") | `App.tsx:606` requireAdmin + managers + va_manager/va | Nav label "Recruit Stages" `src/components/layout/agentCloudNavigation.ts:147` |
| `/dashboard/recruiting` (+ `/hires`) | `src/pages/DashboardApplicants.tsx` ("Recruit Pipeline", applicants kanban/list) | `App.tsx:494`, `:498` (+recruiter) | Hosts `NoHireLeftBehindPanel` at `DashboardApplicants.tsx:1241` (admin/manager/VA). Nav `agentCloudNavigation.ts:148` |
| `/dashboard/onboarding-ladder` | `src/pages/OnboardingLadder.tsx` | `App.tsx:616` requireAdmin + managers + va_manager/va | "Work full queue" target of NHLB (`NoHireLeftBehindPanel.tsx:82`) |
| `/dashboard/agent-pipeline`, `/recruit-pipeline`, `/dashboard/recruit-pipeline` | `src/pages/AgentPipeline.tsx` ("My Pipeline") | `App.tsx:684-685` plain ProtectedRoute | Brief's starting page. A third, applications-table kanban keyed on `license_progress` (guarded by `scripts/check-kanban-stage-vocabulary.mjs`) |
| Agent profile drawer | `src/components/dashboard/AgentProfileDrawer.tsx:923` → `AgentOnboardingCommandCenter` | — | 8-chip "onboarding" strip, mostly entitlement flags |
| Agent portal / command dashboard | `src/pages/AgentPortal.tsx:473`, `src/pages/AgentCommandDashboard.tsx:383` → `AgentOnboardingStepper` | agent | Agent-facing 12-step roadmap from RPC `apex_agent_onboarding_roadmap` |
| CRM home | `src/pages/DashboardCRM.tsx:2182` → `JustHiredPanel` | staff | RPC `get_just_hired_30d` (created_at ≤ 30d) |
| Hire stage control (MP-356/392) | `src/components/hires/HireStageControl.tsx` mounted in `AgentProfileDrawer`, `AgentManagement`, `AgentCommandDashboard`, `BuildersDashboard`, `DashboardAccounts`, `ProducerProfile` | `fn_can_move_hire` | RPC `advance_hire_stage` (`HireStageControl.tsx:105`) |
| Legacy stage tracker | `src/components/dashboard/OnboardingTracker.tsx` | — | Writes `agents` timestamps directly (`:98`), invokes `notify-stage-change` (`:117`) and `send-agent-portal-login` (`:137`) |

### 1.2 Tables, views, RPCs, jobs (with where they are defined)

**Tables (authoritative or candidate):**
- `agents` — `onboarding_stage` (enum `onboarding_stage`: applied, meeting_attendance, pre_licensed, transfer, below_10k, live, need_followup, inactive, pending_review, onboarding, training_online, in_field_training, evaluated), `status` (enum `agent_status`: active, inactive, pending, terminated), `is_inactive`, `is_deactivated`, `deactivation_reason` (enum: bad_business, inactive, switched_teams), `license_status` (licensed, unlicensed, pending), `license_progress`, `nipr_number`, `comp_percentage`, `contracted_at`, `first_appointment_at`, `has_training_course`, `has_discord_access`, `has_dialer_login`, `field_training_started_at`, `onboarding_completed_at`, `first_deal_at`, `stage_changed_at`, `next_action_due_at`, `next_step_stage_key`, `start_date`, `attendance_status` (enum good/warning/critical), `user_id`, `profile_id`, `canonical_agent_id`, `metadata` (holds hand-entered `resident_state`).
- `next_step_progress` / `next_step_stages` / `next_step_events` — the 19-stage Next Step Engine (applied → first_10k_week, closed_lost terminal). `next_step_stages` rows measured live (sort 01–19, 99); `booked_seminar`/`attended_seminar` retired.
- `agent_stage_moves` — audit of `advance_hire_stage` (1 row lifetime).
- `interview_events` — Calendly/booking truth table; `call_track` CHECK includes `'onboarding'` (`supabase/migrations/20260826052000_onboarding_calls_live.sql:34-36`); columns `scheduled_at, canceled_at, confirmed_at, was_rescheduled, outcome, outcome_at, outcome_by, invitee_status, followup_due_at, agent_id, application_id`.
- `onboarding_call_invites` — .ics METHOD:REQUEST/CANCEL rows to Milver (`20260826052000:103-135`), `status in ('queued','sent','failed','skipped')`, `resend_message_id` is the delivery receipt.
- `agent_onboarding_queue` — email outbox, `email_kind in ('course','discord','hired_whatsapp','onboarding_call','get_licensed')`.
- `apex_scheduled_calls` — GCal-mirrored calls (`status, outcome, outcome_notes, no_show_at, rescheduled_at, call_type, hired_at, contracted_at`). Used by `CallsTodayCockpit.tsx`, `daily-brief`, `gcal-sync`.
- `contracting_intakes` (`status`: accepted 46, needs_review 6), `agent_documents` (`kind in ('license','eo_certificate','voided_check','id','contracting','other')`, 11 rows total), `onboarding_progress` + `onboarding_modules` (6 active), `messaging_identity_links` (Slack verification), `magic_login_tokens` (portal link sent/used), `agent_attendance` (1 row, last 2026-06-03 — dead).

**Views:**
- `v_onboarding_sequence` — latest definition `supabase/migrations/20260904215000_onboarding_sequence_no_column_grant.sql` (security_invoker). One row per "active" agent with 8 rung booleans `r1_intake..r8_first_sale`, `next_missing_step`, `rungs_complete`, `days_since_progress`. Live `pg_get_viewdef` read 2026-10-05; definition reproduced in §3.
- `v_hire_notification_gaps` (`20260827030000_hire_notification_gap_monitor.sql`) — 0 rows.
- `v_queue_licensed_inactive` (35 rows), `v_queue_active_no_first_sale` (68 rows) — the ladder's "attention" rail (`OnboardingLadder.tsx:163-173`).

**RPCs:**
- `recruit_pipeline_list()` — `20261001090000_recruit_stages_instagram.sql` (joins `next_step_progress` → applications/agents/profiles; scope = staff OR manager scope).
- `set_recruit_stage(p_application_id, p_agent_id, p_to_stage, p_reason)` — `20260930210000_retire_seminar_stages.sql:1-91`; `set_recruit_stage_bulk`; `set_recruit_instagram`; `set_recruit_state` (`20261001120000`); `fn_recruit_scope_ok`; `fn_next_step_recompute_one` (`20260930190000_recruit_stages_inline_edit.sql`).
- `advance_hire_stage(p_agent_id, p_to_stage, p_expected_stage, p_note)` — `20260902203000_hire_stage_control_everywhere.sql:44-133`; `fn_can_move_hire`; `fn_hire_stage_rank`.
- `mark_no_longer_with_us(p_checkin_id, p_agent_id, p_reason)` — `20260930170000_contracting_no_longer_with_us.sql`; `mark_reengage_email_sent`.
- `fn_agent_onboarding_call_booking(agent_id)`, `fn_enqueue_onboarding_call_booking(agent_id, source)` — `20260826052000:250-277`.
- `fn_agent_licensing_ready(agent_id)` (NPN digits present AND 50 ≤ comp_percentage ≤ 200), `fn_agent_contracting_matched_by_npn` — `20260904215000`.
- `apex_agent_onboarding_roadmap(agent_id)` — `20260827213000_agent_onboarding_roadmap.sql:4`.
- `get_just_hired_30d()` — `20260827220000_get_just_hired_30d_rpc.sql` (filter: `is_agency_staff()` and `created_at >= now()-30d`).

**Jobs / automation:**
- pg_cron `apex-onboarding-call-gap-sweep` every 15 min (`20260827130000_onboarding_call_gap_sweep.sql:30`) → `fn_sweep_onboarding_call_gaps()`: licensed+active agents created in the last 30d with no onboarding-call booking or queue row get `fn_enqueue_onboarding_call_booking`.
- Trigger `trg_interview_events_classify_onboarding` (`20260826052000:85`) normalises Calendly onboarding bookings to `call_track='onboarding'` and resolves `agent_id`.
- Trigger `trg_queue_onboarding_call_invites` (`20260826052000:214`) → `onboarding_call_invites`; edge fn `supabase/functions/onboarding-call-invites/index.ts` sends the .ics via Resend.
- Trigger `trg_agents_hired_licensed_enqueue` (memory, 2026-06-17) enqueues `course` + `discord` emails when a licensed hire reaches live/active.
- Nightly `fn_next_step_recompute_all` re-derives every `next_step_progress` row (manual override honoured unless evidence outranks it).

### 1.3 Tests touching the domain
`src/tests/lib/hireLadder.test.ts` (rank/enum parity with `fn_hire_stage_rank`), `agentOnboardingRoadmap.test.ts` (receipt-backed milestones; "makes Slack and Milver the first post-hire contacts"), `hireMonitoringRecruitingIncome.test.ts:25` ("keeps Milver and VA hiring operations on a real-time no-hire-left-behind queue" — asserts the panel exists, not that it is actionable), `recruitingCommandCenter.test.ts`, `onboardingEmailPolicy.test.ts`. No test covers `v_onboarding_sequence` rung semantics or `next_missing_step` ordering.

---

## 2. Authoritative records per milestone (brief §6)

| Milestone | Authoritative record today | What the UI reads | Proxy? |
|---|---|---|---|
| **Hiring** | `agents` row creation by `add-agent` edge fn (sets application `status='onboarding'`, `closed_at`, `assigned_agent_id`, `add-agent/index.ts:260`); `agents.start_date` (date) | NHLB/ladder: `hired_at = agents.created_at`; JustHired: `created_at ≤ 30d`; Recruit Stages: `next_step_progress` stage ≥ `hired_unlicensed` | **Yes.** `created_at` is row creation, not a hire date. Of 84 ladder rows, 50 have no `start_date`, 28 same-day, 4 `start_date` before `created_at`, 2 after. `hire_date` column is absent; Discord hire feed keys on `start_date` (memory). |
| **Invitation acceptance** | `magic_login_tokens` (sent/used), `auth.users` sign-in (`last_sign_in_at`) | Recruit Stages shows `link_sent_at` / `link_used_at ?? last_sign_in_at` (`RecruitPipeline.tsx:132`); CommandCenter chip "Account" = `agents.user_id IS NOT NULL` (`AgentOnboardingCommandCenter.tsx:75`) | Partly. Having a `user_id` is an account, not an acceptance. 1,639 unused / 141 used tokens lifetime. |
| **Profile** | `profiles` row linked via `agents.profile_id` (74/83 live) or `profiles.user_id` | Ladder r1 = `profile_id IS NOT NULL` | Honest but thin (no completeness check: phone/state/photo). |
| **Licensing / NPN** | `agents.license_status` (self-reported, 0 NIPR-verified per memory), `agents.nipr_number` (59/83), `licensed_at`; applicants: `applications.license_status/license_progress` | Ladder r2 = `license_status <> 'licensed' OR fn_agent_licensing_ready` → **an unlicensed agent passes rung 2 automatically**; CommandCenter "Licensed" = `license_status='licensed'`; Recruit Stages: `hired_unlicensed` vs `hired` split (MP "Hired means licensed", `20261001100000`) | **Yes** (r2 inverted for unlicensed); no verification source recorded. |
| **Required documents** | `agent_documents` (11 rows total across all agents, 1 of 83 live agents has any) + `agents.eft_ready`, `eo_certificate_url` | Stepper keys `identity_documents`, `eo`, `eft` (agent-facing only). **No staff surface** reads documents; ladder has no document rung. | Missing from the exception queue entirely. |
| **Contracting** | `contracting_intakes.status in ('accepted','completed')` (31/83 live), `fn_agent_contracting_matched_by_npn`, carrier cases via `apex_agent_contract_checklist` (see domain 10 report) | Ladder r3 = `contracted_at IS NOT NULL OR contracting_started` — `contracted_at` is set on **0 of 83** live agents; CommandCenter "Contracts sent" = checklist sent OR `contracted_at`, "Carrier active" = checklist `active` | Intake accepted ≠ carrier-approved. r3 label "Carrier contracting" overstates an intake. |
| **Required training** | `onboarding_progress` × `onboarding_modules(is_active)` (6 active modules; 40/83 started, 9 `onboarding_completed_at`) | Ladder r6 = any `onboarding_progress` row; r7 = (completed OR all modules passed) AND `has_dialer_login`; CommandCenter "Training access" = `has_training_course` (69/83 — an entitlement flag flipped when the course email is queued, per `20261001110000` header) | CommandCenter chip is a proxy; ladder r6/r7 are receipt-backed. |
| **System access** | `agents.has_dialer_login` (4/83), Slack = `messaging_identity_links.verification_status='verified'` (1/83), portal = `user_id` (75/83) | Ladder r5 (column still named `r5_discord`, label "Slack joined") = Slack verified; r7 requires dialer | Honest but the Slack signal is near-dead (1 verified), so r5 blocks 74 of 84 rows. |
| **First production** | `agents.first_deal_at` (17/83) and `agentlink_book` rows (9/83 live have book rows); Next Step `first_deal`/`first_10k_week` from deals | Ladder r8 = `first_deal_at`; CommandCenter "First deal" = `first_deal_at` | Mostly honest; `first_deal_at` vs book disagree (17 vs 9) — **unmeasured** which is right per person. |
| **Onboarding call (Milver)** | `interview_events` where `call_track='onboarding'` (4 rows lifetime, all `outcome` null) | Ladder r4 (label "Carrier appointment", view text "Book onboarding with Milver") | **Label lies**: r4 is an onboarding call, not a carrier appointment. 2 of 83 live agents have one. |

### 2.1 Expected start and actual outcome — where they would live
- **Expected start (Confirmed / Likely / Awaiting Response / Not Attending):** no column exists on `agents` or `applications`. Closest: `agents.start_date` (date only, 34/83 set), `interview_events.confirmed_at`/`invitee_status` (Calendly confirmation of a *call*, not a start). `agents.attendance_status` is **not** this — it is an enum good/warning/critical and every one of 228 rows is `good` (also noted in `shipped-data.ts:679`). **Needs addition** (see §7).
- **Actual outcome (Attended / No-Show / Rescheduled):** exists per *event*: `interview_events.outcome` set by `cc_dispose_interview` (`20260724150000_mp264_interview_events.sql`) with vocabulary `attended, no_show, rescheduled, completed, hired, not_interested, callback, attended_no_show`; `interview_events.was_rescheduled`, `canceled_at`; `apex_scheduled_calls.no_show_at/rescheduled_at/outcome`. For onboarding calls: 4 rows, 0 outcomes recorded. `apex_scheduled_calls`: 2 rows, both `scheduled`, `call_type=licensed_prospect`, no outcome. So the schema can hold the outcome; nothing writes it for onboarding calls.
- **No-show → departed:** no trigger or RPC sets `is_inactive`/`is_deactivated`/`status` from `no_show` (grep of `supabase/migrations` for `no_show` writers of `agents`: none). A no-show cannot become departed automatically today — but nothing records the no-show either.

### 2.2 How hired / active / inactive / departed / declined are represented today
- **Agents:** three overlapping fields — `status` (active/inactive/pending/terminated), `is_inactive`, `is_deactivated`, `deactivation_reason`. They disagree: 15 live-stage agents have `is_inactive=true` while `status='active'`; 26 rows in `v_onboarding_sequence` have `status <> 'active'` (the view filters only the two flags). `mark_no_longer_with_us` sets **all three at once** (`status='inactive', is_inactive=true, is_deactivated=true`, `20260930170000:16`) and never sets `deactivation_reason`, so "inactive" (paused) and "departed" (gone) are indistinguishable after that click. There is no `departed` or `declined` value for agents.
- **Applicants:** `applications.status` enum has `rejected`(13), `disqualified`(8), `lapsed`, `no_pickup`(20), `attended_no_show`(1); Next Step uses `closed_lost` (13 applicant + 84 agent rows). "Declined" has no single home.

---

## 3. Workflow traces

### 3.1 Recruit Stages — change a person's stage inline
User picks a stage on a row (`RecruitPipeline.tsx:188`) → `set_recruit_stage` (`20260930210000:1`) → authorization `fn_recruit_scope_ok` (admin/va_manager/va → all; manager → contracting check-in scope, `:84-91`) → refuses applicant→Hired+ and agent→applicant stages (`:15-21`) → writes evidence columns on `applications` (`license_progress` by rank, `status='lapsed'` for closed_lost, `:33-50`) or `agents` (**`onboarding_stage` set directly to `in_field_training`/`onboarding`, `:56-63`**) → sets `next_step_progress.manual_stage_key` → `fn_next_step_recompute_one` → `next_step_events` row (`:85`) → returns `final` and a sentence when evidence outranked the request → UI invalidates `["recruit-pipeline"]`. **Audit:** `next_step_events` (54 `manual_override/manual` lifetime) but **not** `agent_stage_moves` — the `onboarding_stage` write at `:56-63` bypasses the MP-356 audit table. The RPC is a 2-min poll (`refetchInterval: 120_000`), no realtime.

### 3.2 Recruit Stages — "No longer with us"
Row action (`RecruitPipeline.tsx:275`) → `markNoLongerWithUs` (`src/lib/noLongerWithUs.ts:40`) → `mark_no_longer_with_us` (admins/managers only, `:9`; manager scope `:14`) → `agents` set inactive+deactivated (`:16`), `contracting_checkins.left_at/left_by/left_reason` (`:37-42`) → client then invokes `send-email` with the re-engagement copy (`noLongerWithUs.ts:58`) and `mark_reengage_email_sent` on success → toast says exactly what happened. Honest failure semantics (roster change survives a failed email). **Gap:** reason is optional and `deactivation_reason` enum is never written; nightly recompute later closes the Next Step row (`closed_lost`), but until then the person still appears in Recruit Stages (45 inactive-flag agents currently hold `status='active'` progress rows).

### 3.3 Hire board — move a hire's rung
`HireStageControl` (`:105`) → `advance_hire_stage` → `fn_can_move_hire` (admin, or manager who invited/manages the agent) → enum validation → optimistic concurrency on `p_expected_stage` → `agents.onboarding_stage` update → `agent_stage_moves` insert → returns queued emails from `agent_onboarding_queue`. Clean. **But used once lifetime** (`agent_stage_moves` = 1 row). Most stage changes flow through 3.1, the legacy `OnboardingTracker.tsx:98` direct update, `InviteTeamModal.tsx:203`, `AgentQuickEditDialog.tsx:217`, and the nightly recompute.

### 3.4 Onboarding call with Milver
Agent books Calendly → `interview_events` insert → `trg_interview_events_classify_onboarding` sets `call_track='onboarding'` + resolves `agent_id` → `trg_queue_onboarding_call_invites` queues `onboarding_call_invites` → edge fn `onboarding-call-invites` sends .ics to `system_settings.onboarding_call_invite_recipients` via Resend (`resend_message_id` receipt) → ladder r4 flips via `fn_agent_onboarding_call_booking`. Outcome never recorded (4/4 onboarding rows have `outcome=null`), no reschedule/cancel outcome flows back to the ladder, and there is no "Attended/No-Show" button on any staff surface for these rows (the Interviews dispose UI is being removed per §3 of the brief).

### 3.5 NHLB panel
`DashboardApplicants.tsx:1241` → `NoHireLeftBehindPanel` → `v_onboarding_sequence` with `hired_at >= now()-90d AND rungs_complete < 8 LIMIT 50` (`:33-40`) + `v_hire_notification_gaps` count → four tiles + first 6 rows → link to ladder. No action on any row except the agent-name link. Stalled = `days_since_progress >= 2` (`:69`), where `days_since_progress = now() - coalesce(stage_changed_at, created_at)` — not "last outreach".

---

## 4. Defects (evidence → severity)

**D1 (P0) — The ladder gates every later rung behind "Join Slack", so contracting, licensing and training blockers are invisible.** `next_missing_step` order is r1, **r5**, r2, r4, r3, r6, r7, r8 (live viewdef). Slack verified = 1 of 83 live agents. Result: 74 of 84 rows report "2. Join Slack" as the exact missing requirement; 8 report "1. Complete profile"; 2 report "4. Book onboarding with Milver"; **0 rows can ever say contracting, licensing, training or first deal is the block**. Brief: "Do not delay contracting behind unrelated training unless an actual requirement makes that dependency necessary." Also conflicts with Sam's "no stupid Discord things" (column is still `r5_discord`).

**D2 (P0) — Rung 2 passes unlicensed agents automatically.** `r2 = license_status <> 'licensed' OR fn_agent_licensing_ready(agent_id)`. 16 unlicensed live agents are counted as having "Contracting profile" complete; `r2` = 75/84 while `has_npn` = 59/83. The one rung the page advertises a one-click fix for ("Rung 2 is the only rung with a one-click fix", `OnboardingLadder.tsx`; "Send invites" `:411-415`) mis-counts who needs it.

**D3 (P1) — Rung labels do not match what the view measures.** UI (`OnboardingLadder.tsx` RUNGS): 2 "Contracting profile", 3 "Carrier contracting", 4 "Carrier appointment", 5 "Slack joined". View: r2 = NPN+comp on the APEX row, r3 = intake accepted OR `contracted_at`, r4 = **onboarding call booked with Milver**, r5 = Slack. "Carrier appointment" is a carrier-authorization term; the data is a calendar booking. Exactly the "training completion does not mean carrier authorization / moving a card does not prove an external requirement" failure the brief names.

**D4 (P1) — `hired_at` is `agents.created_at`.** NHLB's 90-day window and JustHired's 30-day window are row-creation windows. 50/84 ladder rows have no `start_date`; a 2026-06-16 batch of 7 licensed rows (5 without a login) is one import day, not seven hires. `start_date` is the only hire-date-like column and is the key the Discord hire feed uses.

**D5 (P1) — The ladder's population is wrong in both directions.** `v_onboarding_sequence` = 84 rows for 83 people (1 agent duplicated by `LEFT JOIN profiles p ON p.id = ag.profile_id OR p.user_id = ag.user_id`); it includes 26 rows whose `agents.status <> 'active'` because it filters only `is_deactivated`/`is_inactive`; 15 agents have `is_inactive=true` with `status='active'`. Recruit Stages (`recruit_pipeline_list` where-clause `20261001090000:32`) filters neither flag nor status, so 45 inactive-flag agents still carry `status='active'` Next Step rows and appear as live recruits.

**D6 (P1) — Two stage systems disagree about the same person.** Live cross-tab of `agents.onboarding_stage` × `next_step_progress.current_stage_key` for live agents: `onboarding`→`course_started` 11, `onboarding`→`hired` 11, `onboarding`→`first_10k_week` 4, `training_online`→`hired` 8, `(null)`→`hired` 6, `evaluated`→`first_10k_week` 6 … 18 distinct combinations for 83 people. The hire board rungs (`hireLadder.ts`) read `onboarding_stage`; Recruit Stages reads Next Step; the applicants kanban (`DashboardApplicants.tsx:2360-2388`) derives an 11-column vocabulary from `applications` columns; `AgentPipeline.tsx` uses `license_progress`. Four vocabularies, one person. Brief §3: "do not force users through multiple pipelines that disagree about the same person."

**D7 (P1) — Expected start and attendance outcome have no home; `attendance_status` is a decoy.** No column for Confirmed/Likely/Awaiting/Not Attending. `agents.attendance_status` is 228/228 `good`. Onboarding-call outcomes: 4/4 null. `agent_attendance`: 1 row (2026-06-03). `apex_scheduled_calls`: 2 rows, no outcomes.

**D8 (P1) — "No longer with us" collapses inactive and departed.** `mark_no_longer_with_us` writes `status='inactive'` AND `is_deactivated=true` and never writes `deactivation_reason` (`20260930170000:16`). The brief requires hired/active/inactive/departed/declined to stay distinct.

**D9 (P2) — NHLB is a scorecard with no action.** Rows render name, owner, `next_missing_step`, `rungs/8`, `days waiting` (`NoHireLeftBehindPanel.tsx:103-115`). No resolution button, no last outreach, no owner assignment, and "stalled" = 2 days since `stage_changed_at`. All 84 rows are incomplete; 80 are >7d; 77 are >14d — the panel's "Every recent hire has cleared the launch ladder" branch is unreachable with this data.

**D10 (P2) — `set_recruit_stage` writes `agents.onboarding_stage` outside the audited path.** `20260930210000:56-63` updates `onboarding_stage` directly; `agent_stage_moves` has 1 row lifetime while `next_step_events` has 54 manual overrides. Same for `OnboardingTracker.tsx:98`, `InviteTeamModal.tsx:203`, `AgentQuickEditDialog.tsx:217`.

**D11 (P2) — Rung 3 "contracting" is satisfied by an intake, and `contracted_at` is never set.** `contracted_at IS NOT NULL` on 0/83 live agents; `r3` = 35 purely from `contracting_intakes.status='accepted'`. A submitted intake is "Setup/Documents → Ready to Submit" in the §10 lifecycle, not approved. CommandCenter "Contracts sent" chip (`AgentOnboardingCommandCenter.tsx:77`) uses the same OR.

**D12 (P2) — Required documents are invisible to staff.** `agent_documents` has 11 rows; only the agent-facing Stepper reads them. No ladder rung, no NHLB requirement, no queue.

**D13 (P2) — Attention rail duplicates the ladder with a different clock.** `v_queue_active_no_first_sale` (68) and `v_queue_licensed_inactive` (35) compute `days_stuck` from `coalesce(first_appointment_at, stage_changed_at, created_at)` / `coalesce(stage_changed_at, updated_at, created_at)` and a default `next_action` string — three "time waiting" definitions on one page.

---

## 5. Measurements (live, 2026-10-05)

- `agents` total rows: 228. Live canonical people: **83**. `v_onboarding_sequence` rows: **84** (1 duplicate agent_id).
- Rows by `onboarding_stage × status` (top): onboarding/active 28 (21 live), evaluated/terminated 21, pre_licensed/active 20 (11 live), onboarding/inactive 18, onboarding/terminated 18, (null)/inactive 17, evaluated/active 16 (8 live), (null)/active 14 (6 live), training_online/inactive 13 (12 live — flags say live, status says inactive), training_online/terminated 12, in_field_training/inactive 12, in_field_training/terminated 12, in_field_training/active 8 (5 live), training_online/active 7, evaluated/inactive 6, live/active 3 (2 people).
- Ladder rung satisfaction (84 rows): r1 76, r2 75, r3 35, r4 2, r5 2, r6 41, r7 4, r8 18. Complete (8/8): **0**. `rungs_complete<8 AND days>7`: **80**; `>14`: **77**. NHLB 90-day slice: 42 rows (= all 42 agents created in 90d).
- `next_missing_step` distribution: "2. Join Slack" **74** (onboarding 27, training_online 16, pre_licensed 11, evaluated 8, in_field_training 7, null-stage 4, inactive 1); "1. Complete profile" 8; "4. Book onboarding with Milver" 2. Avg days waiting ranges 28.7 (pre_licensed) to 169.2 (evaluated).
- Milestones over 83 live people: login `user_id` 75; profile 74; `license_status=licensed` 67; NPN 59; `fn_agent_licensing_ready` 59; `contracted_at` **0**; intake accepted 31 (any intake 33); any document **1**; dialer 4; `has_training_course` 69; training started 40; `onboarding_completed_at` 9; `first_deal_at` 17; in `agentlink_book` 9; `start_date` set 34 (future: 0); onboarding call booked 2; Slack verified 1.
- Next Step agent rows (`status='active'`): 134, of which **45** belong to agents with `is_inactive=true` (30 with `status='inactive'`, 15 with `status='active'`). Agent stage spread (active): hired_unlicensed 33 (25 flagged stalled), hired 29 (28), course_started 22 (22), first_deal 20 (20), infield_training 17 (17), first_10k_week 12 (0), course_completed 1. Applicants active: applied 396, contacted 265, started_prelicense 47, finished_prelicense 16, passed_exam 3. Next Step SLA hours: hired 72, hired_unlicensed 360, course_started 120, course_completed 72, infield_training 168, first_appointment 168, first_deal 720.
- Outbox: `agent_onboarding_queue` course 77 sent/19 pending, discord 89/19, hired_whatsapp 42/4, onboarding_call 31 sent, get_licensed 11 sent. `onboarding_call_invites`: 4 request/sent. `interview_events` onboarding: 4, outcome null 4/4. `apex_scheduled_calls`: 2, both scheduled. `agent_attendance`: 1 row (2026-06-03). `attendance_status='good'`: 228/228. `agent_stage_moves`: 1. `next_step_events`: manual_override 54, advance/recompute 942, stall/cron 873, message_sent/cron 2,641.
- `magic_login_tokens`: 1,639 unused / 141 used (lifetime, all audiences).
- **Unmeasured:** `recruit_pipeline_list()` row count under a real staff session (RPC requires `auth.uid()`); per-person `first_deal_at` vs `agentlink_book` disagreement; Milver's Calendly event type volume outside `interview_events`.

---

## 6. KEEP / REPAIR / MERGE / REMOVE

| Surface | File | Verdict | Reason / target |
|---|---|---|---|
| Recruit Stages page (`/dashboard/recruits`) | `src/pages/RecruitPipeline.tsx` | **KEEP + REPAIR** | Brief says preserve. Repairs: hide inactive-flag agents (D5), route `onboarding_stage` writes through `advance_hire_stage` (D10), add owner/last-outreach/next-action columns from the row data it already has (`manager_name`, `last_contacted_at`, `next_action_label`), realtime or shorter poll. |
| Inline stage select / bulk move | `RecruitPipeline.tsx:188,230` → `set_recruit_stage(_bulk)` | KEEP | Correct scope + evidence-outranks-manual semantics. |
| "No longer with us" action | `src/lib/noLongerWithUs.ts`, `mark_no_longer_with_us` | REPAIR | Write `deactivation_reason`, require a reason, split inactive vs departed (D8); close the Next Step row in the same transaction. |
| Instagram / resident state inline edits | `set_recruit_instagram`, `set_recruit_state` | KEEP | Narrow, validated, scoped. |
| NHLB panel | `src/components/recruiting/NoHireLeftBehindPanel.tsx` | **REPAIR → exception queue** | Rebuild on a new `v_onboarding_exceptions` (§7) with requirement/why/owner/waiting/last outreach/next action/button. Keep the realtime wiring. |
| Onboarding Ladder page | `src/pages/OnboardingLadder.tsx` | REPAIR | Same view; fix labels (D3), parallel rungs (D1), r2 (D2), population (D5); keep rung filter + server sort. |
| Attention rail (two queue views) | `OnboardingLadder.tsx:163-173` | MERGE → exception queue | Fold `v_queue_licensed_inactive` / `v_queue_active_no_first_sale` reasons into exception rows with one waiting clock (D13). |
| `v_onboarding_sequence` | `20260904215000…sql` | REPAIR (create or replace) | Fix join fan-out, status filter, r2 predicate, step ordering, `hired_at` → `coalesce(start_date, created_at)`, rename `r5_discord` → `r5_slack` keeping the old column as alias for one release. |
| Hire stage control + `advance_hire_stage` | `src/components/hires/HireStageControl.tsx`, `20260902203000` | KEEP | The one audited write path; make the others call it. |
| `hireLadder.ts` rung model | `src/lib/hireLadder.ts` | KEEP | Tested parity with `fn_hire_stage_rank`. |
| `OnboardingTracker` | `src/components/dashboard/OnboardingTracker.tsx` | MERGE → HireStageControl | Direct `agents.update` + Discord-era notify; superseded. |
| `AgentOnboardingCommandCenter` (drawer strip) | `src/components/dashboard/AgentOnboardingCommandCenter.tsx` | REPAIR | Replace entitlement chips (`has_training_course`, `has_discord_access`) with the view's receipt rungs; drop the Discord chip. |
| `AgentOnboardingStepper` (agent-facing) | `src/components/dashboard/AgentOnboardingStepper.tsx` + `apex_agent_onboarding_roadmap` | KEEP | Receipt-backed; the only reader of documents. Align step keys with the staff view so agent and staff see one truth. |
| `JustHiredPanel` | `src/components/dashboard/JustHiredPanel.tsx`, `get_just_hired_30d` | REPAIR | Key on `start_date` (fallback `created_at`) and show expected-start status once it exists. |
| Applicants kanban (`/dashboard/recruiting`) | `DashboardApplicants.tsx:2360-2388` | MERGE vocabulary → Next Step | Keep the page (pipeline workspace, domain 02) but derive columns from `next_step_progress`, not an inline 11-key derivation. |
| `AgentPipeline` ("My Pipeline", brief starting page) | `src/pages/AgentPipeline.tsx` | MERGE → `/dashboard/recruiting` worklist | Third vocabulary (`license_progress`); Discord webhook on stage change (`:302`). Redirect; keep `check:kanban-stage-vocabulary` satisfied or retire the guard with a red-fixture proof. |
| Onboarding-call pipeline (triggers, .ics, sweep) | `20260826052000`, `20260827130000`, `onboarding-call-invites` fn | KEEP + REPAIR | Add outcome capture (Attended/No-Show/Rescheduled) for `call_track='onboarding'` rows from the exception queue; wire reschedule/cancel to r4. |
| `apex_scheduled_calls` | table + `CallsTodayCockpit` | KEEP (calendar domain) | Not the onboarding truth; leave to domain 07. |
| `agent_attendance` + `AttendanceGrid` | `src/components/dashboard/AttendanceGrid.tsx` | REMOVE (surface) | 1 row since June; table retained. |
| `agents.attendance_status` | column | REMOVE from UI (`ProducerProfile.tsx:505`, `DashboardCRM.tsx:1394`) | 228/228 `good`; do not drop the column. |
| `v_hire_notification_gaps` tile | NHLB tile 4 | REMOVE from NHLB | 0 rows; it is a doctor metric, not a hire exception. |

---

## 7. Recommended implementation plan (this domain)

### 7.1 Data (additive migrations; mirror via MCP + `supabase/migrations/`)
1. **`agents` additions** (or a 1:1 `agent_start_plans` table if column sprawl is preferred — `agents` already has 100+ columns): `expected_start_date date`, `expected_start_status text CHECK (in ('confirmed','likely','awaiting_response','not_attending'))`, `expected_start_set_at timestamptz`, `expected_start_set_by uuid`, `expected_start_note text`. Index on `(expected_start_status, expected_start_date)`.
2. **Outcome on the event, not the person:** reuse `interview_events.outcome` for onboarding calls with a CHECK that includes `attended`, `no_show`, `rescheduled` (read the existing constraint first; `cc_dispose_interview` already writes these literals). No new table.
3. **Departure vs inactivity:** extend `deactivation_reason` enum with `departed`, `declined_offer`, `no_show_never_started` (ADD VALUE is additive); `mark_no_longer_with_us` must require `p_reason` and write it. Keep `is_inactive` (paused) and `is_deactivated` (gone) as separate writes: new `mark_agent_inactive` vs the existing departure path.
4. **`v_onboarding_sequence` v2** (`create or replace`): join profiles by `profile_id` only (fallback `user_id` in a lateral `limit 1`); filter `status='active'` too; `hired_at = coalesce(start_date::timestamptz, created_at)`; `r2 = fn_agent_licensing_ready` (unlicensed agents simply have r2 false and a different exception row); rename `r5_discord` → `r5_slack` (keep `r5_discord` as a duplicate column for one release so the ladder page and tests do not break); **drop the single-chain `next_missing_step`** in favour of a parallel model (below). Measure as a non-admin before shipping (memory: non-security_invoker views leak; this one is invoker, keep it so).
5. **New `v_onboarding_exceptions`** (security_invoker): one row per (agent, open requirement). Columns: `agent_id, agent_name, owner_agent_id, owner_name, requirement_key, requirement_label, why_it_matters, track ('licensing'|'contracting'|'training'|'access'|'start'|'production'), waiting_since, days_waiting, last_outreach_at, last_outreach_kind, next_action, next_action_due_at, resolution_rpc, resolution_route`.
   - Requirement rows derive from the same receipts: `no_profile`, `no_login` (`user_id` null or no `magic_login_tokens.used_at`), `unlicensed` (track licensing, uses `applications`/`agents.license_progress`), `npn_or_comp_missing` (`NOT fn_agent_licensing_ready`), `intake_missing` (no accepted `contracting_intakes`), `documents_missing` (no `agent_documents` of kind license/id/voided_check for licensed agents — define the required set in a tiny `onboarding_required_documents` table, not in code), `training_not_started`, `training_incomplete`, `dialer_missing`, `slack_missing` (informational, never blocks), `onboarding_call_unbooked`, `onboarding_call_no_show` (from `interview_events.outcome`), `start_unconfirmed` (expected_start_status null or awaiting), `no_first_deal` (licensed + contracted + >30d).
   - `waiting_since` = the receipt timestamp that *created* the gap (e.g. `licensed_at` for contracting gaps, `created_at` for profile gaps), **not** `stage_changed_at`; `last_outreach_at` = `greatest(agents.last_contacted_at, max(agent_onboarding_queue.sent_at), max(next_step_events where message_sent))`.
   - Parallel tracks: contracting rows appear the moment `license_status='licensed'` regardless of Slack/training; training rows appear at hire. Only genuine dependencies gate (e.g. `documents_missing` only after licensed; `no_first_deal` only after an accepted intake).
6. **One audited stage writer:** make `set_recruit_stage` call `advance_hire_stage` for its `onboarding_stage` side-effect (or insert into `agent_stage_moves` itself) so `agent_stage_moves` is the complete history.
7. **Outcome RPC:** `record_onboarding_call_outcome(p_interview_event_id, p_outcome, p_note)` — scope via `fn_can_move_hire(agent_id)`, writes `interview_events.outcome/outcome_at/outcome_by`, on `rescheduled` leaves the new booking to the Calendly webhook, on `no_show` writes `next_step_events` and bumps `expected_start_status` to `awaiting_response` **only if** it was `confirmed` (never to departed).
8. **Expected start RPC:** `set_expected_start(p_agent_id, p_date, p_status, p_note)` with the same scope; event row in `next_step_events` (`event_type='expected_start'`).

### 7.2 Frontend
- `NoHireLeftBehindPanel.tsx`: query `v_onboarding_exceptions` (limit 50, ordered by `days_waiting desc`), group by track; each row renders requirement, why, owner, `days_waiting`, `last_outreach_at` (relative), `next_action`, and a **direct resolution button** mapped by `requirement_key`:
  - `no_login` → `send-agent-portal-login` edge fn (already invoked by `OnboardingTracker.tsx:137`) / `/claim` link copy.
  - `npn_or_comp_missing` → existing `CONTRACTING_FIX_ROUTE` (contracting workspace) / `AgentQuickEditDialog`.
  - `intake_missing` → resend intake via `onboarding-email` (admin/manager session accepted since `2e7530e4`).
  - `documents_missing` → open drawer documents tab (new tab reading `agent_documents`).
  - `training_*` → `AddToCourseButton` (existing).
  - `onboarding_call_unbooked` → `fn_enqueue_onboarding_call_booking(agent_id,'manual')` (exists).
  - `onboarding_call_no_show` / booked → `record_onboarding_call_outcome` (Attended / No-Show / Rescheduled buttons).
  - `start_unconfirmed` → `set_expected_start` inline select (Confirmed / Likely / Awaiting / Not Attending + date).
  - `no_first_deal` → `HireStageControl` rung move + `SubmitDealDialog` (Mark Sold path, MP-393).
  - Departure → existing `markNoLongerWithUs` with a required reason select.
- `OnboardingLadder.tsx`: rename labels to the view's truth ("Onboarding call booked", "Contracting intake accepted", "Slack joined (optional)"), add track chips instead of a single rung filter, read `v_onboarding_exceptions` for the row's open items.
- `RecruitPipeline.tsx`: filter out `is_inactive`/`is_deactivated` agents client-side until `recruit_pipeline_list` is patched; add "Expected start" and "Owner" columns; keep stage select.
- `AgentOnboardingCommandCenter.tsx`: replace the 8 chips with the view's receipts; remove Discord chip.
- `JustHiredPanel.tsx` / `get_just_hired_30d`: order and filter by `coalesce(start_date, created_at)`; show `expected_start_status` badge.
- `OnboardingTracker.tsx`: route through `useMoveHireStage`; delete the direct update.
- Redirect `/dashboard/agent-pipeline` → `/dashboard/recruiting` (worklist) and update `check:sidebar-routes`, `check:dead-internal-links`, `check:orphan-pages` inputs.

### 7.3 Tests
- `src/tests/lib/onboardingExceptions.test.ts`: contract test that the migration's `requirement_key` set equals the frontend button map (same pattern as `hireLadder.test.ts:51` "agrees with fn_hire_stage_rank").
- Vitest for the panel: an exception row always renders a resolution action; a row with `onboarding_call_no_show` never renders a departure action by default.
- SQL proof in the migration header (DO-block RAISE pattern, MP-393): a licensed agent with no Slack link produces a contracting exception (D1 regression); an unlicensed agent produces `unlicensed` not `npn_or_comp_missing` (D2); view row count = distinct `agent_id` (D5).
- Extend `hireLadder.test.ts` to assert `set_recruit_stage` migration text contains `advance_hire_stage(` or `agent_stage_moves` (D10 regression).
- `agentOnboardingRoadmap.test.ts:66` currently asserts "Slack and Milver the first post-hire contacts" — update to assert Slack is optional, or the D1 fix will fail the suite.

### 7.4 Guards affected
`check:kanban-stage-vocabulary` (AgentPipeline retirement), `check:sidebar-routes`, `check:dead-internal-links`, `check:orphan-pages` (route redirect), `check:maybesingle-nonunique` (any new `.maybeSingle()` on `interview_events.agent_id` must use `.limit(1)` or an indexed key), `check:stale-key-in-list` (new lists keyed by `agent_id+requirement_key`), `check:brand-literals`/`check:theme-literals` (panel restyle), `check:tsc-error-count` baseline, apex-doctor Check #7/#22 inputs if `v_onboarding_sequence` columns are renamed (grep `~/business-ops/scripts/apex-doctor.sh` for `v_onboarding_sequence` before renaming — **unmeasured** here).

---

## 8. Risks and open questions

**Risks**
- Renaming or re-ordering `v_onboarding_sequence` columns breaks `OnboardingLadder.tsx`, `NoHireLeftBehindPanel.tsx`, `apex_agent_onboarding_roadmap` (shares the rung predicates) and possibly apex-doctor; keep aliases for one release.
- `agents` flag/status disagreement (15 rows `is_inactive=true, status='active'`) means any filter change moves people in or out of three surfaces at once; take a snapshot of the 83/84/134 counts before and after and publish the delta.
- `deactivation_reason` enum ADD VALUE cannot run inside a transaction with other DDL on older Postgres; ship it as its own migration.
- A "No-Show" button that writes `interview_events.outcome` must not touch `agents.status`; the brief forbids no-show → departed. Enforce in the RPC, not the UI.
- `add-agent` writes `applications.status='onboarding'`; `application_status` has no `hired`. Any "hired" badge derived from `applications` is a proxy — keep hire truth on `agents`.
- Throughput: the panel currently refetches on four realtime tables; the exception view fans out per requirement (~5–8 rows per agent → ~500 rows). Server-side `limit 50` by `days_waiting` keeps it bounded.

**Open questions (Sam / contracting staff)**
1. Which documents are *required* for a licensed hire before contracting (license copy, government ID, voided check, E&O)? The data model has the kinds; nothing says which are mandatory.
2. Is the Milver onboarding call mandatory before contracting, or parallel? Today the view orders it before "Submit native contracting intake" with no stated dependency.
3. Should Slack membership be a requirement at all? 1 of 83 verified; if it stays, who owns the resolution?
4. Is `start_date` the hire date (Discord feed assumes yes) or the expected start? Decides the `hired_at` fix and where `expected_start_date` sits.
5. Does "declined" belong to applicants only (`rejected`/`disqualified`) or do offered-but-declined agents exist as `agents` rows that need `declined_offer`?
6. Who is the default owner of an onboarding exception when `manager_id` is null (`'unassigned'` today on the view) — Milver, John Ray (contracting track), or the inviting manager?
