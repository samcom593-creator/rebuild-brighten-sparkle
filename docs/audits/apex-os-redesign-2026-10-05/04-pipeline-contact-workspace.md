# 04 — Pipeline / Recruiting Contact Workspace (read-only map)

Program: APEX OS redesign 2026-10-05 · Domain: `pipeline-contact-workspace` · Repo HEAD `4ea291c8` (main) · DB `xrzweoneiieddzxogewk`
Method: code read (file:line), migrations/catalog read, live read-only SQL via Supabase MCP (2026-10-05/06 UTC). Every number below is measured unless marked **unmeasured**. Rows and distinct people are stated separately. No real-person PII beyond first names already in the brief.

---

## 0. Headline (what Sam needs to know in 60 seconds)

1. **The brief's starting page is not a recruiting page.** `/dashboard/agent-pipeline` mounts `ClientPipeline` ("Client sales cockpit", consumer leads from `agentlink_clients`) — `src/App.tsx:687-688`; the sidebar's "My Pipeline" item points there (`src/components/layout/agentCloudNavigation.ts:132`). The recruiting `AgentPipeline.tsx` is mounted at `/dashboard/recruit-pipeline` and `/recruit-pipeline` (`App.tsx:684-685`) and is in **no** navigation.
2. **Ownership is fiction.** 832 of 832 live applications carry `assigned_agent_id`, `recruiter_id` AND `referral_manager_id`; 736 of them (685 + 51, split across two "Samuel James" agent rows) are assigned to Sam; `assigned_va_id` is set on 0. "Unassigned" is empty by construction and "My Queue" for Sam is 88.5 % of the book.
3. **Contact truth is split across 5 stores with 4 outcome vocabularies, and a dial-link click is recorded as contact.** `application_contact_log` has 36 rows lifetime (1 in the last 30 days); 11 of them are `initiated`, written when a `tel:`/`sms:`/`mailto:` link is clicked (`DashboardApplicants.tsx:693-705`). `RecruiterDashboard.tsx:507,1554` stamp `last_contacted_at` on click. 473 live applications have **no evidence of any human contact ever**; 466 carry the bulk-stamped `contacted_at` with no `last_contacted_at`.
4. **Every "next action" is overdue.** `next_step_due_at`: 757 overdue / 18 future / 717 overdue > 30 d. `next_action_due_at`: 294 rows, 294 overdue (284 `MANAGER_CALL_72H_ESCALATION`). A "Due Today" queue would be ≈0 and "Overdue" would be the whole book.
5. **Six screens compute six stages for the same person** (DashboardApplicants `stageOf` 11 columns, HiringPipeline `STAGES` 7, KanbanBoard 7, `v_recruiting_pipeline` CASE 11 labels, `recruit_pipeline_list` 20 `next_step_stages` keys, RecruiterDashboard `PROGRESS_COLUMNS`). Measured disagreement: 244 live rows are `status='new'` **and** have `last_contacted_at` → "Applied" on HiringPipeline, "Contacted" on DashboardApplicants.
6. **Two interview truths**: `interview_events` (Calendly, 271 rows, 246 past rows with `outcome IS NULL`, 0 upcoming) edited by `InterviewRecovery` via `cc_dispose_interview`; `hh_applicants` (376 rows, 312 still `appointment_set` with every appointment in the past, 0 future) edited by `Interviews.tsx` via the `interviews-pipeline` edge function. 84 interview_events link to a live application that also has an `hh_applicants` row.

---

## 1. What exists

### 1.1 Routes (src/App.tsx)

| Route | Component | Guard (ProtectedRoute props) | Line |
|---|---|---|---|
| `/dashboard/agent-pipeline`, `/agent-pipeline` | `ClientPipeline` (consumer-lead sales cockpit) | any authenticated | 687-688 |
| `/dashboard/recruit-pipeline`, `/recruit-pipeline` | `AgentPipeline` (recruiting Kanban) | any authenticated | 684-685 |
| `/dashboard/recruiting` | `DashboardApplicants` | requireAdmin allowManagers allowRoles va_manager/va/recruiter | 494 |
| `/dashboard/recruiting/pipeline` | `RecruitingPipeline` (reads `v_recruiting_pipeline`) | same | 495 |
| `/dashboard/recruiting/interviews` | `Interviews` (hh_applicants via edge fn) | same | 496 |
| `/dashboard/recruiting/follow-ups` | `InterviewRecovery` (interview_events) | same | 497 |
| `/dashboard/recruiting/hires` | `DashboardApplicants` **again, unfiltered** (no `useLocation`/`pathname` read in the file) | same | 498 |
| `/dashboard/applicants` | redirect → `/dashboard/recruiting` | — | 565 |
| `/admin/my-applicants` | `MyApplicants` (referral_manager_id = me only) | requireAdmin allowManagers | 567 |
| `/dashboard/stale-recovery` | `StaleRecovery` (v_stale_applicants + v_queue_stalled_applications) | requireAdmin allowManagers | 581 |
| `/dashboard/recruits` | `RecruitPipeline` ("Recruit Stages", `recruit_pipeline_list`) | requireAdmin allowManagers allowRoles va_manager/va (**no recruiter**) | 606 |
| `/admin/licensed-inbox` | `LicensedInbox` | requireAdmin allowRoles va_manager/va | 617 |
| `/admin/recovery-queue` | `RecoveryQueue` (v_hot_licensing_prospects) | requireAdmin allowManagers va roles | 621 |
| `/admin/unlicensed-all` | `UnlicensedAll` (v_unlicensed_all) | same | 623 |
| `/dashboard/call-center` | `CallCenter` (applications + aged_leads) | any authenticated | 668 |
| `/dashboard/recruiter` | `RecruiterDashboard` | **no ProtectedRoute**; internal gate `allowed = isAdmin || isManager || effectiveMode in (recruiter, agency_owner)` at `RecruiterDashboard.tsx:914-915` | 682 |
| `/dashboard/interviews`, `/dashboard/interview-recovery` | redirects → recruiting/interviews, recruiting/follow-ups | — | 698-699 |
| `/dashboard/pipeline-simple` | `AgentPipelineSimple` — **not a pipeline**: manager-switch requests over `agents`/`deals` (`AgentPipelineSimple.tsx:88-110,165-183`) | no ProtectedRoute wrapper | 761 |
| `/dashboard/hiring-pipeline` | `HiringPipeline` | requireAdmin allowManagers | 764 |
| `/dashboard/old-applicants/*` | `OldApplicants` | requireAdmin allowManagers | 791-792 |

Navigation that reaches these: `agentCloudNavigation.ts:132-133` (Sell → "My Pipeline" = client cockpit, "Call Center"), `:147-151` (Grow → Recruit Stages `/dashboard/recruits`, Recruit Pipeline `/dashboard/recruiting`, Interviews, Follow-ups), `MobileBottomNav.tsx:22-48` (Recruiting, Interviews, Follow-ups), `CommandPalette.tsx:61,65` (Hiring Pipeline, Call Center), `RecruitingWorkspaceNav.tsx:10-15` (Pipeline / Applicants / Interviews / Follow-ups / Hires → `interviews?tab=hired` / Training). Not linked anywhere outside pages: `/dashboard/recruit-pipeline`, `/dashboard/recruiter`, `/dashboard/stale-recovery`, `/dashboard/pipeline-simple`, `/admin/my-applicants`.

### 1.2 Pages (line counts) and their data access

| File | Lines | Reads | Writes | Role scoping / caps |
|---|---|---|---|---|
| `src/pages/AgentPipeline.tsx` | 868 | `applications` `select("*")` `is terminated_at null`, OR-filter on 3 attribution cols = me (or me + `invited_by_manager_id` team) `:223-238`; requires an `agents` row for the user — `if (!agentData) { setLoading(false); return; }` `:220` (silent empty) | `license_progress` (+`license_status` on licensed) `:277-282`; `discord-webhook-notify` `:302`; `add-agent` `:319`; `bulk-agent-message` `:371`; `send-agent-portal-login` `:584` | mine/team only; no limit |
| `src/pages/ClientPipeline.tsx` | 1560 | `agentlink_clients` paged `.range` `:249-255`, `client_pipeline_overrides`, `v_client_pipeline_stats` | — | consumer leads, not recruiting |
| `src/pages/RecruiterDashboard.tsx` | 1621 | `applications` `.in("status",["reviewing","contracting","approved","new"])` `:950-953` (no `is_duplicate` filter) **plus** `aged_leads` `status='contacted'` merged into the same list `:960-962` | `notes` overwrite `:397-399`; `lead_score` `:477`; `last_contacted_at` on click/outcome `:426-429,507,1554`; `lead_activity` via `logLeadActivity` | org-wide for admin/manager/recruiter mode; no limit |
| `src/pages/HiringPipeline.tsx` | 985 | `applications` `select("*")` live, `.limit(2000)` `:125-129`; manager → `my_downline_agent_ids` OR-filter `:131-139` | `license_progress/status`, `contacted_at/first_contact_attempt_at/last_contacted_at/last_response_at` `:255-330` | admin all / manager downline |
| `src/pages/DashboardApplicants.tsx` | 2585 | `applications` `APPLICATION_SELECT` `count:"exact"` `.eq record_type='application'` `:370-372`, active + terminated passes; `interview_events` `gte scheduled_at now` `:481-484`; `interviews-pipeline` edge fn `:518`; `agents` for names | terminate/restore `:643-676`; `log_contact_attempt("initiated")` on link click `:693-705`; `mark_phone_bad` `:713`; Kanban → `license_progress` `:788-791`; `score-applicant` `:1503` | full pipeline for admin/manager/va/va_manager/recruiter `:382`; plain agent → attribution; **no `.limit`/`.range` → PostgREST 1000-row cap** |
| `src/pages/CallCenter.tsx` | 1436 | `aged_leads` `.limit(500)` `:158-161`; `applications` `.limit(500)` `:233-236`; status filter uses `contacted_at` as truth `:256-261` | 8 dispositions → `applications.status/contacted_at/last_contacted_at` `:548-625`; `log_contact_attempt` fire-and-forget `:441-475`; `unified_mark_phone_bad` `:602`; `send-post-call-followup` `:378`; `send-licensing-instructions` `:628`; `notify-hire-announcement` `:639` | admin all; non-admin aged_leads `assigned_manager_id = me`; applications "mine" via 3 cols |
| `src/pages/RecruitingPipeline.tsx` | 317 | `v_recruiting_pipeline` `.limit(2000)` `:73-75` (view has 962 rows) | `rp_pipeline_action` actions `contacted,followup,intent,monday,note,stage` `:83,99,261-299` | view has no role predicate; RLS of underlying tables does not apply (security_invoker **off**) |
| `src/pages/InterviewRecovery.tsx` | 1622 | `v_interview_pipeline` `.limit(1000)` `:258-262`; `v_prospect_review_queue` `.limit(500)` `:273-277` | `cc_dispose_interview` `:403,473`; undo → `interview_events.outcome=null` `:416-423` | view predicate `is_agency_staff()` (admin/va/va_manager only — managers and recruiters get 0 rows) |
| `src/pages/Interviews.tsx` | 855 | `interviews-pipeline` edge fn (hh_applicants, applications, v_onboarding_calls) `:176,220,252`; `assistant_share_tokens` `:236` | edge-fn actions `confirm/qualified/follow_up/hire/not_hired/unqualified/no_show/reschedule/cancel/reopen` (`supabase/functions/interviews-pipeline/index.ts:115-142`) → `hh_applicants` + `hh_activity`; `admin_enqueue_onboarding_call` `:274` | edge fn resolves actor from `user_roles` + `hh_users` `:89-94` |
| `src/pages/RecruitPipeline.tsx` | 600 | `next_step_stages`, `recruit_pipeline_list()` `:107,119` | `set_recruit_stage`, `set_recruit_stage_bulk`, `set_recruit_instagram`, `set_recruit_state` `:188-286` | RPC-internal: admin/va/va_manager = all; manager = team; else mine |
| `src/pages/StaleRecovery.tsx` | 784 | `v_stale_applicants` (4 rows), `v_application_conversion_funnel`, `v_queue_stalled_applications` (670 rows), chunked `applications` by id `:387-458` | (recover action via `fn_recover_stale_applicant`, writes `application_contact_log` + `applications`) | admin/manager |
| `src/pages/AgentPipelineSimple.tsx` | 427 | `agents`, `deals` | `agents.invited_by_manager_id` `:165,183` | misnamed; out of domain |
| `src/pages/LicensedInbox.tsx` | 810 | `applications` `license_status='licensed'` `.limit(500)` `:156-184` | outbox (`apex_contact_actions`, 0 rows) | va roles |
| `src/pages/admin/RecoveryQueue.tsx` | 1733 | `v_hot_licensing_prospects` | `unified_mark_contacted`, `unified_set_license_progress`, `unified_mark_phone_bad`, `log_contact_attempt` `:624-662` | admin/manager/va |
| `src/pages/admin/UnlicensedAll.tsx` | 1205 | `v_unlicensed_all`, `v_xcel_person_progress` | `unified_assign_va`, `unified_mark_contacted`, `unified_set_license_progress`, `log_contact_attempt`, `unified_mark_phone_bad`, `promote_aged_lead_to_application` `:250-343` | admin/manager/va |
| `src/pages/admin/MyApplicants.tsx` | 318 | `applications` `.eq("referral_manager_id", me)` `:99-110` | — | one attribution column only |

### 1.3 Components in scope

- `src/components/pipeline/KanbanBoard.tsx` — `KANBAN_COLUMNS` 7 ids (`applicants, needs_outreach, course, test_phase, final_steps, licensed, dormant`) `:44-88`; `COLUMN_TARGET_STAGE` maps column → `license_progress` `:138-`. Guarded by `check:kanban-stage-vocabulary`.
- `src/components/pipeline/PipelineCard.tsx` — card only.
- `src/components/callcenter/*` — `CallCenterActions.tsx` 8 dispositions (`hired, contracted, bad_applicant→"Not a Fit", no_pickup, contacted, reschedule, bad_number, needs_followup`) `:43-114`; `CallCenterFilters.tsx` loads `applications`/`aged_leads` `.limit(500)` `:163-199`; `LeadReassignButton.tsx` writes `aged_leads`/`applications` `:90-100`; `CallCenterVoiceRecorder.tsx` uploads to `call-recordings` bucket + `analyze-call-transcript` `:232-272`.
- `src/components/recruiter/*` — `LeadDetailSheet.tsx` reads `lead_activity`, overwrites `applications.notes` `:160`; `ActivityTimeline.tsx` reads `lead_activity` `.limit`.
- `src/components/applicants/ApplicationDispositionCluster.tsx` — writes `application_contact_log` directly (`:99,372`) with outcomes `called, no_answer, voicemail, texted, emailed, emailed_with_note, bad_number, pass` `:129-191,366`.
- `src/components/recruiting/*` — `RecruitingWorkspaceNav.tsx` (sub-nav), `NoHireLeftBehindPanel.tsx` (reads `v_onboarding_sequence` `.limit(50)`, `v_hire_notification_gaps` — owned by domain 05), hero/funnel visuals.
- `src/components/next-step/*` — `useNextStepData.ts` reads `v_next_step_stuck_pool`, `v_next_step_funnel_health`, `v_next_step_manager_board`, `v_next_step_candidate`, RPC `landing_next_step_for`.
- `src/lib/phone.ts` — `phoneHref/smsHref` return `tel:`/`sms:` on touch devices, Google Voice `https://voice.google.com/...` on desktop (`:95-125`); `contactLinkProps` opens in a new tab. Guarded by `check:recruiting-contact-actions`.
- `src/lib/apexConfig.ts:147-151` — `CALL_OUTCOMES`: `no_answer, voicemail, interested, not_interested, wrong_number` (+ others) with `activityType` → `lead_activity` only.
- `src/lib/logLeadActivity.ts:34` — inserts `lead_activity`; RLS admits only admin, assigned agent, or manager of assigned agent.

### 1.4 Tables, views, RPCs, jobs (live catalog)

**applications** (854 rows; 832 live): 150 columns. Vocabulary families:
- `status` enum `application_status` = `new, reviewing, interview, contracting, approved, rejected, no_pickup, lead, registered, attended, attended_no_show, paid, onboarding, producing, lapsed, disqualified, quick_qualified`.
- `license_status` enum = `licensed, unlicensed, pending`; `license_progress` enum = `unlicensed, course_purchased, finished_course, test_scheduled, passed_test, fingerprints_done, waiting_on_license, licensed, waiting_fingerprints, failed_test, exam_passed, in_field_training`.
- Stage-ish text: `next_step_stage_key` (6 distinct live: applied 436, contacted 272, started_prelicense 48, null 45, finished_prelicense 16, closed_lost 12, passed_exam 3), `pipeline_stage_override` (0 set), `monday_status`, `intent_level`, `hiring_scope_at_intake`, `record_type` (`application` 819, `interview_booking` 34, `test` 1), `qualified_role`.
- Owner-ish: `assigned_agent_id`, `recruiter_id`, `referral_manager_id`, `referral_recruiter_id`, `referrer_agent_id`, `hiring_manager_user_id`, `assigned_va_id`/`assigned_va_at`, `reviewed_by`.
- Contact-ish: `contacted_at` (bulk-stamped — 825 live set), `last_contacted_at` (359 live set), `first_contact_attempt_at` (5), `last_response_at`, `phone_bad_at/reason` (7), `email_bad_at/reason` (0), `is_ghosted`, `couldnt_reach_email_sent_at`.
- Next-action-ish (three families): `next_action_at`+`next_action_type` (294), `next_action`+`next_action_due_at` (294), `next_step_stage_key`+`next_step_due_at` (775), `next_touch_by` (0).
- Consent: `sms_consent_given` (115 live false), `email_consent_given` (141 live false), `consent_*` provenance, `telegram_opt_out` (0).
- Geography: `state` (46 live null), `city`, `licensed_states` array. **No time-zone column.**
- Dup: `is_duplicate` (102 live), `duplicate_of`.

**Contact/outcome stores**
| Store | Rows | Shape | Who writes |
|---|---|---|---|
| `application_contact_log` | 36 total, 1 in 30 d, 1 distinct logger | `channel` CHECK (`call, sms, email, note`); `outcome` **free text, no CHECK**; `logged_by`, `contact_action_id` | `log_contact_attempt` RPC (auth + `can_work_application`), DispositionCluster direct insert, `fn_recover_stale_applicant` |
| `lead_activity` | 23 | `activity_type` free text (`course_purchased_on_call` 16, `reapplication` 6, …) | `logLeadActivity`; RLS limits to assigned agent/manager/admin |
| `contact_history` | 7,607 (2,721 in 30 d across 105 applications) | `contact_type` = email 7,586 / followup 20 / cold_outreach 1 | automation (email sequences) |
| `interview_events` | 271; outcome set on 6 (`hired` 3, `not_interested` 2, `completed` 1); 246 past with null outcome | outcome CHECK = `completed, hired, contracted, passed, no_show, no_answer, rescheduled, bad_number, callback, not_interested, not_a_fit` | `cc_dispose_interview` (also rewrites `applications.status` + `last_contacted_at`) |
| `hh_applicants` | 376 (not-archived stage: appointment_set 312, canceled 10, hired 3, rescheduled 2, unqualified 2, interview_complete 1, not_hired 1) | `hh_stage` / `hh_result` enums + CHECKs | `interviews-pipeline` edge fn |
| `candidate_notes` | 0 | per-author notes | nothing writes |
| `apex_contact_actions` | 0 | provider-receipt outbox (status, provider_message_id, delivery_confirmed) | LicensedInbox outbox only (`check:contact-actions`) |
| `notification_log` | 1,695 in 30 d: `sms-auto/skipped` 1,115, `sms-auto/sent` 438, `email/sent` 112, `push/failed` 30 | **0 of 1,695 carry `metadata.application_id`** | notification edge fns |
| `outreach_queue` | 1,133 (`sent` 726, `skipped` 342, `pending` 45, `error` 20); sender cron `apex-outreach-sender-5min` **INACTIVE** | — | automation |
| `email_unsubscribes` | 1 (matches 1 live application) | — | unsubscribe flow |

**Suppression / consent objects**: `v_leads_do_not_dial` (706) and `v_leads_suppression_all` (986) are **consumer `client_leads` only**; `idx_aged_leads_dnc` exists on `aged_leads`. No `quiet_hours`/`contact_window`/TCPA-window object exists in `public` (catalog regex returned only those two). No recruiting surface except `DashboardApplicants` (11 mentions, phone_bad/sms_consent) references `sms_consent_given`, `email_consent_given`, `email_unsubscribes` or `phone_bad_at` (`CallCenter`, `HiringPipeline`, `RecruiterDashboard`, `AgentPipeline`, `RecruitingPipeline`, `LicensedInbox` page: 0 hits each; LicensedInbox's checks live in the dispatcher edge fn).

**Views used by the domain** (all `security_invoker=off`, i.e. run as owner): `v_recruiting_pipeline` (962 rows; applications ∪ agents; excludes `is_duplicate` and rows with `agents.source_application_id`), `v_interview_pipeline` (`WHERE is_agency_staff()`; returned 0 rows under the MCP role — measurement artifact, not emptiness), `v_stale_applicants` (4 rows; `contacted_at IS NULL AND created_at > now()-60d`), `v_queue_stalled_applications` (670 rows; stage ∈ applied…passed_exam and due < now), `v_va_call_queue` (382; unlicensed, phone ok, `last_contacted_at IS NULL`), `v_recruiting_inbox` (40; 30-day window), `v_prospect_review_queue`, `v_hot_licensing_prospects`, `v_unlicensed_all`.

**RPCs**: `log_contact_attempt(p_application_id, p_channel, p_outcome, p_notes)` → inserts `application_contact_log` only (does **not** touch `applications.last_contacted_at`); auth = `can_work_application` = `is_agency_staff()` OR attribution on 3 columns. `can_work_application`/`is_agency_staff` = roles `admin, va_manager, va` (manager and recruiter deliberately absent, migration 20260831040000). `cc_dispose_interview` (interview_events + applications.status map: hired/contracted→contracting, completed→interview, no_show→attended_no_show, no_answer→no_pickup, not_interested/not_a_fit→rejected). `rp_pipeline_action(person_key, action, value)` actions `contacted, followup, intent, monday, note, stage` → `agents`/`applications`. `recruit_pipeline_list()` (staff all / manager team / mine) resolves residence state from a 7-way COALESCE that includes `(g.license_states)[1]`. `set_recruit_stage*`, `set_recruit_state`, `mark_phone_bad`, `unified_mark_phone_bad`, `unified_mark_contacted` (sets only `last_contacted_at`), `fn_recover_stale_applicant`, `my_downline_agent_ids`.

**Jobs (cron.job)**: `next_step_recompute_all` 03:00 UTC (rewrote `updated_at` on 747 applications in one minute on 2026-10-06 — `updated_at` is therefore not "last human touch"), `next_step_stall_sweep` every 15 min, `next_step_nudge_sweep` hourly, `apex-applicant-nudges-hourly`, `apex_notif_manager_followup_daily`, `apex-followup-emails-daily`, `apex-unlicensed-slack-digest`, `apex-slack-unlicensed-welcome`, `recover_partial_applications_hourly`, `license-milestone-sms-drain`; INACTIVE: `apex-outreach-sender-5min`, `apex-licensing-sequences`, `pl088_license_milestone_drain`.

**RLS on `applications`**: admin ALL; agent SELECT/UPDATE by attribution (3 columns); manager SELECT/UPDATE by attribution + `invited_by_manager_id` team + `hiring_manager_user_id`; `applications_va_read/update` for `va, va_manager`; applicant-by-email SELECT; anon INSERT. **No policy names `recruiter`.** `user_roles` today: admin 2, manager 10, agent 563, va_manager 2, va 2, recruiter 0.

### 1.5 Guards read

- `scripts/check-contact-actions.mjs` (125 l.) — 24 substring contracts on LicensedInbox + `apex-outbox-dispatcher` + migration `20260811222000_apex_contact_actions.sql` (JWT gates, SMS-consent and email-unsubscribe checks, idempotency, truthful delivery states). Comment-stripped matching. Any new outbox path must keep these needles.
- `scripts/check-recruiting-contact-actions.mjs` (427 l.) — files `Interviews, DashboardApplicants, HiringPipeline, MyApplicants, OldApplicants, AgentPipeline, XcelPipeline, StaleRecovery` must use `phoneHref/smsHref` + `contactLinkProps` (no raw `tel:`/`sms:`, no same-tab https). Public pages allow-listed. Remaining raw-site count is measured and printed, not pinned. A new worklist page must be added to its file list.
- `scripts/check-kanban-stage-vocabulary.mjs` (138 l.) — `KanbanBoard.tsx` `COLUMN_TARGET_STAGE` values must be members of `public.license_progress` from `scripts/data/enum-catalog.json`, every enum member must land in some column, and `AgentPipeline.tsx` + `DashboardApplicants.tsx` write paths are checked (`:110`). Changing stage vocabulary means updating the catalog via `scripts/refresh-enum-catalog.sh`, not editing the guard.
- `scripts/check-roster-segment-placeholders.mjs` (209 l.) — lifts `ROSTER_SEGMENTS` out of `src/pages/DashboardCRM.tsx` and executes each chip's `match` predicate against sync-only placeholder rows; every chip must declare `admitsSyncOnly`. Not in this domain's files, but the same pattern (executable predicate test, declared admission) is the right shape for the new saved queues.

Existing tests touching the domain: `src/tests/lib/interviewPipelineContract.test.ts`, `recruitingCommandCenter.test.ts`, `hiringLifecycleContract.test.ts`, `hireMonitoringRecruitingIncome.test.ts`. No test covers CallCenter dispositions, DashboardApplicants scoping, or the outcome vocabulary.

---

## 2. Authoritative records (decision)

| Concern | Authoritative today | Keep as authority | Notes |
|---|---|---|---|
| The recruit (person) | `applications` row (`record_type='application'`) until an `agents` row exists with `source_application_id` | **yes** | 8 agents carry `source_application_id`; 5 of those applications still have a non-hired status → shown in both worlds. 39 live applications share an email with an active agent via `profiles`. |
| Recruiting stage | `applications.next_step_stage_key` + `next_step_progress` (727 active / 70 closed_lost / 8 completed) via `set_recruit_stage` | **yes** (one vocabulary: `next_step_stages`, 20 keys) | `status` and `license_progress` remain **facts** (employment/licensing), not the board stage. |
| Licensing | `license_status` (self-reported; 0 NIPR-verified per memory) + `license_progress` + milestone timestamps | yes | Keep separate from stage per brief. |
| Owner | should be `assigned_agent_id` (recruiter/VA) — currently meaningless (832/832 set, 88 % Sam) | **repair** | Need an explicit `owner_user_id`-style assignment written by a human/rule, with `assigned_va_id` for VA queues. |
| Contact outcome | none authoritative — `application_contact_log` is the only table with (application_id, channel, outcome, logged_by, logged_at) | **make `application_contact_log` the authority** after adding a CHECK vocabulary and an `is_manual`/`provider_event_id` distinction | Retire direct `last_contacted_at` stamps from UI; derive `last_contacted_at` from the log. |
| Next action | three column families + `next_step_progress.sla_due_at` | **collapse to `next_action` + `next_action_due_at` on applications** written by one RPC; keep `next_step_due_at` as the automation SLA | 294 rows in the `next_action_*` family are 100 % overdue escalations. |
| Interviews | `interview_events` (Calendly truth, outcome CHECK) | **yes** | `hh_applicants` is the Headhunter import; 159 of 376 not-archived rows match a live application by email/phone. Mirror, don't dual-write. |
| Notes | `applications.notes` (single overwritten text) + `application_contact_log(channel='note')` | **log rows** | `candidate_notes` has 0 rows and excludes recruiters; `RecruiterDashboard.tsx:398`/`LeadDetailSheet.tsx:160` overwrite. |
| Consent / suppression | `applications.sms_consent_given`, `email_consent_given`, `phone_bad_at`, `email_bad_at`, `email_unsubscribes`, `telegram_opt_out` | yes | No contact-time-window record exists; brief says "honor existing" — the existing set is these flags. |
| Provider events | `notification_log` (no application link), `apex_contact_actions` (0 rows), `contact_history` (email automation) | `apex_contact_actions` for anything the workspace sends | Join key must be `application_id`. |

---

## 3. Workflow traces (today)

**T1 — Recruiter opens the pipeline and calls someone (DashboardApplicants)**
User clicks "Recruit Pipeline" → `/dashboard/recruiting` → `ProtectedRoute` (admin/manager/va/va_manager/recruiter) → `fetchScopedApplications` (`DashboardApplicants.tsx:370-401`): full pipeline for staff, attribution OR-filter for a plain agent, **one unpaged request** (797 live `record_type='application'` rows + 54 terminated) → clicks Call → `phoneHref` (desktop → Google Voice new tab) and `logContactAttempt(app.id,"call")` → `log_contact_attempt(..., 'initiated')` (RPC checks `can_work_application`; a **manager** outside attribution is refused with 42501 and the `.catch(() => undefined)` swallows it) → row in `application_contact_log` with outcome `initiated` → **no outcome capture, no `last_contacted_at`, no next action** → queue unchanged → audit = one `initiated` row. Broken links: outcome never recorded; refusal invisible; `last_contacted_at` untouched so the row stays "never contacted" in `v_va_call_queue`.

**T2 — VA works the Call Center**
`/dashboard/call-center` (any authenticated) → applications `.limit(500)` + aged_leads `.limit(500)` with `contacted_at` as the "new/contacted" truth (`CallCenter.tsx:256-261`; 466 live rows have a bulk-stamped `contacted_at`, so they are "contacted" here and "never contacted" in `v_va_call_queue`) → disposition button (8) → `applications.update({status, contacted_at, last_contacted_at})` (`:548-610`) and fire-and-forget `log_contact_attempt(outcomeMap[actionId])` → optional `send-post-call-followup` (Resend; **writes no log row** — grep of `supabase/functions/send-post-call-followup/index.ts` finds no insert) → queue auto-advances. Broken links: 332 live applications beyond the 500 cap are unreachable without filters; the outcome vocabulary (`not_a_fit, no_pickup, contacted, reschedule_requested, needs_followup…`) differs from every other surface; "needs_followup" sets no due date column the worklist can read (**unmeasured** which column — code at `:583-590` only shows `status`/timestamps).

**T3 — Recruiter logs a call outcome on RecruiterDashboard**
`/dashboard/recruiter` (internal gate) → list = applications in 4 statuses **plus consumer `aged_leads` with `status='contacted'`** → `handleCallOutcome` (`:415-431`) → `logLeadActivity` (insert `lead_activity`; RLS rejects unless assigned/manager/admin, warning swallowed) + `applications.update({last_contacted_at})` → XP toast. Saved record: `last_contacted_at` only; the chosen outcome (`no_answer/voicemail/interested/not_interested/wrong_number`) survives only in `lead_activity.details` when RLS allows. Note save overwrites `applications.notes`.

**T4 — Stage move**
AgentPipeline/DashboardApplicants Kanban → `license_progress` write (`AgentPipeline.tsx:277-282`, `DashboardApplicants.tsx:788-791`) → AgentPipeline additionally pings Discord (`:302`) and may call `add-agent` (`:319`). RecruitPipeline → `set_recruit_stage` → `next_step_progress` + `next_step_events` (+ `agents`/`applications`). HiringPipeline → `license_progress/status` + contact timestamps. RecruitingPipeline → `rp_pipeline_action('stage', <label>)` → `pipeline_stage_override` text (0 rows use it today). **Four write paths, three stores, no single stage history** (`next_step_events` 5,273 rows is the only append-only history, and only one path feeds it).

**T5 — Interview disposition**
Calendly webhook → `interview_events` (match_method instagram/email/phone/manual; 130 of 271 linked to an application) → InterviewRecovery → `cc_dispose_interview(outcome, notes, followup_due_at)` → `interview_events.outcome/outcome_at/outcome_by` + `applications.status` remap + `last_contacted_at` → undo sets outcome null (`InterviewRecovery.tsx:416-423`). Parallel: Interviews.tsx → `interviews-pipeline` → `hh_applicants.stage/interview_result` + `hh_activity`. Both rows describe the same booking for 84 live people; neither updates the other. Audit: `interview_events` has no history table (undo erases), `hh_activity` has field-level history.

**T6 — Stale recovery**
`v_stale_applicants` (contacted_at IS NULL, 60 d) returns 4 because `contacted_at` is bulk-stamped; `v_queue_stalled_applications` returns 670 (overdue SLA). StaleRecovery → `fn_recover_stale_applicant(action, new_agent_id, note)` → `application_contact_log` + `applications`. This is the only surface where reassignment writes a log row.

---

## 4. Defects (evidence, severity)

| ID | Sev | Where | What | Evidence |
|---|---|---|---|---|
| PCW-01 | P0 | `src/App.tsx:684-688`, `agentCloudNavigation.ts:132` | Starting URL `/dashboard/agent-pipeline` is the consumer-lead `ClientPipeline`; the recruiting `AgentPipeline` has no nav entry | `<Route path="/dashboard/agent-pipeline" element={<ProtectedRoute><ClientPipeline />…` ; `ClientPipeline.tsx:624-626` `eyebrow="Clients · Pipeline" title="Client sales cockpit"`; nav `{ label: "My Pipeline", href: "/dashboard/agent-pipeline" …}` |
| PCW-02 | P0 | `applications.assigned_agent_id/recruiter_id/referral_manager_id`, two `agents` rows named Samuel James | Ownership columns are always populated and 88.5 % Sam, so Unassigned/My Queue are meaningless and CallCenter's "unassigned" filter (`:277-280`, both null) can return nothing | 832/832 live rows have all three set; assigned_agent top: Samuel James 685, Samuel James 51, Xaviar 27, Obiajulu 23, Chudi 17, Aisha 12 (11 distinct owner ids); `assigned_va_id` set on 0; `agents` has 2 rows with display_name 'Samuel James', 1 with canonical_agent_id |
| PCW-03 | P0 | `DashboardApplicants.tsx:693-705`, `RecruiterDashboard.tsx:507,1554`, `CallCenter.tsx:548-560` | A link click is recorded as contact (`initiated` log row / `last_contacted_at` stamp); no provider event, no outcome | `p_outcome: "initiated"` + comment "fire-and-forget contact-attempt log. Never blocks tel:/sms:/mailto: navigation"; `application_contact_log` outcome dist: initiated 11 of 36 |
| PCW-04 | P0 | 5 stores, 4 vocabularies (`apexConfig.ts:147-151`, `CallCenterActions.tsx:43-114`, `ApplicationDispositionCluster.tsx:129-191`, `interview_events` CHECK, `application_contact_log.outcome` no CHECK) | No single outcome record; brief's vocabulary (`appointment booked`, `do not contact`) exists nowhere | `application_contact_log` lifetime 36 rows / 1 in 30 d / 1 distinct logger; `lead_activity` 23; `interview_events.outcome` set on 6 of 271; 473 live applications have no human-contact evidence in any store; constraint list shows only `channel` CHECK on `application_contact_log` |
| PCW-05 | P1 | `applications.next_step_due_at`, `next_action_due_at`, `next_touch_by`; cron `next_step_recompute_all` | Three next-action families; everything is overdue; nightly job rewrites `updated_at` on the whole book | 757 overdue / 18 future / 717 >30 d; 294 `next_action_due_at` all overdue (284 `MANAGER_CALL_72H_ESCALATION`, 10 `CALL_WITHIN_60_MIN`); `next_touch_by` 0; 747 rows updated at 2026-10-06 03:00 UTC in one minute |
| PCW-06 | P1 | `DashboardApplicants.tsx:2360-2389`, `HiringPipeline.tsx:30-37`, `KanbanBoard.tsx:44-138`, `v_recruiting_pipeline` CASE, `recruit_pipeline_list`, `RecruiterDashboard` PROGRESS_COLUMNS | Same person, different stage per screen | 244 live rows `status='new'` with `last_contacted_at` set (HiringPipeline "Applied", DA "Contacted"); 20 `no_pickup` rows have `next_step_stage_key` contacted 17/applied 1/null 2 while HiringPipeline has no `no_pickup` bucket; 5 of 8 applications with an `agents.source_application_id` still carry a non-hired status |
| PCW-07 | P1 | `interview_events` vs `hh_applicants`; `Interviews.tsx` vs `InterviewRecovery.tsx` | Two interview truths, neither updated by the other; outcomes mostly never recorded | 246 past `interview_events` with null outcome, 0 upcoming; 312 `hh_applicants` still `appointment_set` with all appointments in the past, 0 future; 84 live applications have both rows; `DashboardApplicants.tsx:481-518` reads both |
| PCW-08 | P1 | RLS on `applications`, `is_agency_staff()`, `interview_events_staff_write`, `candidate_notes_*`, `App.tsx:606` | A `recruiter`-role user is admitted by routes but no DB policy grants them applications, interview_events, candidate_notes or `can_work_application`; `/dashboard/recruits` omits recruiter | policy list has no recruiter clause; `is_agency_staff` = admin/va_manager/va; `user_roles` has 0 recruiter users today (latent, but the route allow-lists say otherwise) |
| PCW-09 | P1 | `CallCenter.tsx:161,236`, `CallCenterFilters.tsx:168,199`, `DashboardApplicants.tsx:370-401` (no range), `RecruiterDashboard.tsx:953`, `v_stale_applicants`, `v_recruiting_inbox` | Reach is a subset: 500-row caps, 1000-row PostgREST ceiling with no paging, status allow-list, 30/60-day windows | 832 live vs `.limit(500)`; 797 live `record_type='application'` fetched in one request (cap 1000; intake last 8 Phoenix weeks: 6,6,6,3,10,4,8,16 per week); RecruiterDashboard admits 770/832 (excludes no_pickup 20, paid 16, rejected 12, disqualified 8, onboarding 3, interview 2, attended_no_show 1) and merges consumer `aged_leads`; `v_stale_applicants` 4 rows because `contacted_at IS NULL` is defeated by the bulk stamp |
| PCW-10 | P1 | `AgentPipeline.tsx:218-220` | Silent empty pipeline for any user without an `agents` row (VAs, recruiters) | `if (!agentData) { setLoading(false); return; }` |
| PCW-11 | P1 | duplicates | Duplicate rows shown as people on HiringPipeline/CallCenter/RecruiterDashboard (no `is_duplicate` filter in their queries) | 102 live `is_duplicate`; 15 email groups / 37 rows; 16 phone groups; 832 live rows = 810 distinct emails; 39 live applications share an email with an active agent |
| PCW-12 | P2 | consent | Recruiting surfaces ignore consent/suppression flags when offering Text/Email | 115 live `sms_consent_given=false`, 141 `email_consent_given=false`, 7 `phone_bad_at`, 1 unsubscribed; grep hits for consent/unsubscribe/phone_bad: CallCenter 0, HiringPipeline 0, RecruiterDashboard 0, AgentPipeline 0, RecruitingPipeline 0, DashboardApplicants 11 |
| PCW-13 | P2 | `recruit_pipeline_list` residence COALESCE; `applications` has no tz column | Residence state inferred from `(g.license_states)[1]`; verified time zone impossible to show | function body: `fn_normalize_us_state(coalesce(g.metadata->>'resident_state', sa.state, ea.state, ala.residence_state, ala.state, (g.license_states)[1], a.state))`; 46 live rows `state IS NULL` |
| PCW-14 | P2 | `RecruiterDashboard.tsx:397-399`, `LeadDetailSheet.tsx:160` | Notes overwrite the single `applications.notes` column; `candidate_notes` unused | `.update({ notes: noteText })`; `candidate_notes` 0 rows |
| PCW-15 | P2 | `App.tsx:498`, `RecruitingWorkspaceNav.tsx:14`, `Interviews.tsx:294` | `/dashboard/recruiting/hires` renders the unfiltered applicants page; nav "Hires" goes to `interviews?tab=hired` whose list source is `[]` with a separate `renderActiveHires()` branch (`:732-733`) | no `useLocation`/`pathname` read in DashboardApplicants; `tab === "hired" ? [] : openAll` |
| PCW-16 | P2 | `notification_log`, `send-post-call-followup` | Provider events cannot be joined to applicants; post-call follow-up email writes no record | 0 of 1,695 rows in 30 d have `metadata.application_id`; edge fn has no insert |
| PCW-17 | P2 | `App.tsx:761,682` | `AgentPipelineSimple` ("pipeline-simple") and `RecruiterDashboard` mounted without `ProtectedRoute` (internal gates only); pipeline-simple is a manager-switch tool, not a pipeline | route lines quoted in §1.1 |
| PCW-18 | P2 | `RecruiterDashboard.tsx:960-975` | Consumer `aged_leads` merged into the recruiting list (brief: keep record types distinct) | `.from("aged_leads") … .eq("status","contacted")` normalised into `Lead[]` |

---

## 5. Measurements (live, 2026-10-05/06 UTC)

| Metric | Value |
|---|---|
| applications total / live (`terminated_at IS NULL`) | 854 / 832 |
| live by status | new 693 · reviewing 54 · contracting 23 · no_pickup 20 · paid 16 · rejected 12 · disqualified 8 · onboarding 3 · interview 2 · attended_no_show 1 (approved 0) |
| live `record_type` | application 797 live (819 total) · interview_booking 34 (all status new) · test 1 |
| live with any owner column / with `assigned_va_id` | 832 / 0 |
| distinct `assigned_agent_id` owners (live) | 11; Sam 685+51 = 736 (88.5 %) |
| live with any next-action column | 776; `next_step_due_at` 775 (757 overdue, 717 >30 d, 18 future); `next_action_due_at` 294 (294 overdue); `next_touch_by` 0 |
| `next_step_stage_key` (live) | applied 436 · contacted 272 · started_prelicense 48 · null 45 · finished_prelicense 16 · closed_lost 12 · passed_exam 3 |
| `next_step_progress` by status (application rows) | active 727 · closed_lost 70 · completed 8 |
| live unlicensed (`license_status='unlicensed'`) | 647 (+22+14+6+3+3+1 `pending` variants); licensed 139 |
| live older than 30 d / 90 d | 792 / 660 (oldest 2026-01-23, newest 2026-10-05) |
| `contacted_at` set / `last_contacted_at` set / both-missing-evidence | 825 / 359 / 473 with no `last_contacted_at`, no contact_log row, no non-email `contact_history` |
| `contacted_at` without `last_contacted_at` (bulk-stamp signature) | 466 |
| live `status='new'` with `last_contacted_at` | 244 |
| live unlicensed, never contacted, assigned to Sam | 323 |
| duplicates | `is_duplicate` 102 live; email groups 15 (37 rows); phone groups 16; 832 rows = 810 distinct emails |
| live applications whose email is an active agent | 39 |
| consent/suppression | sms false 115 · email false 141 · phone_bad 7 · email_bad 0 · telegram_opt_out 0 · unsubscribed 1 |
| `state IS NULL` / `phone IS NULL` (live) | 46 / 14 |
| contact stores | application_contact_log 36 (1 in 30 d) · lead_activity 23 · contact_history 7,607 (email 7,586) · apex_contact_actions 0 · candidate_notes 0 |
| interview_events | 271 (calendly 271; linked 130; outcome set 6; past-null-outcome 246; upcoming 0) |
| hh_applicants (not archived) | 376; appointment_set 312 (all past), future appointments 0; 159 match a live application by email/phone; 84 live applications hold both an interview_event and an hh row |
| notification_log 30 d | 1,695: sms-auto skipped 1,115 · sent 438 · email sent 112 · push failed 30 · with application_id 0 |
| outreach_queue | 1,133 (sent 726 · skipped 342 · pending 45 · error 20); sender cron INACTIVE |
| view sizes | v_recruiting_pipeline 962 · v_queue_stalled_applications 670 · v_va_call_queue 382 · v_recruiting_inbox 40 · v_stale_applicants 4 · v_interview_pipeline **unmeasured** (staff-gated; 0 under MCP role) |
| intake per Phoenix week (last 8) | 08-10:6 08-17:6 08-24:6 08-31:3 09-07:10 09-14:4 09-21:8 09-28:16 10-05:2 |
| roles | admin 2 · manager 10 · agent 563 · va_manager 2 · va 2 · recruiter 0 |

Unmeasured (and why): how many CallCenter sessions hit the 500 cap (no telemetry); what `needs_followup` writes beyond timestamps (code path not fully read); whether `rp_pipeline_action('note')` appends or overwrites (function body not read); live row count of `v_interview_pipeline` as a VA (needs a VA JWT, out of scope for a read-only mapper).

---

## 6. KEEP / REPAIR / MERGE / REMOVE

| Surface | File | Verdict | Target / reason |
|---|---|---|---|
| `/dashboard/agent-pipeline` (client cockpit) | `ClientPipeline.tsx` | KEEP (out of domain) but **REPAIR the route name**: redirect `/dashboard/agent-pipeline` → the recruiting worklist and move the client cockpit's canonical path to `/dashboard/clients` (already mounted `App.tsx:601`) | Sam's starting URL must open recruiting; sidebar "My Pipeline" relabelled "Clients" |
| `/dashboard/recruit-pipeline` Kanban | `AgentPipeline.tsx` + `KanbanBoard.tsx` | MERGE | Its board becomes the optional board view of the worklist, driven by `next_step_stage_key` not `license_progress`; keep `check:kanban-stage-vocabulary` satisfied by mapping columns to `next_step_stages` and updating the catalog, or retire the board's `license_progress` write and the guard's write-path clause with a red-fixture proof |
| `/dashboard/recruiting` Applicants | `DashboardApplicants.tsx` | REPAIR → becomes **the** worklist (`/dashboard/recruiting`) | paginate (`.range` loop or server RPC), saved queues, outcome capture, drop link-click logging |
| `/dashboard/recruiting/pipeline` | `RecruitingPipeline.tsx` + `v_recruiting_pipeline` + `rp_pipeline_action` | MERGE into worklist, then REMOVE | duplicate "everyone" list with its own label vocabulary and `pipeline_stage_override`; view runs as owner with no role predicate |
| `/dashboard/recruiting/interviews` | `Interviews.tsx` | REMOVE as destination (brief §3); MERGE booking/decide into the person drawer + Calendar | keep `interviews-pipeline` edge fn for the onboarding-calls list until domain 05 owns it |
| `/dashboard/recruiting/follow-ups` | `InterviewRecovery.tsx` | REMOVE as destination; MERGE disposition UI (`cc_dispose_interview`, hotkeys 4-7) into the worklist "Due/Overdue" queue and the drawer | it is the only screen that records interview outcomes properly |
| `/dashboard/recruiting/hires` | `App.tsx:498` | REMOVE (redirect → `/dashboard/recruiting?queue=hired`) | renders unfiltered applicants today |
| `/dashboard/recruits` Recruit Stages | `RecruitPipeline.tsx` + `recruit_pipeline_list` + `set_recruit_stage` | KEEP (brief: preserve) + REPAIR | add recruiter role to route and RPC; stop residence inference from `license_states[1]`; share the stage vocabulary with the worklist |
| `/dashboard/hiring-pipeline` | `HiringPipeline.tsx` | REMOVE (redirect → worklist board view) | third board, own 7-stage vocabulary, writes contact timestamps directly |
| `/dashboard/recruiter` | `RecruiterDashboard.tsx` | REMOVE (redirect → worklist, `?queue=mine`) | gamified duplicate; merges consumer aged_leads; overwrites notes; no ProtectedRoute |
| `/dashboard/call-center` | `CallCenter.tsx` + `components/callcenter/*` | REPAIR, then MERGE as the worklist's "dial mode" | keep the 8-key disposition UX and voice recorder; route dispositions through the new outcome RPC; remove 500 cap; separate aged_leads (consumer) into its own queue or the client cockpit |
| `/dashboard/pipeline-simple` | `AgentPipelineSimple.tsx` | REMOVE from this domain (rename route to `/dashboard/manager-switch`, wrap in ProtectedRoute) | not a pipeline |
| `/dashboard/stale-recovery` | `StaleRecovery.tsx` | MERGE → worklist "Overdue" queue uses `v_queue_stalled_applications`; REMOVE `v_stale_applicants` dependence | its predicate is defeated by bulk `contacted_at` |
| `/admin/my-applicants` | `admin/MyApplicants.tsx` | REMOVE (redirect → `?queue=mine`) | one attribution column only |
| `/dashboard/old-applicants/*` | `OldApplicants.tsx` | MERGE → queue filter "older than 90 d" | — |
| `/admin/licensed-inbox` | `LicensedInbox.tsx` | KEEP (guarded by `check:contact-actions`) | its outbox is the model for provider-receipt sends |
| `/admin/recovery-queue`, `/admin/unlicensed-all` | `admin/RecoveryQueue.tsx`, `admin/UnlicensedAll.tsx` | KEEP for now; MERGE later as queues "Unlicensed · never contacted" / "Unlicensed · VA" | they already use `unified_*` RPCs + `log_contact_attempt`; domain 05/06 overlap |
| `ApplicationDispositionCluster` | `components/applicants/…` | REPAIR | route through the outcome RPC instead of direct insert; adopt the canonical vocabulary |
| `LeadDetailSheet`, `ActivityTimeline` | `components/recruiter/…` | MERGE into the person drawer | timeline should read `application_contact_log` ∪ `interview_events` ∪ `next_step_events` |
| `NoHireLeftBehindPanel`, `RecruitingCommandHero`, funnel visuals | `components/recruiting/…` | KEEP (owned by domain 05) | — |
| `next-step/*` | `components/next-step/…` | KEEP | `v_next_step_*` are the stage/SLA truth the worklist should read |
| Jobs | `next_step_recompute_all`, `next_step_stall_sweep`, nudges | KEEP; REPAIR `recompute_all` to stop bumping `updated_at` (or add `touched_by_human_at`) | — |

---

## 7. Recommended implementation plan (this domain)

**Principle**: one worklist page (`DashboardApplicants.tsx` repaired, route `/dashboard/recruiting`), one optional board (KanbanBoard driven by `next_step_stage_key`), one person drawer, one outcome RPC, one next-action RPC. Everything else redirects.

### 7.1 Database (additive, one migration file in `supabase/migrations/`, mirrored via MCP)

1. `application_contact_log`: add `outcome` CHECK (`no_answer, voicemail, callback, interested, appointment_booked, not_interested, wrong_number, do_not_contact, left_message, texted, emailed, note, initiated_legacy`) — **first** `UPDATE` the 36 existing rows into the new vocabulary (`initiated`→`initiated_legacy`, `called`→`left_message`? no — keep `called`→`initiated_legacy`, `no_answer` stays, `bad_number`→`wrong_number`, `pass`→`not_interested`, `texted`/`text_sent`→`texted`, `emailed`→`emailed`, `voicemail`→`voicemail`, `test-proof`→`note`), then add the constraint `NOT VALID` + `VALIDATE`. Add columns `is_manual boolean not null default true`, `provider_event_id text`, `next_action text`, `next_action_due_at timestamptz`, `source_surface text`.
2. New RPC `record_contact_outcome(p_application_id, p_channel, p_outcome, p_notes, p_next_action, p_next_action_due_at)` SECURITY DEFINER: auth via `can_work_application` **widened** to include `manager` (team) and `recruiter` (org-wide, matching the route allow-lists); inserts the log row; sets `applications.last_contacted_at = now()` only for outcomes that are real conversations or attempts (never for `note`); sets `applications.next_action/next_action_due_at`; on `do_not_contact` sets `sms_consent_given=false, email_consent_given=false` and `phone_bad_at` is **not** touched (different meaning); on `wrong_number` calls `mark_phone_bad`; on `appointment_booked` writes `interview_events(source='manual', call_track, scheduled_at)` so Calendar and Pipeline share one event; emits `next_step_events` row. Returns the updated application row.
3. New RPC `set_application_owner(p_application_id, p_owner_agent_id, p_owner_va_id, p_reason)` writing `assigned_agent_id`/`assigned_va_id` + a log row (`channel='note'`, `outcome='note'`), restricted to admin/manager/va_manager. One-time **data repair proposal (needs Sam)**: clear the default-routed Sam ownership into `unassigned` for the 323 live unlicensed never-contacted rows so the Unassigned queue is real; keep `referral_manager_id` as attribution history (do not null it).
4. `applications`: add `owner_user_id uuid` **only if** `assigned_agent_id` cannot represent VAs; otherwise use `assigned_va_id` (exists, 0 rows). Add `residence_state text` is **not** needed — `state` is residence; instead stop deriving residence from `licensed_states` in `recruit_pipeline_list`. Add `time_zone text` (nullable, never inferred from phone; filled from intake form or NIPR data).
5. RLS: add `applications_recruiter_read/update` for role `recruiter` (org-wide, mirroring `applications_va_read`), and extend `interview_events_staff_write`, `candidate_notes_*`, `is_agency_staff()` → either include `recruiter` or create `is_recruiting_staff()` and use it in `can_work_application`. Measure as a recruiter JWT afterwards (brief memory: owner-run views leak).
6. New view `v_recruiting_worklist` (**security_invoker = on**): one row per live, non-duplicate application (`record_type='application'`), columns: name, phone, email, `state` as residence, `time_zone`, `license_status`, `license_progress`, `next_step_stage_key`, stage display from `next_step_stages`, owner (agent + VA names), `last_contact_at` = greatest(`last_contacted_at`, max log `logged_at` where outcome ≠ note), `last_outcome`, `next_action`, `next_action_due_at` = coalesce(`next_action_due_at`, `next_step_due_at`), `blocker` (phone_bad / sms false / email false / unsubscribed / do_not_contact), `awaiting_reply` (last outcome in callback/texted/emailed and no response), `upcoming_interview_at` from `interview_events`. Queue predicates live in SQL functions so the UI and the guard execute the same text (pattern from `check-roster-segment-placeholders.mjs`).
7. `next_step_recompute_all`: stop writing `updated_at` (or write `recomputed_at`), so "last touched" means a human.

### 7.2 Frontend

- `DashboardApplicants.tsx`: replace the single fetch with `v_recruiting_worklist` paged by `.range` (page 200) or a server RPC with keyset pagination; saved queues `new | uncontacted | due_today | overdue | awaiting_reply | unassigned | mine` as URL state (`?queue=`), plus "Mine" vs "Everyone" toggle labelled explicitly; columns per brief §5; drawer beside the list (reuse `LeadDetailSheet` shell); outcome cluster = canonical vocabulary calling `record_contact_outcome`; **remove** `logContactAttempt("initiated")` on link click (keep `phoneHref/smsHref/contactLinkProps` so `check:recruiting-contact-actions` stays green); disable Text/Email controls when consent is false / unsubscribed / phone_bad and show the blocker chip; preserve filters/scroll/selected id/unsent note in `sessionStorage` keyed by user.
- `KanbanBoard.tsx`: columns = `next_step_stages` (active, non-terminal) and drop → `set_recruit_stage`; update `scripts/data/enum-catalog.json` consumers only if the board still writes `license_progress` (preferred: it does not; then the guard's AgentPipeline/DashboardApplicants write-path clause needs a red-fixture-proven edit).
- `CallCenter.tsx`: dispositions map to the canonical vocabulary via `record_contact_outcome`; applications list paged, no `.limit(500)`; aged_leads moved behind a "Consumer leads" source toggle that never mixes stages.
- Redirect shims in `App.tsx` for `/dashboard/recruiter`, `/dashboard/hiring-pipeline`, `/dashboard/recruiting/pipeline`, `/dashboard/recruiting/hires`, `/dashboard/recruiting/interviews`, `/dashboard/recruiting/follow-ups`, `/admin/my-applicants`, `/dashboard/stale-recovery`, `/dashboard/recruit-pipeline`, `/dashboard/agent-pipeline` → `/dashboard/recruiting?…` (no loops: targets are terminal routes). Remove nav items in `agentCloudNavigation.ts`, `MobileBottomNav.tsx`, `CommandPalette.tsx`, `RecruitingWorkspaceNav.tsx`; run `check:sidebar-routes`, `check:orphan-pages`, `check:dead-internal-links`.
- `Interviews.tsx` / `InterviewRecovery.tsx`: lift the disposition component (hotkeys, follow-up date) into the drawer; booking via Calendly link + manual `interview_events` insert; delete pages after redirects land (orphan-pages guard).

### 7.3 Tests to write (vitest, synthetic rows)

- `src/tests/lib/contactOutcomeVocabulary.test.ts`: the UI vocabulary constant equals the CHECK list parsed from the migration file (no second copy).
- `src/tests/pages/recruitingWorklistContract.test.ts`: queue predicates (SQL text lifted from the view/function file) classify fixture rows correctly incl. a bulk-stamped `contacted_at`-only row as **uncontacted**, a consent-false row as blocked, a `callback` row as awaiting_reply.
- Pagination contract: the worklist loader issues `.range` until a short page; a fixture of 1,250 rows yields 1,250.
- Redirect map test: every retired path resolves to a mounted route and no redirect target is itself a redirect.
- Role matrix test for `can_work_application`/`record_contact_outcome` using `apex-sql-as.sh` style JWTs (admin, manager-in-team, manager-out-of-team, va, recruiter, agent-attributed, agent-unattributed) — proven both green and red.
- Extend `check:recruiting-contact-actions` file list with the worklist/drawer files; extend `check:kanban-stage-vocabulary` only with a red-fixture proof if the board's write target changes.

### 7.4 Guards affected

`check:recruiting-contact-actions` (file list + no raw tel:/sms:), `check:kanban-stage-vocabulary` (board write path), `check:contact-actions` (if LicensedInbox's dispatcher is reused for sends), `check:sidebar-routes`, `check:orphan-pages`, `check:dead-internal-links`, `check:enum-filter-literals` (new status literals), `check:maybesingle-nonunique` (agents by `user_id` lookups in AgentPipeline/DashboardApplicants — 2 Sam rows prove the ambiguity), `check:stale-key-in-list`, `check:tsc-error-count` baseline, `check:metric-truth` (queue counts must reconcile to the drill-down).

---

## 8. Risks and open questions

- **Ownership repair is a data decision, not code**: nulling Sam's default assignment on 323+ rows changes what `AgentPipeline`/RLS attribution shows to Sam's agent login; `referral_manager_id` must stay for income attribution (recruiter bounties cron reads it — **unmeasured** which column `apex-recruiter-bounties-15min` uses).
- **Two Sam agent rows** (685 + 51) — merging is domain 02/03 work (agent identity); the worklist must group by `canonical_agent_id` meanwhile.
- **`contacted_at` cannot be trusted and cannot be deleted** — treat as legacy, never display; several views (`v_stale_applicants`, CallCenter filters) must switch to `last_contacted_at`/log-derived truth.
- **The `interview_booking` record_type (34 rows)** is excluded by `DashboardApplicants` (`.eq record_type 'application'`) but included by every other page — decide whether these are people or bookings.
- **hh_applicants** — 312 stale `appointment_set` rows; archiving/mirroring policy belongs with the Headhunter owner; the worklist should read only `interview_events`.
- **Discord**: `AgentPipeline.tsx:302` posts stage changes to Discord; brief says remove Discord-facing steps from the applicant journey — confirm the webhook target is Sam-only before deleting.
- **Recruiter role has zero users** — adding policies is low risk now; whether Sam intends VAs or a new "recruiter" role to work the queue decides the RLS shape.
- **Open**: does `rp_pipeline_action('note')` append (`notes || …`) or overwrite? Does `needs_followup` in CallCenter set any due date? What does Sam want "Awaiting reply" to mean when no inbound channel (SMS replies, email opens) is captured against `application_id` today (0 of 1,695 notification rows link)?
- **Blind spot**: no browser/authenticated-tab verification was performed; all UI claims are from source.
