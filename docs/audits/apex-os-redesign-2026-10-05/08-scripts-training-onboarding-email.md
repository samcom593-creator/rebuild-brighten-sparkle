# 08 — Scripts, Training Completion, Onboarding Email (domain map)

Program: APEX OS redesign 2026-10-05 · Repo HEAD `4ea291c8` · Supabase `xrzweoneiieddzxogewk`
Mode: READ-ONLY mapper. Nothing in the repo or DB was changed. All DB numbers measured live on 2026-10-05 via Supabase MCP `execute_sql` (read-only). Where a number could not be measured it says **unmeasured**.

Spec clause owned here: brief §9 "Automatically deliver scripts after hiring and training" + the §3 instruction "Scripts → approved resources delivered after hiring and training completion" + Sam's "validate all emails / make all practices perfect / no stupid Discord things" + release gate F (TRAINING EMAIL).

---

## 1. What exists today

### 1.1 Routes and pages (src/App.tsx)

| Route | Component | Guard | Line |
|---|---|---|---|
| `/dashboard/scripts` | `src/pages/Scripts.tsx` | ProtectedRoute (any authed) | App.tsx:711 |
| `/dashboard/handbook` | `src/pages/AgentHandbook.tsx` | ProtectedRoute | App.tsx:715 |
| `/dashboard/training` | `ApexTrainingEntry.tsx` (16 lines, router) | ProtectedRoute | App.tsx:513 |
| `/dashboard/training/library` | `src/pages/TrainingHub.tsx` | ProtectedRoute | App.tsx:514 |
| `/dashboard/training/library/course/:courseId` | `TrainingHubCourse.tsx` | ProtectedRoute | App.tsx:515 |
| `/dashboard/training/sales-course` | `src/pages/CourseCatalog.tsx` | ProtectedRoute | App.tsx:516 |
| `/dashboard/training/progress` | `src/pages/CourseProgress.tsx` | requireAdmin allowManagers + va_manager/va/recruiter | App.tsx:517 |
| `/dashboard/training/content` | `src/pages/CourseContent.tsx` | same as progress | App.tsx:518 |
| `/dashboard/training/annuities` | `AnnuityTraining.tsx` | ProtectedRoute | App.tsx:519 |
| `/dashboard/recruiting/training/*` | duplicate tree of the six routes above | | App.tsx:499-505 |
| `/resources/licensing` | `ResourcesLicensing.tsx` (public) | none | App.tsx:426 |
| `/training` | `TrainingIndex.tsx` (public) | none | App.tsx:428 |
| Legacy redirects: `/dashboard/resources`, `/onboarding-course`, `/course-catalog`, `/dashboard/training-hub`, `/course-progress`, `/course-progress/content` → `LegacyWorkspaceRedirect` | | | App.tsx:545, 654-662 |

Navigation: the only sidebar entry is `src/components/layout/agentCloudNavigation.ts:173` — `{ label: "Scripts", href: "/dashboard/scripts", icon: ScrollText }` inside the **Learn** group (`modes: PRODUCERS`), beside Field Course / Training Home / Call Lab.

In-app string references to the route that will dangle when the tab goes: `src/pages/AgentHandbook.tsx:62` ("Full scripts live at /dashboard/scripts."), `:77` ("use /dashboard/scripts → Recruiting"); `src/pages/HelpCenter.tsx:46, :48, :76` (three FAQ answers point at `/dashboard/scripts → Inbound / Objections / Brand`); `src/pages/GettingStarted.tsx:59` (checklist item "Ran first appointment" has `href: "/dashboard/scripts"`). `check-dead-internal-links.mjs:105` greps `href="/..."` literals, so GettingStarted:59 and the nav entry are guard-visible; the prose references in AgentHandbook/HelpCenter are not.

### 1.2 The Scripts page (what the retired tab actually is)

`src/pages/Scripts.tsx` (257 lines) reads **`sales_scripts`** (`.from("sales_scripts").select("id, title, category, body, tags, author_name, sort_order").eq("is_active", true)`, lines 50-62), renders four category pills (inbound / objections / recruiting / brand), click-to-copy, and a gradient hero with four KPI tiles (TOTAL SCRIPTS / CATEGORIES / INBOUND / OBJECTIONS) — the hero is the kind of decorative noise the brief's §2 wants gone.

Second reader of the same table: `src/pages/CallLabLive.tsx:133-135` ("The team's own scripts, one click away. Reads sales_scripts") — this is the in-workflow use that must survive.

### 1.3 Training surfaces

- **`TrainingHub.tsx`** (830 lines) — "Training center". Content is NOT in this database: `src/lib/apexResourcesHub.ts:15` fetches `https://apex-resources.vercel.app/api/data` (open CORS, separate Vercel app, content-team password). Per-user progress for those hub courses is in `public.hub_course_progress` (TrainingHub.tsx:198). Renders `<RequiredOnboardingResources />` (TrainingHub.tsx:313).
- **`RequiredOnboardingResources.tsx`** — the "Practice toolkit": (1) Field-release course → `TRAINING_ROUTES.fieldCourse` = `/dashboard/training/sales-course`; (2) "Official APEX script" → a hard-coded **Google Doc** URL (`docs.google.com/document/d/1OeDu_6TAB…`, line 19); (3) a `tel:` card for onboarding help. The component's own copy says "The three essentials", but the array holds two.
- **`CourseCatalog.tsx` / `OnboardingCourse.tsx` / `useOnboardingCourse.ts`** — the APEX sales course. Tables: `onboarding_modules` (hook line 112), `onboarding_questions` (164), `onboarding_progress` (187-319). Completion logic is client-side: `useOnboardingCourse.ts:336-347` — after a passing quiz, `modules.every(m => progress[m.id]?.passed)` → `supabase.functions.invoke("notify-course-complete", { body: { agentId } })`.
- **`CourseProgress.tsx`** (809 lines, admin) — reads `onboarding_modules` where `is_active` (166-168) and the RPC `my_course_progress()` (190); `percentComplete = completedCount / totalModules` (209-210); "complete" = `percentComplete >= 100` (401). Actions: `send-course-reminder` (263, 351), `trigger-new-hire-flow` (290).
- **`AgentHandbook.tsx`** (267 lines) — static prose handbook, no DB reads; `/dashboard/handbook`.
- **`ResourcesLicensing.tsx`** (597 lines, public) — static mirror the hub file header calls frozen ("froze at 13 recordings on 2026-07-01 while the live library grew to 22", apexResourcesHub.ts:8-9).

### 1.4 Tables, views, functions, jobs (live catalog)

**Do not exist** (checked with `to_regclass`, every schema): `course_modules`, `course_progress`, `course_questions`, `courses`, `onboarding_email_queue`, `agent_onboarding_emails`, `onboarding_emails`, `email_outbox`. The prompt's names `courses / modules / course_progress / assessments` and `onboarding_email_*` map to the real objects below. `src/types/course.ts` still calls the shapes `CourseModule / CourseProgress`, which is why the names look familiar.

| Object | Kind | Role | Key columns / notes |
|---|---|---|---|
| `onboarding_modules` | table | the APEX sales-course curriculum | `id, order_index, title, description, video_url, pass_threshold, is_active, phase_key, duration_seconds, learning_objectives, transcript_segments, transcript_kind, media_has_audio, poster_url, video_parts`. **No `is_required` / optional flag exists.** |
| `onboarding_questions` | table | quiz bank | 57 rows; `module_id, question, options, correct_answer, explanation, order_index` |
| `onboarding_progress` | table | per-agent per-module state | `agent_id, module_id, video_watched_percent, started_at, completed_at, score, attempts, answers, passed`. RLS: agents INSERT/UPDATE own rows (`with_check (agent_id = current_agent_id())`, UPDATE has **no with_check**). |
| `hub_course_progress` | table | progress on apex-resources hub courses | unique `(user_id, course_id, item_id)`; 55 rows / 11 users / 3 course ids (`r-mpyl24wi, r-mqv77rk9, r-mrja87o1`) |
| `sales_scripts` | table | the scripts library | 11 rows, all `is_active`; categories brand/inbound/objections/recruiting; RLS `sales_scripts_read: SELECT to {public} using (is_active = true)` |
| `agent_onboarding_queue` | table | **the onboarding email queue** | `agent_id, email_kind, target_send_at, sent_at, attempt_count, last_error, resend_message_id, created_at, meta`; UNIQUE `(agent_id, email_kind)`; CHECK `email_kind IN ('course','discord','hired_whatsapp','onboarding_call','get_licensed')` |
| `notification_log` | table | generic send log (176k rows est.) | `channel, status, subject, notification_type, recipient_*` |
| `outbox_events` + `messaging_delivery_receipts` | tables | Slack/Discord/system outbox (MP-foundation) | receipts carry `idempotency_key, provider, status, template_version, delivered_at` — a real receipt model, but **email is not routed through it** |
| `license_milestone_outbox` | table | SMS milestone outbox for applications | not email |
| `v_agent_training_stage` | view | test/classroom/field/active ladder | derived from `agents.first_deal_at / field_training_started_at / onboarding_completed_at`, with `training_stage_override` |
| `v_hired_licensed_missing_course` | view | "routing gap" detector | hired+licensed agents missing `course`/`discord` queue rows or `has_training_course=false`; **0 rows** today |
| `fn_enqueue_agent_onboarding_emails()` | trigger fn | AFTER INSERT on agents (`agents_after_insert_enqueue_onboarding`) | licensed → `course`+`discord`; else `get_licensed`+`discord` |
| `fn_enqueue_hired_licensed_onboarding()` | trigger fn | `trg_agents_hired_licensed_enqueue` on agents (INSERT + UPDATE) | employment gate (status active, not deactivated/inactive); fires on stage→live, status→active, or any license_status change; licensed → sets `has_training_course=true`, enqueues `course`+`discord` at `now()`, calls `fn_enqueue_onboarding_call_booking`; unlicensed → `get_licensed`+`discord` |
| `fn_onboarding_email_backfill_sweep()` | fn, pg_cron `apex-onboarding-email-backfill-hourly` (`15 * * * *`) | hourly sweep for hires <30d missing queue rows | still inserts `discord` rows |
| `fn_next_onboarding_window()` | fn | next 09:30 US/Central | used by the INSERT trigger only |
| `my_course_progress()` | RPC | admin/staff/manager progress rollup | `total_modules = count(*) where is_active` |
| `set_agent_training_stage()` | RPC | manual ladder override | writes `onboarding_completed_at = coalesce(.., now())` for classroom/field/active |
| pg_cron `apex-agent-onboarding-emails-hourly` (`7 * * * *`), `-cdt` (`0 15`), `-cst` (`0 16`) | jobs | `net.http_post` → `send-agent-onboarding-email` | three jobs drain one queue |
| pg_cron `apex-email-status` | job | **ABSENT** from `cron.job` (scheduled by migration `20260419213557`, `run_automation_job('apex-email-status', 'check-email-status')`) | Resend delivery status is never synced on a timer |

### 1.5 Edge functions in this domain

| Function | verify_jwt (config.toml) | What it does |
|---|---|---|
| `send-agent-onboarding-email` (707 lines) | false (bearer check at :652-661) | drains `agent_onboarding_queue` where `sent_at is null and attempt_count < 5` (:413-415); per kind builds `course` (:201) / community Slack+Discord (:241) / onboarding call (:289) / get-licensed; cohort gate :533-541; marks `sent_at + resend_message_id` on Resend `data.id` (:618-621); `hired_whatsapp` retired at :430-433 |
| `notify-course-complete` (324 lines) | **false, no auth check** (:24-35 reads body and proceeds) | emails admins + agent via Resend (:262, :277), then `update agents set onboarding_stage = 'in_field_training'` (:294-296). Reads `onboarding_progress` **0 times**; trusts `agentId` from the client. Discord CTA + "10:00 AM CST on Discord" (:216-231). |
| `send-course-enrollment-email` (287) | false; `requireSendAuth(floor: "any_authenticated")` (:61) | magic-login token (:28) + enrollment email; writes `email_tracking` (:142) |
| `bulk-resend-course-emails` (125) | false | iterates agents `has_training_course = true` (:25) |
| `self-enroll-course` (244) | false | flips `has_training_course=true, onboarding_stage='training_online'` (:59) |
| `send-course-reminder` (315) | false | admin-gated reminder (:76) |
| `notify-course-started`, `notify-module-progress`, `send-course-hurry-emails`, `notify-training-reminder` | false | adjacent notifiers (not traced in depth) |
| `check-email-status` (171) | — | on-demand Resend status lookup; invoked only from `AgentNumbersLogin.tsx:110`; no cron |

---

## 2. Authoritative records

| Question | Authoritative record | Not authoritative |
|---|---|---|
| Is this person hired? | `agents.status = 'active'` AND `coalesce(is_deactivated,false)=false` AND `coalesce(is_inactive,false)=false` (the MP-353 employment gate in `fn_enqueue_hired_licensed_onboarding`), plus dedupe on `canonical_agent_id`/GHOST% | `onboarding_stage='live'` alone; `has_training_course` |
| Is this person licensed? | `agents.license_status = 'licensed'` | `applications.license_status` (self-reported, 0 NIPR-verified — brief memory) |
| Which training is assigned? | `onboarding_modules where is_active` (6 of 19 rows) | the 13 inactive module rows; hub courses |
| Has a module been passed? | `onboarding_progress.passed = true` for `(agent_id, module_id)` | `video_watched_percent`; the client's `allModulesPassed` boolean |
| Is training complete? | derived: for every active module there is a passed progress row | `agents.onboarding_completed_at` (set by stage buttons: `set_agent_training_stage`, `fn_next_step_manual_advance`, `set_recruit_stage`, `BulkStageActions.tsx:156`, `OnboardingTracker.tsx:94` — **37 agents have it set; only 7 agents have all 6 active modules passed**) |
| Was an onboarding email sent? | `agent_onboarding_queue.sent_at` + `resend_message_id` (= provider **accepted**) | `notification_log` (notification_type is NULL on 1,695/1,695 rows in 30d; course sends do not appear there) |
| Was it delivered? | **nothing** — no Resend webhook handler, `apex-email-status` cron absent | the word "sent" on `AgentOnboardingEmailStatus.tsx:124` is correct as "accepted", never "delivered" |
| What is the approved scripts packet? | `sales_scripts` (11 rows; the 13,596-char "Veteran Final Expense — Full Call Script" by Sam James updated 2026-08-31 + 10 starter rows from 2026-06-14) **plus** the Google Doc hard-coded in `RequiredOnboardingResources.tsx:19` **plus** the apex-resources hub "scripts" seed item (apexResourcesHub.ts:12) | none of these three is versioned or marked "approved"; nothing records which version anyone received |

---

## 3. Workflow traces

### 3.1 Today: hire → onboarding email
1. **User action** — admin flips a hire via `HireStageControl` / Add Agent / invite acceptance; writes `agents` (status→active or onboarding_stage→live or license_status change).
2. **Authorization** — RLS on `agents`; stage writes go through the gated RPC (MP-392).
3. **Backend** — `trg_agents_hired_licensed_enqueue` → `fn_enqueue_hired_licensed_onboarding()`: employment gate; licensed → `INSERT agent_onboarding_queue ('course', now()), ('discord', now()) ON CONFLICT DO NOTHING` + `has_training_course=true`; unlicensed → `('get_licensed'), ('discord')`. Belt-and-braces: AFTER INSERT trigger `agents_after_insert_enqueue_onboarding` and the hourly `fn_onboarding_email_backfill_sweep()`.
4. **Saved record** — a queue row per kind; `UNIQUE (agent_id, email_kind)` is the de-dupe.
5. **Automation** — three pg_cron jobs POST `send-agent-onboarding-email`; it re-checks agent status, cohort (`course` requires licensed, :533), profile email, builds the email, POSTs `api.resend.com/emails` with `from`, `to`, `subject`, `html`, `text`, `reply_to: "info@kingofsales.net"` (:336-349), and on `data.id` sets `sent_at, resend_message_id`.
6. **Updated interface** — `AgentOnboardingEmailStatus.tsx` ("Course sent · <time>" / "Course queued · next drain ≤ 1h"), `AdminEmailGaps.tsx` ("Licensed agents whose course email never went out"), `TeamEngagementPanel.tsx`, `v_hired_licensed_missing_course`.
7. **Audit history** — the queue row itself (attempt_count, last_error). No delivery, bounce or open event ever lands.

**Broken links**: (a) the "course" email is sent at **hire**, before any training — there is no "training complete" condition anywhere in the chain; (b) `discord` kind is still enqueued by all three enqueue paths; (c) delivery is never observed; (d) the course email body (:201-239) links to `/dashboard/training/library` and the roadmap, **not to the scripts** — so no scripts packet is ever emailed by this engine.

### 3.2 Today: training completion
1. **User action** — agent passes the last quiz in `OnboardingCourse.tsx`.
2. **Authorization** — RLS lets the agent INSERT/UPDATE its own `onboarding_progress` row (with_check on INSERT only).
3. **Backend** — `useOnboardingCourse.ts:300-319` upserts `passed, score, completed_at`; `:336-347` computes `allModulesPassed` **in the browser** and invokes `notify-course-complete`.
4. **Saved record** — `onboarding_progress` rows. No completion event row anywhere.
5. **Automation** — `notify-course-complete` (no JWT, no auth check, no progress re-check) emails admins + agent and writes `agents.onboarding_stage = 'in_field_training'`.
6. **Updated interface** — `CourseProgress.tsx` percent ring; `v_agent_training_stage` moves to `field` because `onboarding_stage = 'in_field_training'`.
7. **Audit history** — none for the completion itself (the fn's own comment at :297-300 says the former `agent_onboarding` log table never existed).

**Broken links**: completion is a client-only flag (brief §9 forbids this); the fn is callable unauthenticated with any `agentId`; a page refresh after the last quiz does not re-fire, a double-click fires twice (two admin emails, two agent emails; no idempotency key); an admin "Mark classroom" button sets `onboarding_completed_at` without any module being passed.

### 3.3 Required by brief §9 (target trace, not yet implemented)
hired(committed) ∧ all-active-required-modules-passed(committed) → one eligibility row keyed `(agent_id, packet_version)` → queued → provider accepted (`resend_message_id`) → delivered-where-reported (Resend webhook) → failed/retry → authorized resend (admin action creating a NEW row with a new send key, never un-marking the old one). See §7.

---

## 4. Defects (evidence + severity)

**D1 · P0 · The §9 trigger does not exist.** The only "course email" fires at hire (`fn_enqueue_hired_licensed_onboarding`: `values (new.id, 'course', now())`) with no training condition; `notify-course-complete` has no hire condition and no scripts. Nothing evaluates "hired AND training complete" from committed state. Evidence: live function body above; `grep -c onboarding_progress supabase/functions/notify-course-complete/index.ts` = 0.

**D2 · P0 · Training completion is client-asserted and the completion endpoint is unauthenticated.** `useOnboardingCourse.ts:337-339` computes `allModulesPassed` in the browser; `supabase/config.toml:184-185` `verify_jwt = false`; `notify-course-complete/index.ts:24-35` reads `{ agentId }` from the body with no bearer check and then `update agents set onboarding_stage='in_field_training'` (:294-296). Any caller can advance any agent's stage and trigger two emails.

**D3 · P1 · No required/optional distinction in the curriculum.** `onboarding_modules` has `is_active` and `phase_key` (foundation, systems) and nothing else; 6 of 19 rows active. Brief §9: "Optional courses must not silently block completion" — today every active module blocks, and deactivating a module silently *completes* people (completion = count(passed) over `is_active`, `my_course_progress()`).

**D4 · P1 · Two contradicting "training complete" truths.** `agents.onboarding_completed_at` is set on 37 agents by five stage writers; only 7 agents (6 hired) have all 6 active modules passed. `v_agent_training_stage` reads the column, `CourseProgress.tsx` reads the modules.

**D5 · P1 · `discord` is still a first-class onboarding email kind.** Live CHECK includes `'discord'`; all three enqueue paths insert it (`fn_enqueue_hired_licensed_onboarding`, `fn_enqueue_agent_onboarding_emails`, `fn_onboarding_email_backfill_sweep`); 108 rows (89 sent, 19 failed) exist; `send-agent-onboarding-email/index.ts:241-287` subject "Join APEX Slack + Discord — your team access". `AgentOnboardingEmailStatus.tsx:92-93` re-enqueues both kinds on manual resend. Sam: "no stupid Discord things".

**D6 · P1 · The scripts packet is publicly readable and unversioned.** `pg_policies`: `sales_scripts_read SELECT to {public} using (is_active = true)` — measured: `set local role anon; select count(*) from sales_scripts` = **11**. Brief §9 requires "secure resource access". No `version`, `approved_at`, `approved_by` columns exist; the table has `updated_at` only.

**D7 · P1 · Delivery is never observed anywhere in the email layer.** Of 108 edge functions calling Resend: 14 send an `Idempotency-Key`, 5 set `List-Unsubscribe`, 9 set `reply_to`, 23 include a `text` part. No Resend event webhook function exists (`ls supabase/functions | grep -i -E "resend|bounce"` → only `bulk-resend-course-emails`); the `apex-email-status` cron is ABSENT from `cron.job`. `agent_onboarding_queue` has 15 of 250 "sent" rows with no `resend_message_id`. The outbox/receipt model (`messaging_delivery_receipts.idempotency_key, delivered_at, template_version`) exists but email bypasses it.

**D8 · P2 · Sender identity drift.** 10 distinct `from:` literals across functions (`APEX Financial <notifications@…>` ×64, `Apex Financial <…>` ×16, `APEX Financial Empire`, `noreply@`, `alerts@`, `sam@`, `applications@`, …). `notify-course-complete` and `send-course-enrollment-email` send from `notifications@apex-financial.org` with **no reply_to**; `send-agent-onboarding-email` replies to `info@kingofsales.net` while the body says "reply here… — Sam, APEX Financial". `system_settings.onboarding_email_from_address` exists (34 chars) and is read only by the queue worker.

**D9 · P2 · Intake email validation is uneven.** Strong (zod `.email()` or regex): `Apply.tsx:55`, `Login.tsx:19`, `AddAgentModal.tsx:271-272`, `contractingIntake.ts:87` (shared with `fn_normalize_contracting_email`), `JoinLink`, `HireLink`, `AgentSignup`, `Signup`, `ClaimAccount`, `ReferralSubmit`, `SeminarPage`; server `submit-application/index.ts:249,295` `z.string().email().max(254)`. **Only HTML `type="email"`** (no normalization, no server zod): `Join.tsx:106`, `InviteTeamModal.tsx:146-147` (checks non-empty only, then writes `contracting_links` directly from the client), `AdminManagerInvites.tsx:81` (inserts `manager_signup_tokens` directly), `admin/AddReferral.tsx`, `MagicLogin.tsx`, `AgentQuickEditDialog.tsx`, `AgentProfileEditor.tsx`, `QuickQualifyStep.tsx:64` (its zod lives in Apply.tsx — fine). Edge fns `add-agent`, `submit-contracting-intake`: 0 email-validation lines (they rely on the DB CHECK). No shared normalizer (lower-case/trim/plus-tag policy) is used outside contracting.

**D10 · P2 · Agent-facing Discord copy (remove-from-journey).** UI: `GetLicensed.tsx:581` "Book your onboarding call — Discord + contracting arrive the same day", `:625` "Get contracted + Discord invite"; `ApplicantHome.tsx:89-91` "Join Discord" secondary CTA; `ApplicationConfirmationV2.tsx:273` "Slack and Discord access is issued after you are hired"; `GettingStarted.tsx:48` checklist "Joined team Slack + Discord"; `JoinYourTeam.tsx:36` reads `discord_invite_url`; `RequireProfilePicture.tsx:132` "Your face shows up next to every deal you close on Discord"; `apexCareerToolkit.ts:65` "private support Discord"; `apexConfig.ts:122` `discord: "https://discord.gg/…"`; `Settings.tsx:24` `discord_enabled` pref. Email templates: `send-agent-onboarding-email:241-287` (community email), `notify-course-complete:216-231` ("💬 Join Our Discord", "10:00 AM CST on Discord"), `send-agent-portal-login:309-315`, `send-bulk-portal-logins:326-335`, `send-licensing-instructions:11,152-155` (step card "Join the APEX Discord"), `welcome-new-agent:32,121-122`, `notify-agent-live-field:26,138-143`, `cron-newhire-portal-login:95-97`, `telegram-webhook:432,662` (applicant bot: "Move to Discord — production lives there", `discord.gg/apex`). Keep-as-operator-telemetry: `_shared/apex.ts`, `_shared/contracting-delivery.ts`, `apex-alert-dispatch`, `discord-webhook-notify`, `apex-outbox-dispatcher`, `discord-leaderboards`, `generate-monthly-awards`, `notify-deal-submitted`, `post-deal` (deal/hire/alert posts to Sam/ops channels — these were kept by prior waves and route to `discord_webhook_url_private` per memory), plus admin UI `IntegrationsSettings.tsx`, `ProfileSettings.tsx:36-69` (Discord Webhook section), `TeamEngagementPanel.tsx`, `AgentOnboardingEmailStatus.tsx`, `OnboardingRollCall.tsx` (whose header already states `has_discord_access` "is written by nothing" — live: 4 of 228 agents true). `src/tests/lib/onboardingEmailPolicy.test.ts:27,38` **asserts the Discord link is present** in `send-licensing-instructions` and `welcome-new-agent` — those tests must be inverted in the same change.

**D11 · P2 · Three cron jobs drain one queue and the course email can be sent before the training exists.** `apex-agent-onboarding-emails-hourly/-cdt/-cst` all POST the same function; the worker only claims by `sent_at is null and attempt_count < 5` with no claim lock visible in the grep, so overlapping ticks can double-send (unmeasured; 0 duplicates would be guaranteed only by a claim column).

**D12 · P2 · `RequiredOnboardingResources` hard-codes a Google Doc as "Official APEX script" and a phone number**; the "three essentials" copy lists two items; the Google Doc is outside RLS, unversioned, and not the `sales_scripts` content the Call Lab trains on.

**D13 · P2 · Dead training mirrors.** `ResourcesLicensing.tsx` static mirror (file header admits it froze); duplicate `/dashboard/recruiting/training/*` tree; `TrainingIndex.tsx` public page; `src/types/course.ts` comment lists `CourseContent.tsx`/`OnboardingCourse.tsx` as consumers of names that do not match the tables.

---

## 5. Measurements (live, 2026-10-05)

| Metric | Value | Method |
|---|---|---|
| Hired agents (status active, not deactivated/inactive, not GHOST%, canonical) | **63 rows / 63 distinct user_id** | SQL on `agents` |
| Hired AND licensed | **41** | same + `license_status='licensed'` |
| Active modules / total module rows | **6 / 19**; phases `foundation, systems`; thresholds 90/90/80/80/80/80 | `onboarding_modules` |
| Agents with ALL 6 active modules passed (any status) | **7** | `onboarding_progress` grouped, `having count(distinct module_id) = 6` |
| Hired AND all active modules passed | **6** | join to hired set |
| Hired agents with ZERO `onboarding_progress` rows | **34** | anti-join |
| Agents with any progress / progress rows | 105 / 304 | |
| `agents.onboarding_completed_at` set | 37 (vs 7 fully passed) | |
| `has_training_course = true` | 187 agents | |
| Scripts packet "already sent" marker | **0 — no marker exists.** The `course` kind (77 sent lifetime, 13 in 30d) links to the training library, not to scripts; `sales_scripts` has never been emailed by any function (grep `sales_scripts` in supabase/functions = 0 hits) | |
| `agent_onboarding_queue` by kind (sent / pending / failed / total) | course 77/1/18/96 · get_licensed 11/0/0/11 · discord 89/0/19/108 · hired_whatsapp 42/0/4/46 · onboarding_call 31/0/0/31 | |
| Onboarding email failures, rows created last 30d | **0 failed, 0 pending, 60 sent** (failures are all older: newest failed `course` row 2026-08-31; reasons are policy skips: `skipped_wrong_cohort`, `terminal_inactive_agent`, MP-352 rollback) | |
| Course sent in 30d vs hired+licensed created in 30d | 13 / 12 | |
| Sent rows missing `resend_message_id` | 15 of 250 | |
| `notification_log` 30d | sms-auto/skipped 1,115 · sms-auto/sent 438 · email/sent 112 · push/failed 30; `notification_type` NULL on all 1,695; 0 email failures; onboarding course emails absent | |
| `messaging_delivery_receipts` 30d | delivered 504 (Slack/outbox), no email | |
| `v_hired_licensed_missing_course` | 0 rows | |
| `hub_course_progress` | 55 rows / 11 users / 3 courses | |
| `sales_scripts` readable by anon | **11 of 11** | `set local role anon` |
| Resend hygiene across 108 sender fns | Idempotency-Key 14 · List-Unsubscribe 5 · reply_to 9 · text part 23 · unsubscribe text 12 · bounce/delivery webhook **0** · `apex-email-status` cron **ABSENT** | grep + `cron.job` |
| Discord refs | 45 src files (excl. tests/types/shipped-data), 39 edge-fn files | grep -ci |
| Delivered-to-inbox rate for any onboarding email | **unmeasured — no delivery events exist** | |
| Duplicate course sends per agent | 0 by construction (UNIQUE agent_id,email_kind) — but resend creates no new row, so an authorized resend is **unrepresentable** today | |

---

## 6. KEEP / REPAIR / MERGE / REMOVE

| Surface | File | Verdict | Target / reason |
|---|---|---|---|
| `/dashboard/scripts` route + page | `src/pages/Scripts.tsx`, `App.tsx:711` | **REMOVE** | Brief §3. Redirect to `/dashboard/training/library#resources` (secure packet section). Delete the gradient hero. |
| Sidebar "Scripts" | `agentCloudNavigation.ts:173` | **REMOVE** | check-sidebar-routes passes once both href and route go. |
| String refs to `/dashboard/scripts` | `AgentHandbook.tsx:62,77`, `HelpCenter.tsx:46,48,76`, `GettingStarted.tsx:59` | **REPAIR** | Point at the packet section; GettingStarted:59 is guard-visible (dead-internal-links). |
| Scripts in Call Lab | `CallLabLive.tsx:133-135` | **KEEP** | In-workflow use of `sales_scripts`. |
| `sales_scripts` table + RLS | DB | **REPAIR** | Add `version int`, `approved_at`, `approved_by`; replace `{public}` policy with `authenticated` + eligibility (see §7). |
| Approved packet | `sales_scripts` + Google Doc in `RequiredOnboardingResources.tsx:19` + hub "scripts" seed | **MERGE** | One packet definition (`onboarding_packet_versions`) listing script ids + external links; the Google Doc becomes a packet item, not a hard-code. |
| `RequiredOnboardingResources.tsx` | component | **REPAIR** | Render from packet rows; fix "three essentials"; gate the script card on eligibility; keep the help card. |
| Training center | `TrainingHub.tsx` | **KEEP/REPAIR** | Keep as the home; add "Resources unlocked" section bound to packet state; standard PageHeader; drop skeleton flash. |
| Hub data layer | `apexResourcesHub.ts` | **KEEP** | Content stays on apex-resources; fail-closed embed stays. |
| Field course | `CourseCatalog.tsx`, `OnboardingCourse.tsx`, `useOnboardingCourse.ts` | **REPAIR** | Remove client `notify-course-complete` invoke (:336-347); completion comes from the DB trigger. |
| `notify-course-complete` | edge fn | **REPAIR** | Require JWT + re-derive completion from `onboarding_progress` + idempotency key; or retire in favour of the trigger-driven queue row. |
| Admin progress | `CourseProgress.tsx`, `my_course_progress()` | **REPAIR** | Required-only denominator; show packet state column (eligible/queued/accepted/delivered/failed); add "Authorized resend". |
| Course content admin | `CourseContent.tsx` | **REPAIR** | Expose `is_required` toggle per module. |
| `AgentHandbook.tsx` | page | **KEEP** | Static reference; fix two script links. |
| `/dashboard/recruiting/training/*` duplicate tree | `App.tsx:499-505` | **MERGE** | Redirect to `/dashboard/training/*` (sidebar/orphan guards: keep `toCanonicalTrainingHref`). |
| `ResourcesLicensing.tsx` (public) | page | **REMOVE or MERGE** | Frozen static mirror; redirect `/resources/licensing` → public hub landing or `/training`. Check orphan-pages guard (file must stop being imported). |
| `TrainingIndex.tsx` (public `/training`) | page | **KEEP** (public entry) | Out of authed scope; leave. |
| `agent_onboarding_queue` + `send-agent-onboarding-email` | DB + fn | **REPAIR** | Add kind `scripts_packet`; add `packet_version`, `claimed_at`, `delivery_status`, `delivered_at`, `bounced_at`, `send_key`; retire `discord` kind (no new rows; existing rows terminal); single cron; Idempotency-Key + List-Unsubscribe + consistent From/Reply-To. |
| `fn_enqueue_hired_licensed_onboarding` / `fn_enqueue_agent_onboarding_emails` / `fn_onboarding_email_backfill_sweep` | DB | **REPAIR** | Stop inserting `discord`; call the shared eligibility evaluator. |
| `AgentOnboardingEmailStatus.tsx`, `AdminEmailGaps.tsx`, `TeamEngagementPanel.tsx`, `v_hired_licensed_missing_course` | admin UI/view | **REPAIR** | Drop discord columns; add packet state; never label accepted as delivered. |
| `check-email-status` + `apex-email-status` cron | fn + absent job | **REPAIR** | Replace with a Resend event webhook (`email.delivered/bounced/complained`) writing `delivery_status`; keep the fn for on-demand. |
| Agent-facing Discord copy (D10 list) | 9 UI files + 8 email templates + telegram bot strings | **REMOVE** from journey | Keep operator telemetry fns. Invert `onboardingEmailPolicy.test.ts:27,38`. |
| Intake forms lacking strong validation (D9) | `Join.tsx`, `InviteTeamModal.tsx`, `AdminManagerInvites.tsx`, `AddReferral.tsx`, `MagicLogin.tsx`, `AgentQuickEditDialog.tsx`, `AgentProfileEditor.tsx`; fns `add-agent`, `submit-contracting-intake` | **REPAIR** | One shared `normalizeEmail`/`emailSchema` (lift from `contractingIntake.ts:29,87`) + server-side zod in the fns. |

---

## 7. Recommended implementation plan (this domain)

### 7.1 Data model (additive migration, mirrored to `supabase/migrations/`)
1. `alter table onboarding_modules add column is_required boolean not null default true;` then set `is_required=false` for nothing yet (Sam decides). Default true preserves today's behaviour; optional modules stop blocking.
2. `create table onboarding_packet_versions (version int primary key, label text, script_ids uuid[], external_links jsonb, approved_by uuid, approved_at timestamptz, is_current boolean)`; seed version 1 = the 11 active `sales_scripts` ids + the Google Doc + the hub playbook. `sales_scripts` gets `version int default 1`.
3. `agent_onboarding_queue`: add `'scripts_packet'` to the CHECK (read the constraint first — it is the one quoted in §1.4), add `packet_version int`, `send_key text unique`, `claimed_at timestamptz`, `delivery_status text check in ('queued','accepted','delivered','bounced','complained','failed','skipped')`, `delivered_at`, `resend_of uuid references agent_onboarding_queue(id)`. Keep the existing UNIQUE `(agent_id, email_kind)` by making the kind value `scripts_packet:v<N>` **or** (cleaner) relax it to a partial unique index `(agent_id, email_kind, packet_version) where resend_of is null`. Historic rows untouched.
4. `create or replace view v_training_required_completion as select a.id agent_id, count(m.id) filter (where m.is_required) required_total, count(op.id) filter (where m.is_required and op.passed) required_passed, bool_and(coalesce(op.passed,false)) filter (where m.is_required) required_complete …` over active modules — security_invoker, measured as a non-admin before shipping (memory rule).
5. `create or replace function fn_evaluate_scripts_packet_eligibility(p_agent_id uuid) returns void` — SECURITY DEFINER, EXCEPTION-wrapped: if hired-gate (status active, not deactivated/inactive, canonical) ∧ `license_status='licensed'` ∧ required_complete ∧ profile/auth email present ∧ not `email_unsubscribes` → `insert into agent_onboarding_queue (agent_id, email_kind, packet_version, send_key, target_send_at) values (p, 'scripts_packet', current_version, 'pkt:'||p||':v'||current_version, now()) on conflict do nothing`. **Send key = `agent_id + packet_version`**; refreshes, re-opened courses, duplicate webhooks all collide on it. A new packet version → a new key (policy: bump version only on approved content change; a bump does **not** auto-resend to past recipients — that is the separate reviewed backfill the brief demands).
6. Triggers calling the evaluator from both directions: `AFTER INSERT OR UPDATE OF passed ON onboarding_progress` (per `NEW.agent_id`) and inside `fn_enqueue_hired_licensed_onboarding` after the employment gate (per `NEW.id`). Ordering-independent by construction: whichever commits last finds both conditions true.
7. Deactivate `discord` kind: remove it from the three enqueue functions; leave the CHECK value so history stays valid; mark the 19 failed `discord` rows terminal (`attempt_count=5, last_error='retired_channel'`) the same way `hired_whatsapp` was retired at `send-agent-onboarding-email/index.ts:430-433`.
8. **Deployment guard**: migration must NOT backfill `scripts_packet` rows for the 6 already-eligible agents; `fn_evaluate…` is only called by triggers going forward. Backfill = separate admin action with review.

### 7.2 Edge functions
- `send-agent-onboarding-email`: new `buildScriptsPacketEmail(name, packet)` — plain-text part, deep link to `/dashboard/training/library#resources` (signed-in), no script bodies in the email (packet is served in-app under RLS); `Idempotency-Key: send_key` header; `List-Unsubscribe` + `List-Unsubscribe-Post`; `from` read from `system_settings.onboarding_email_from_address`; `reply_to` one agency inbox; claim rows with `update … set claimed_at=now() where claimed_at is null returning *` before sending; collapse the three cron jobs into one (`7 * * * *`).
- New `resend-events-webhook` (verify Resend signature) writing `delivery_status/delivered_at` on `agent_onboarding_queue` by `resend_message_id`, and into `email_tracking` for the other senders. Until it exists the UI word is "accepted", never "delivered".
- `notify-course-complete`: require JWT (`require-send-auth` floor any_authenticated), re-derive completion from `v_training_required_completion`, idempotency key `course_complete:<agent_id>`; remove the Discord block; or delete the client call and let the trigger own it (preferred — then the fn becomes admin-only "notify" with no state write).
- Remove the client invoke at `useOnboardingCourse.ts:336-347`.

### 7.3 Frontend
- Delete `Scripts.tsx` route/nav; add `<Route path="/dashboard/scripts" element={<LegacyWorkspaceRedirect to="/dashboard/training/library#resources" />}` (no loop: target is a real route). Fix the six string refs.
- `TrainingHub.tsx`: "Resources" section reads `sales_scripts` (now RLS-gated: `authenticated` AND (`apex_is_admin()` OR exists eligible/accepted `scripts_packet` row for `current_agent_id()`) — plus Call Lab keeps read via the same policy, so field agents who are eligible see the words they train on) + packet external links; state chip from the queue row (Eligible / Queued / Accepted / Delivered / Failed) with an admin-only "Authorized resend" that inserts a new row with `resend_of` and a fresh key `…:r<n>`.
- `CourseContent.tsx`: `is_required` toggle. `CourseProgress.tsx`: required-only denominator, packet-state column.
- Shared `src/lib/email.ts` exporting `normalizeEmail` + `emailSchema` (move from `contractingIntake.ts`); apply to the D9 forms; add server zod in `add-agent`, `submit-contracting-intake`.
- Remove D10 agent-facing Discord copy; `apexConfig.ts:122` keep the constant only if an operator surface still reads it.

### 7.4 Tests to write
- `src/tests/lib/scriptsPacketTrigger.test.ts`: migration-text assertions that both triggers call the evaluator and that the evaluator's INSERT carries `on conflict … do nothing` + `send_key` (same style as `onboardingEmailPolicy.test.ts`).
- DB proof (DO-block, rolled back, synthetic agent): order A (hire then last module) and order B (modules then hire) each produce exactly one `scripts_packet` row; re-firing the progress update produces 0 new rows; unlicensed or deactivated agent produces 0; optional module left unpassed still produces 1.
- Vitest for `normalizeEmail` (plus-tags, case, whitespace, 254 limit) and for every D9 form schema.
- Edge test: `send-agent-onboarding-email` sets `Idempotency-Key === send_key`, includes `text`, never includes a script body.
- Invert `onboardingEmailPolicy.test.ts:27,38` to `not.toContain("discord.gg")`.

### 7.5 Guards affected
`check:sidebar-routes` (nav entry removed with route), `check:orphan-pages` (Scripts.tsx must be deleted, not left unimported; same for ResourcesLicensing if retired), `check:dead-internal-links` (GettingStarted:59 href), `check:stale-key-in-list` (new list renders), `check:maybesingle-nonunique` (any new `.maybeSingle()` on `agent_onboarding_queue` must filter on the unique key), `check:metric-truth` (if the Training center shows counts), `check:tsc-error-count` baseline, `check:empty-catch` (no bare catch in new fn code), `check:brand-literals`/`check:theme-literals` (deleting Scripts.tsx removes the hard-coded amber/slate hero — a reduction), apex-doctor Check #7/#18 style: add a doctor check grading **movement** on `scripts_packet` (eligible-but-unqueued > 0 for > 24h → WARN) rather than a frozen count.

---

## 8. Risks and open questions

Risks
- Changing `sales_scripts` RLS from `{public}` to eligibility-gated will hide scripts from hired agents who never did the course (34 hired agents have zero progress rows) — Call Lab and the handbook links go empty for them unless admins or the hire-gate grant read. Decide: packet read requires eligibility (strict §9) or hire alone (lenient). Recommendation: read on hire+licensed, **email** on hire+licensed+required-complete.
- `UNIQUE (agent_id, email_kind)` is load-bearing for every existing kind; relaxing it must be a partial index, never a drop.
- Three cron jobs drain the same queue today; removing two is a pg_cron change outside the repo — must be mirrored in a migration or it silently reappears on the next `db push`.
- Marking optional modules changes `my_course_progress()` percentages shown to managers; announce.
- `onboardingEmailPolicy.test.ts` currently **requires** the Discord link; the Discord removal and the test inversion must land in one commit or CI goes red.
- `notify-course-complete` is unauthenticated today; adding auth could break a non-browser caller — grep found only `useOnboardingCourse.ts:344`.

Open questions for Sam
1. Which modules are optional? (All 6 active default to required.)
2. Is the Google Doc the canonical "official script", or is the 13,596-char `sales_scripts` row by Sam James (updated 2026-08-31) the approved one? They should not both be "official".
3. Should the packet be emailed as links only (recommended; content stays under RLS) or as an attachment/PDF?
4. Reply-To inbox for onboarding mail: `info@kingofsales.net` (current) or an `@apex-financial.org` address?
5. Historical backfill: the 6 hired+complete agents today — send once after review, or never?
6. Does any ops surface still need `agents.has_discord_access` (4 of 228 true, written by nothing)?
