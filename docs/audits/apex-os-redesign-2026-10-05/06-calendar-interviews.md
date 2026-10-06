# 06 — Calendar & Interview Scheduling (domain map, read-only)

Program: APEX OS redesign 2026-10-05 · Repo HEAD `4ea291c8` · DB project `xrzweoneiieddzxogewk`
Measured 2026-10-06 ~05:40 UTC (2026-10-05 ~22:40 Phoenix). Every number below was read from the live database (Supabase MCP `execute_sql`), the live Calendly account (MCP), launchd/log files on this Mac, or the code at the cited `file:line`. Anything I could not read is marked **unmeasured**. Row counts and distinct-people counts are kept separate.

---

## 0. Headline

There is no single appointment record. Five tables hold "when do we talk to this person" and nothing reconciles them:

| Store | Rows | Future rows | Last write | Who writes | Who reads |
|---|---|---|---|---|---|
| `interview_events` | 271 (95 distinct application_ids, 76 distinct invitee emails) | 0 at measurement | 2026-10-05 10:03Z | `calendly-webhook` (166 rows), `calendly-backfill` (105), `cc_dispose_interview` | CalendarPage (via `calendar_window`), CallsTodayCockpit, Dashboard, InterviewRecovery, Interviews (onboarding tab), onboarding-call-invites, calendly-alerter |
| `hh_applicants.appointment_at` | 376 rows carry a time (163 distinct emails; stage `appointment_set` 316) | 0 | 2026-10-05 11:00Z | `interviews-pipeline` (reschedule), `assistant-add-interview` upsert | Interviews.tsx (main list) |
| `scheduled_interviews` | 2 | 0 | 2026-05-15 | **`InterviewScheduler.tsx` — the modal wired into AgentPipeline, CallCenter, RecruiterDashboard and CalendarPage** | `fn_sweep_interview_reminders` (cron every 5 min) only |
| `calendar_events` | 320 (314 `schedule-auto-populate`, 6 `siri`, **0 `apex`**) | 39 (all `draft_date`) | 2026-10-05 12:11Z (cron) | `schedule-auto-populate`, CalendarPage appointment form (`source:'apex'`, no surviving row) | `calendar_window` |
| `apex_scheduled_calls` | 2 | 0 | 2026-06-10 | `gcal-sync` (no cron exists) | `v_upcoming_calls` → DashboardToday |
| `manual_interview_entries` | 83 | 0 | 2026-06-18 | `assistant-add-interview` | nothing in the app renders it |

Consequences, all measured:
- An interview booked from Pipeline/Calendar/Call Center lands in `scheduled_interviews` and **never appears on the Calendar** (`calendar_window` unions `interview_events` + `calendar_events` only; migration `20260826071000_calendar_onboarding_call_kind.sql:32,60`).
- 104 `hh_applicants` rows with an appointment share an email with an `interview_events` row: the same meeting exists twice, and a reschedule in Interviews.tsx moves only the `hh_applicants` copy (`interviews-pipeline/index.ts:127-139`).
- Reminders: `interview_events.reminder_sent_at` is NULL on **271/271** rows. The only interview-reminder job (`apex_notif_interview_sweep_5min`, 2,016 successful runs in 7 days) sweeps the dead `scheduled_interviews` table; it has emitted 2 notifications in its life (both `interview_missed`, 2026-06-14).
- The Calendar's "Calendar sync: Live" tile is true whenever *any* `calendar_events` row was created in the last 7 days (`CalendarPage.tsx:415-428, 749`). The daily draft-date cron guarantees that, so the tile reads "Live" while Google Calendar sync has been dead since 2026-06-10 and says nothing about Calendly.
- The one integration that works — Calendly → `calendly-webhook` → `interview_events` (18 webhook rows in the last 30 days, 0 backfill rows needed, reconcile cron green) — feeds a launchd daemon that paged Sam's phone **245 times about one booking and 152 times about another** in ~28 hours because its watermark cannot parse Postgres timestamps with 5 fractional digits.

---

## 1. What exists

### 1.1 Routes (src/App.tsx)
| Route | Line | Component | Guard | Nav entry |
|---|---|---|---|---|
| `/dashboard/calendar` | 692 | `CalendarPage.tsx` (1,155 lines) | none on the Route element (relies on the authenticated shell; **unmeasured** whether an anonymous hit renders) | Sell › Calendar, `agentCloudNavigation.ts:135`, modes `PRODUCERS` |
| `/dashboard/planner` | 694 | `AdminCalendar.tsx` (820) | `requireAdmin` | none (no sidebar/palette link found) |
| `/dashboard/headhunters-calendar` | 695 | `<Navigate to="/dashboard/command">` | — | — |
| `/dashboard/recruiting/interviews` | 496 | `Interviews.tsx` (855) | admin/managers/va_manager/va/recruiter | Grow › Interviews `agentCloudNavigation.ts:149`; `MobileBottomNav.tsx:40,48` |
| `/dashboard/recruiting/follow-ups` | 497 | `InterviewRecovery.tsx` (1,622) | same | Grow › Follow-ups `agentCloudNavigation.ts:151` (recruiter/va/va_manager/manager/agency_owner); `MobileBottomNav.tsx:41` |
| `/dashboard/interviews`, `/dashboard/interview-recovery` | 698-699 | `LegacyWorkspaceRedirect` | — | — |
| `/dashboard/today` | 564 | `DashboardToday.tsx` (233) | ProtectedRoute | `operatorConsole.ts:37`, `AgentCommandDashboard.tsx:3257` |
| `/today` | 735 | `<Navigate to="/dashboard/command">` | — | — |
| `/dashboard/calls-today` | 675 | `CallsTodayCockpit.tsx` (398) | ProtectedRoute | `ManagerCommandView.tsx:237` |
| `/schedule-call` (public) | 455 | `ScheduleCall.tsx` (236) — Calendly embed | public | — |
| `/assistant/interviews` (public, token) | 459 | `AssistantInterviewForm.tsx` (517) → `assistant-add-interview` | share token | Interviews.tsx reads `assistant_share_tokens` (line 236) |

### 1.2 Shared components
- `src/components/dashboard/InterviewScheduler.tsx` (391) — modal. Used by `AgentPipeline.tsx:840`, `CallCenter.tsx:1403` (MP-260 "Reschedule" opens it, `:494-501`), `RecruiterDashboard.tsx:877`, `CalendarPage.tsx:1095`. On submit (`:116-158`): inserts `scheduled_interviews`, sets `applications.status='interview'`, invokes `schedule-interview` (Resend email to applicant), builds a Google Calendar *template URL*. Time is built with `new Date(selectedDate).setHours(...)` (`:89-94`) = **browser-local zone**, not Phoenix, not the applicant's.
- `src/components/dashboard/CalendarSyncSection.tsx` (101) — titled "Apple Calendar Sync", rendered in `Settings.tsx:129,139`. Generates `ics_feed_tokens` via `get_or_create_ics_token` (SECURITY DEFINER) and points at `ics-feed`, which serves **`agent_tasks`** due in the next 60 days (`ics-feed/index.ts:77-80`), not calendar events. Live: 3 tokens, last polled 2026-10-06 05:34Z, `agent_tasks` with a future due date: **0**. A device is subscribed to an empty feed.
- `src/components/ui/calendar.tsx` — shadcn day picker, unrelated.

### 1.3 Edge functions (all `ACTIVE` in the live listing of 242 functions)
| Function | Version | Role in this domain |
|---|---|---|
| `calendly-webhook` | v220 | invitee.created → upsert `interview_events` on `calendly_event_uri` (`:289-315`); invitee.canceled → `canceled_at` + reason (`:257-283`); seminar/exam side-writes to `applications` (`:271-281, 325-358`). Stores `raw_payload: payload` (`:310`) — see D-09. |
| `calendly-backfill` | v210 | Calendly API list → upsert `interview_events`; logs `calendly_reconciliation_runs`. Two crons call it (see 1.5). Last 5 runs `ok`, 0 seen/0 upserted. |
| `interviews-pipeline` | v167 (verify_jwt) | Reads/writes `hh_applicants` (stage machine `:113-144`), `hh_activity` receipt (`:202`); `list:"onboarding_calls"` reads `v_onboarding_calls`/`v_onboarding_call_truth`/`v_onboarding_call_gaps` (`:470-474`). |
| `interviews-outcome` | v154 | Retired, returns 410 (`index.ts:1-18`). |
| `schedule-interview` | v237 | Emails the applicant via Resend. Formats time with `toLocaleTimeString("en-US",{timeZoneName:"short"})` and **no `timeZone`** (`:50-62`) → runtime default zone (UTC on Deno Deploy). |
| `send-calendly-invite` | v221 | Outreach email; `CALENDLY_URL = ".../licensed-prospect-call-clone"` (`:35`), which is the **"Leader Call "** event type (see 1.6). |
| `onboarding-call-invites` | v127 | Drains `onboarding_call_invites` for `interview_events.call_track='onboarding'`; sends METHOD:REQUEST / METHOD:CANCEL .ics (`:174-186`); only a Resend message id marks `sent`. Live: 4 sent, 0 queued/failed. |
| `assistant-add-interview` | v213 | Writes `manual_interview_entries` (`:223`) and upserts `hh_applicants` with `appointment_at`, `stage:'appointment_set'` (`:268-275`). |
| `schedule-auto-populate` | v219 | Writes `calendar_events` kinds `draft_date` / `post_test_follow_up` (metadata.kind) from the book + applications; emails managers when invoked with `email_managers:true` (CalendarPage button `:611-613`). |
| `gcal-sync` | v209 | Google Calendar → `apex_scheduled_calls`. **No cron** (`grep cron.schedule … gcal` = 0; migration `20260826052000_onboarding_calls_live.sql:10` says so). |
| `ics-feed` | v236 | agent_tasks → .ics. |
| `seminar-reminder-tick` | v225 | T-24h/T-1h seminar emails via `idempotency_keys`. **No cron** (0 jobs match `seminar`). 5 future seminar registrations, 0 with `reminder_opt_in`. |
| `numbers-reminder` | v227 | Daily production-logging reminder (crons 83/84). Not an appointment reminder; listed because it is the reminder pattern that *does* have a delivery log (`numbers_reminder_delivery_log`). |

### 1.4 Database objects
- Tables: `interview_events` (schema `20260724150000_mp264_interview_events.sql`; live CHECKs: `source ∈ calendly|manual|application|readymode`, `call_track ∈ licensed|leader|seminar|exam|other|onboarding`, `outcome ∈ completed|hired|contracted|passed|no_show|no_answer|rescheduled|bad_number|callback|not_interested|not_a_fit`, `match_method ∈ instagram|email|phone|manual|none|booking_backfill`; extra live columns `instagram_handle, invitee_status, prep_notes, reschedule_url, cancel_url, was_rescheduled`), `calendar_events` (`20260423000013_siri_command.sql`; `status` is free text, no CHECK), `scheduled_interviews` (`20260220204017…sql`), `apex_scheduled_calls` (bigint id, gcal ids, `start_at/end_at`, disposition timestamps), `admin_calendar_blocks` + `recurring_calendar_blocks` (`20260302061907…sql`; **0 rows each, ever**), `ics_feed_tokens`, `manual_interview_entries`, `onboarding_call_invites`, `calendly_reconciliation_runs`, `today_tasks` (8 rows, last 2026-06-17), `hh_applicants` (enum `hh_stage`: appointment_set, confirmed, rescheduled, interview_complete, hired, not_hired, unqualified, no_show, canceled; lock-step CHECKs between stage and `interview_result`).
- RPCs: `calendar_window(p_from,p_to,p_kinds)` and `calendar_window_counts` — SECURITY INVOKER (`prosecdef=false`), 7 UNIONs, every timestamp resolved `at time zone 'America/Phoenix'` (`20260826071000…sql:10-181`). `cc_dispose_interview` (SECURITY DEFINER; writes outcome + maps `applications.status`). `resolve_application_for_invitee` — **two overloads** live, `(text,text)` email→phone and `(text,text,text)` instagram→phone→email with placeholder-email guard. `get_or_create_ics_token`. `schedule_auto_populate_tick` (pg_net → edge fn). `fn_sweep_interview_reminders` (targets `scheduled_interviews`). `fn_sweep_manager_followup_reminders` (applications idle >72h, LIMIT 200/day). `fn_sweep_onboarding_call_gaps`. `admin_enqueue_onboarding_call` (Interviews.tsx:274).
- Views: `v_upcoming_calls` (`apex_scheduled_calls`, `is_agency_staff()` gate), `v_onboarding_calls` (`interview_events` where `call_track='onboarding'` + invites jsonb), `v_interview_pipeline` (`interview_events LEFT JOIN applications`, Chicago-day priority score, `is_agency_staff()` gate), `v_prospect_review_queue`, `v_onboarding_call_truth`, `v_onboarding_call_gaps`.

### 1.5 Jobs
pg_cron (all `active`, all last runs `succeeded` over 7 days):
| jobid | name | schedule (UTC) | does |
|---|---|---|---|
| 51 | `apex_notif_interview_sweep_5min` | `1-59/5 * * * *` | `fn_sweep_interview_reminders()` on `scheduled_interviews` (2 rows) |
| 52 | `apex_notif_manager_followup_daily` | `0 14 * * *` | `fn_sweep_manager_followup_reminders()` |
| 87 | `apex-calendly-reconcile-15min` | `3-59/15 * * * *` | `calendly-backfill?since=…` |
| 91 | `mp264-calendly-reconcile` | `17 */6 * * *` | `calendly-backfill` (same function, second schedule) |
| 86 | `apex-onboarding-call-invites-5min` | `3-59/5` | `onboarding-call-invites` |
| 90 | `apex-onboarding-call-gap-sweep` | `8,23,38,53 * * * *` | `fn_sweep_onboarding_call_gaps()` |
| 34 | `apex-schedule-auto-populate` | `11 12 * * *` | `schedule_auto_populate_tick()` → draft dates |
| 83/84 | `apex-numbers-reminder-cdt/cst` | `0 23` / `0 0` | numbers reminder |
No cron for `gcal-sync` or `seminar-reminder-tick`. `apex-manager-daily-digest` (19) is inactive.

launchd (this Mac): `com.samjames.apex.calendly-alerter` → `/Users/samjames/business-ops/scripts/apex-calendly-alerter.py` (363 lines, `/usr/bin/python3` = 3.9.6), pid 1575, polls `interview_events` via bot-sql every ~60s, pushes to Sam's primary ntfy topic. Watermark file `~/.config/apex-creds/calendly-alerter.since` = `2026-10-04T21:18:01.968357+00:00`, last modified Oct 4.

### 1.6 Calendly (live account)
Host `Samuel James`, timezone **America/Chicago**. Active event types: `APEX Onboarding Call` (30 min, slug `apex-onboarding-call`), `Leader Call ` (trailing space, 15 min, slug `licensed-prospect-call-clone`, one `instagram` question), `Licensed Call` (15 min, slug `1on1-call-clone`, required `Instagram Handle` + `Status` questions), `Manager Call` (slug `licensed-prospect-call-clone-1`), `Preferred Final Expense Review ` (slug `mortgage-review`). Org has one member (per `onboarding-call-invites/index.ts:11-13`). Webhook subscription state: **unmeasured** (no MCP tool for it), but inferred live from 18 webhook-origin rows in 30 days and the alerter log.

Links the app hands out (count of source references): `licensed-prospect-call-clone` ×22 (Leader Call), `1on1-call-clone` ×11 (Licensed Call), `licensed-prospect-call-clone-1` ×3, `apex-onboarding-call` ×3, `interview` ×2 (no such active slug).

---

## 2. Authoritative records (what should be trusted today)

| Question | Authoritative today | Not authoritative |
|---|---|---|
| Did a prospect/agent book a call with Sam? | `interview_events` (Calendly webhook + reconcile; `calendly_event_uri` unique) | `hh_applicants.appointment_at` (copy), `scheduled_interviews` (dead), `apex_scheduled_calls` (dead since 06-10), `applications.test_scheduled_date/exam_scheduled_at` (side-writes, overwritten) |
| Interview outcome | `interview_events.outcome/outcome_at/outcome_by` via `cc_dispose_interview` | `hh_applicants.interview_result` (parallel vocabulary; 21 hired/20 unqualified/1 not_hired there) |
| Onboarding call + team invites | `interview_events` (`call_track='onboarding'`) + `onboarding_call_invites` receipts | — |
| Draft dates / post-test follow-ups | `calendar_events` (`metadata.kind`) | — |
| Reminders sent | `onboarding_call_invites.resend_message_id` (onboarding only) | `interview_events.reminder_sent_at` (never written), `notifications.type='interview_*'` (2 rows ever) |
| Sam's own blocks/planner | nothing (0 rows) | `admin_calendar_blocks` |
| Person time zone | **does not exist anywhere** (no column on `interview_events`, `hh_applicants`, `applications`; webhook payload not retained) | — |

---

## 3. Workflow traces

**A. Prospect books on Calendly (works).** Prospect clicks a Calendly link (e.g. `ScheduleCall.tsx` embed or `send-calendly-invite` email) → Calendly `invitee.created` → `calendly-webhook` (shared-secret query param + optional signature `:143-180`) → `classifyEvent` (`:68`) → `resolve_application_for_invitee` (`:233`) → upsert `interview_events` (`:314`) → side-writes `applications` for seminar/exam tracks (`:325-358`) → **automation**: `calendly-alerter` (phone push, Phoenix + Central), `onboarding-call-invites` (onboarding track only), `calendar_window` picks it up as kind `interview`/`onboarding_call` → **UI**: CalendarPage, CallsTodayCockpit (14-day horizon), InterviewRecovery (`v_interview_pipeline`), Dashboard week widget → **audit**: `interview_events.raw_payload` (see D-09), `calendly_reconciliation_runs`. Broken links: no reminder is ever scheduled; 140/271 rows have neither `application_id` nor `agent_id` (130 of 157 on the leader track) — those people exist nowhere else in the system; no time zone stored.

**B. Staff schedules an interview from Pipeline / Call Center / Recruiter Dashboard / Calendar (broken).** Click "Schedule interview" → `InterviewScheduler` → auth check `supabase.auth.getUser()` (`:111`) → RLS on `scheduled_interviews` (admins ALL; agents/managers insert only for assigned applications) → INSERT `scheduled_interviews` (`:116-125`) → UPDATE `applications.status='interview'` (`:131-133`) → `schedule-interview` email (UTC-formatted time) → Google template URL → **automation**: `fn_sweep_interview_reminders` T-30 inbox notification to `scheduled_by` (never cancellable) → **UI**: nothing — CalendarPage, Interviews, CallsToday all ignore `scheduled_interviews` → **audit**: none. Live evidence the path is unused or failing: 2 rows total, last 2026-05-15, despite 4 entry points (Dashboard.tsx:329 already calls it "dead").

**C. VA reschedules/cancels in Interviews.tsx (half-broken).** Action dialog → `invokeAction` (`:175-183`, `datetime-local` → `new Date(...).toISOString()` = browser zone) → `interviews-pipeline` with `expectedVersion` → scope check (VA by hh_users email `:89-94`) → `patchFor` (`:103-144`) UPDATE `hh_applicants` (+`reschedule_count`) → `hh_activity` receipt (`:202`) → **automation**: none → **UI**: Interviews list only; the Calendly booking in `interview_events` keeps its old time; the Calendar shows the old time; the "Reschedule" button on the onboarding tab just opens Calendly's `reschedule_url` (`Interviews.tsx:476`) → **audit**: `hh_activity` (0 `appointment_at` changes recorded, ever).

**D. Sam edits/deletes an appointment on the Calendar.** Pencil → `openEdit` reads `calendar_events` (`CalendarPage.tsx:487-512`) → save builds `startsAt = date+time+"-07:00"` (`:525`, Phoenix hardcoded) → UPDATE/INSERT `calendar_events` (`:534-556`) → delete = **hard DELETE** (`:573`) → **automation**: none (no reminder exists to cancel) → **audit**: none; the deleted row is gone. 0 rows with `source='apex'` survive, so either nobody has used it or every one was deleted.

**E. Mark no-show on the Calendar.** `markNoShow` (`:586-596`) UPDATE `interview_events.outcome='no_show'` directly (RLS staff_write: admin/manager/va_manager/va) — bypasses `cc_dispose_interview`, so `applications.status` is **not** moved to `attended_no_show` the way the Follow-Ups page does (`cc_dispose_interview` maps it).

**F. Daily auto-populate.** cron 34 → `schedule_auto_populate_tick` (reads `system_settings.service_role_key`) → `schedule-auto-populate` → INSERT `calendar_events` draft dates 45 days ahead → Calendar tile flips to "Live". 231 draft rows, 39 future. The manual button also emails managers (`email_managers:true`).

**G. Today / Calls Today.** `DashboardToday` reads `today_tasks` (8 rows, 2026-06-17) and `v_upcoming_calls` (2 `apex_scheduled_calls` rows from June) → both panels structurally empty. `CallsTodayCockpit` reads `interview_events` (`:66-70`) and works.

**H. Phone alert.** `calendly-alerter` `run_once` (`apex-calendly-alerter.py:310-333`): `fetch_changes(since)` selects rows with `created_at > since` (not canceled) or `canceled_at > since`, `marker = created_at::text` (`:150-172`) → `alert(row)` pushes → `parse_utc(marker)` to advance the watermark, failure swallowed by `except Exception: pass` (`:325-329`). See D-01.

---

## 4. Defects (evidence-backed)

**D-01 · P0 · `~/business-ops/scripts/apex-calendly-alerter.py:183-189, 325-329`** — Phone-push storm. Watermark advance calls `datetime.fromisoformat` on `created_at::text`; Postgres emits 5 fractional digits when the 6th is zero (`2026-10-05 10:03:02.69448+00`). The script normalizes `+00`→`+00:00` but Python 3.9 still rejects 5 digits — verified locally: `FAIL 2026-10-05 10:03:02.69448+00:00`, `OK …02.694+00:00`. The exception is swallowed, `max_marker` never moves, and every tick re-alerts every row since the watermark. Log: 412 `ALERTED` lines total, 411 since 2026-09-05 covering only **15 distinct rows**; row `2bb91fd1…` paged **245×**, row `cff45455…` **152×**; 201 pushes on 2026-10-05, 44 more by 05:40Z on 10-06, ~1/minute. Watermark file unchanged since Oct 4 21:18Z (that value was written by the "no watermark on disk" path, which uses `.isoformat()` and therefore parses). Same topic as every APEX critical (`NTFY_DEFAULT_TOPIC`). Fix: parse with a tolerant parser (pad fractional digits to 6, or ask SQL for `to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.US+00:00')`), never `pass` on a watermark error (fall back to the row's marker string or stop and log), and dedupe per `row_id` in state.

**D-02 · P0 · `src/components/dashboard/InterviewScheduler.tsx:116-125` vs `supabase/migrations/20260826071000_calendar_onboarding_call_kind.sql:32,60`** — Pipeline/Calendar "Schedule interview" writes `scheduled_interviews`; the Calendar reads `interview_events` + `calendar_events`. A staff-booked interview never appears on the Calendar, Calls Today, Follow-Ups, or Dashboard. Live: `scheduled_interviews` = 2 rows (last 2026-05-15); `Dashboard.tsx:329-330` comment: "scheduled_interviews is dead (held 2 rows vs ~185 real bookings)". Violates brief §7 "Pipeline and Calendar must update the same event".

**D-03 · P0 · `supabase/functions/interviews-pipeline/index.ts:127-139`, `src/pages/Interviews.tsx:175-183`** — Reschedule updates `hh_applicants.appointment_at` only. 104 `hh_applicants` appointment rows match an `interview_events` row by email; a reschedule leaves the Calendly booking (and the Calendar, CallsToday, alerter) on the old time, and Calendly keeps sending the invitee its own reminder for the old slot (Calendly-side reminders **unmeasured**). `hh_activity` has recorded 0 `appointment_at` changes ever, so the trail required by "audit history" does not exist for reschedules.

**D-04 · P1 · `interview_events.reminder_sent_at`** — 0/271 rows ever set; no job, trigger, or function writes it (`grep` across `supabase/functions` and migrations: the only readers are views). The only interview-reminder cron (`apex_notif_interview_sweep_5min`, 2,016 green runs/7d) reads `scheduled_interviews`; lifetime output 2 `interview_missed` notifications (2026-06-14). Brief §7 reminder lifecycle (cancel on reschedule, stop on cancel) is vacuously unmet: there are no reminders to cancel. A green cron doing nothing is the fake-success shape.

**D-05 · P1 · `src/pages/CalendarPage.tsx:415-428, 745-752`** — "Calendar sync: Live/Stale" is computed from `max(calendar_events.created_at) < 7d`. `schedule-auto-populate` (cron 34) writes daily, so the tile is permanently "Live". It says nothing about Calendly (the only live provider) or Google (`apex_scheduled_calls` last synced 2026-06-10, `gcal-sync` has no cron). Brief: "Show disconnected providers … honestly."

**D-06 · P1 · `supabase/functions/schedule-interview/index.ts:50-62`** — Applicant confirmation email formats the time with `toLocaleTimeString("en-US",{…timeZoneName:"short"})` and no `timeZone`; on Deno Deploy that is UTC, so an applicant reads "5:00 PM UTC" for a 10 AM Phoenix interview. `send-candidate-confirmation/index.ts:110-116` already does it correctly with `timeZone:"America/Chicago"`. Impact is bounded only because the path that triggers it (D-02) is barely used.

**D-07 · P1 · time zone model** — No person-level zone is stored anywhere (`interview_events`, `hh_applicants`, `applications` have no tz column; webhook payload not retained, D-09). Rendering is inconsistent per surface: `CalendarPage` hardcodes Phoenix (`PHOENIX_OFFSET="-07:00"` `:66`, used at `:525`); `InterviewScheduler` builds browser-local (`:89-94`); `Interviews.tsx` mixes browser-local `format(appointment, …)` (`:170-171`) with `formatPhoenix` (`:460`) on the same page; `v_interview_pipeline` scores on Chicago days; Calendly account is Chicago; alerter shows both. Brief: "Do not assume everyone uses my local time."

**D-08 · P1 · `src/pages/CalendarPage.tsx:573`** — Delete is a hard `DELETE` on `calendar_events`; no outcome, no status, no history. `calendar_events.status` has no CHECK and the comment vocabulary (`scheduled | reminder | cancelled | done`) is never written by the UI. Brief: "Cancellation must … record the outcome."

**D-09 · P1 · `supabase/functions/calendly-webhook/index.ts:310`** — `raw_payload: payload` is in the upsert, yet across all 271 rows the only JSON keys present are `origin, backfill` (105 backfill rows); the 166 webhook rows carry no payload (`raw_payload->>'origin'` null = 166). Why is **unmeasured** (column stripped, payload undefined, or later overwrite by backfill upsert on the same `calendly_event_uri`). Consequence: Calendly's `payload.timezone` (the invitee's zone) is lost, and the row cannot be audited against what Calendly sent.

**D-10 · P1 · identity resolution** — 140/271 `interview_events` have neither `application_id` nor `agent_id`; 130 of the 157 leader-track rows are unmatched. Only 2 of the unmatched match an agent profile email and 0 match an application email, so these are people the system has never seen (likely prospects booking the "Leader Call" link, see D-11). They appear only on Calendar/CallsToday/Follow-Ups with no person record to attach history to. Brief: "Connect appointments to the existing person record."

**D-11 · P2 · `supabase/functions/send-calendly-invite/index.ts:35` and 22 other references** — The link sent to licensed prospects is `licensed-prospect-call-clone`, which on the live Calendly account is the event type named `Leader Call ` (15 min, `instagram` question). The `Licensed Call` type is `1on1-call-clone` (11 references). Track classification downstream keys on the event name (`calendly-webhook/index.ts:68-116`), so licensed prospects booked through outreach are filed as `leader`. Whether this is intentional is an open question for Sam.

**D-12 · P2 · `src/pages/CalendarPage.tsx:292-293`** — View (`useState("month")`), kind filters and selected day are not remembered across reloads; no `localStorage`/URL state. Brief §7 "Remember the preferred view and filters." Precedent exists: `Interviews.tsx:330-345` persists `?tab=` and `interviewPipelineContract.test.ts:98` asserts it.

**D-13 · P2 · `src/pages/CalendarPage.tsx:586-596`** — `markNoShow` writes `interview_events.outcome` directly instead of `cc_dispose_interview`, so `applications.status` is not moved to `attended_no_show`, `outcome_by` is not stamped, and `last_contacted_at` is not touched — the same action from Follow-Ups does all three.

**D-14 · P2 · dead surfaces kept on routes** — `/dashboard/planner` (`admin_calendar_blocks` 0 rows, `recurring_calendar_blocks` 0 rows, no nav link); `/dashboard/today` (`today_tasks` 8 rows from June, `v_upcoming_calls` on a table last written 2026-06-10, still linked from `operatorConsole.ts:37` and `AgentCommandDashboard.tsx:3257`); `manual_interview_entries` (83 rows, last 2026-06-18, rendered nowhere). Each is a page that loads and shows nothing.

**D-15 · P2 · `fn_sweep_manager_followup_reminders` (cron 52)** — 22,245 `manager_followup_reminder` notifications to 11 users, 20,886 unread, exactly 200 in the last 24h (the `LIMIT 200` cap). Adjacent to this domain (Follow-Ups merges into Calendar/Home per brief §3) and the clearest live example of a reminder stream nobody can act on. Hand to the pipeline/notifications owner; noted here so the Calendar "due actions" merge does not inherit it.

**D-16 · P2 · RLS shape on `calendar_events`** — policy `cal_own` = `(user_id = auth.uid()) OR (user_id IS NULL)` for ALL commands to `authenticated`: any signed-in user can read/update/delete rows with null `user_id` (live: 6 such rows, 0 future). Low exposure today; becomes material if the one-event model stores shared appointments with a null owner.

**D-17 · P2 · CalendarSyncSection naming** — "Apple Calendar Sync" subscribes devices to an .ics of `agent_tasks` (0 future), not to appointments; 3 tokens exist and one device polled it at 05:34Z today. Honest label or real feed, not both missing.

---

## 5. Measurements (method: Supabase MCP `execute_sql` unless stated)

| Metric | Value |
|---|---|
| `interview_events` rows / distinct application_id / distinct lower(invitee_email) | 271 / 95 / 76 |
| … created last 30d (webhook-origin / backfill-origin) | 18 / 0 |
| … future (`scheduled_at > now()`) at 05:40Z | 0 |
| … canceled / was_rescheduled / outcome set | 19 / 5 / 6 |
| … past, open, no outcome | 246 (90.8%) |
| … `reminder_sent_at` not null | 0 |
| … no application_id and no agent_id | 140 (leader track 130/157) |
| … by track: leader / licensed / onboarding / other | 157 / 108 / 4 / 2 |
| … rows with any `timezone` key in raw_payload | 0 |
| `calendar_events` rows by source/kind | auto-populate draft_date 231 (39 future), post_test_follow_up 83, siri 6, **apex 0** |
| `calendar_events.user_id IS NULL` | 6 (0 future) |
| `scheduled_interviews` rows / last created | 2 / 2026-05-15 |
| `apex_scheduled_calls` rows / last created | 2 / 2026-06-10 |
| `hh_applicants` with appointment_at / distinct emails / future | 376 / 163 / 0 |
| `hh_applicants` stage counts | appointment_set 316, hired 21, unqualified 20, canceled 15, rescheduled 2, interview_complete 1, not_hired 1 |
| `hh_applicants` appointment rows matching an `interview_events` email | 104 |
| `hh_activity` rows for field `appointment_at` (all / 30d) | 0 / 0 |
| `manual_interview_entries` rows / last | 83 / 2026-06-18 |
| `admin_calendar_blocks` / `recurring_calendar_blocks` | 0 / 0 |
| `today_tasks` rows / last | 8 / 2026-06-17 |
| `ics_feed_tokens` / last polled / `agent_tasks` future | 3 / 2026-10-06 05:34Z / 0 |
| `onboarding_call_invites` | 4 sent (kind request), 0 queued |
| `calendar_window_counts(today, today+30)` | birthday 101, draft_date 39, every other kind 0 |
| `applications.next_action_at > now()` / `agentlink_clients.callback_date > today` | 0 / 0 |
| `notifications` interview_* lifetime | `interview_missed` 2 (2026-06-14); `interview_upcoming_t30` 0 |
| `notifications.manager_followup_reminder` total / users / unread / last 24h | 22,245 / 11 / 20,886 / 200 |
| cron job 51 runs 7d (succeeded) | 2,016 |
| cron 87 / 91 runs 7d | 672 / 28, all succeeded; last 5 reconcile runs `ok` 0 seen |
| `apex_edge_secrets.CALENDLY_API_TOKEN` | present, length 0 (edge env must hold the real one — reconcile runs report ok) |
| `is_agency_staff()` under the MCP role | false → `v_interview_pipeline` / `v_prospect_review_queue` row counts as staff **unmeasured**; unfiltered open rows 246 |
| `calendar_window` / `calendar_window_counts` SECURITY DEFINER | false (INVOKER) — agents without an `interview_events` policy see no interview rows; admins/staff see all (per-role rendering **unmeasured**) |
| Alerter log (`session-state/logs/apex-calendly-alerter.stderr.log`, 5.38 MB) | ALERTED 412 total, 411 since 2026-09-05 across 15 distinct rows; max per row 245; PUSH_FAILED 1; 836 DNS failures + 55 unreachable + 40 resets on 2026-10-05 (laptop network, recovered) |
| Calendly account | tz America/Chicago; 5 active event types (names/slugs in §1.6) |
| Edge functions in domain | 16 listed, all ACTIVE (versions in §1.3) |

---

## 6. KEEP / REPAIR / MERGE / REMOVE

| Surface | File | Verdict | Reason / target |
|---|---|---|---|
| `/dashboard/calendar` month/week/day grid | `src/pages/CalendarPage.tsx` | **REPAIR** | Keep `calendar_window` architecture (it already fixed the 1000-row and date-bucket bugs). Add agenda view, remembered view/filters, explicit tz labels + viewer-zone toggle, soft-cancel, interview drawer; fix sync tile (D-05), markNoShow via RPC (D-13), hardcoded offset (D-07). |
| Calendar "Schedule interview" + lead search/quick-add | `CalendarPage.tsx:1058-1110`, `InterviewScheduler.tsx` | **REPAIR** | Point the modal at the one-event writer (`interview_events`, source `manual`) instead of `scheduled_interviews`; include meeting link, owner, tz. |
| Calendar appointment create/edit/delete dialog | `CalendarPage.tsx:480-583, 1000-1056` | **REPAIR** | Same writer; `delete` → cancel with outcome; store tz. |
| Calendar "Auto-fill schedule" button | `CalendarPage.tsx:608-640` | **KEEP** | Working daily feed; keep the explicit "emails managers" disclosure. |
| Calendar sync tile | `CalendarPage.tsx:745-752` | **REPAIR** | Per-provider truth: Calendly (last webhook row + last reconcile run), Google (`gcal-sync` not scheduled → "Not connected since 2026-06-10"). |
| `/dashboard/recruiting/interviews` | `src/pages/Interviews.tsx` | **MERGE** → Calendar "Interviews" tab/drawer + Pipeline person drawer | Brief §3 removes the nav destination; the control room (stage actions, VA ownership, version check, onboarding-call list) is the capability to keep. Redirect route to `/dashboard/calendar?panel=interviews`. |
| `/dashboard/recruiting/follow-ups` (Interview Recovery) | `src/pages/InterviewRecovery.tsx` | **MERGE** → Calendar agenda "Due" lane + Pipeline queues "Due Today/Overdue" + Home immediate actions | Brief §3. Keep `cc_dispose_interview` + `v_interview_pipeline` as the backend; redirect to `/dashboard/agent-pipeline?queue=follow-ups`. |
| Interviews nav items | `agentCloudNavigation.ts:149,151`, `MobileBottomNav.tsx:40-41,48` | **REMOVE** | Brief §3; also remove from CommandPalette entries that point at them. |
| `/dashboard/planner` | `src/pages/AdminCalendar.tsx` | **REMOVE** (redirect → `/dashboard/calendar`) | 0 rows ever in both tables, no nav link, duplicates Calendar day view; keep `parse-schedule-image` only if another surface adopts it. |
| `/dashboard/today` | `src/pages/DashboardToday.tsx` | **REMOVE** (redirect → `/dashboard/command`) | Both data sources dead (`today_tasks` June, `v_upcoming_calls` June); `/today` already redirects there. Update `operatorConsole.ts:37` + `AgentCommandDashboard.tsx:3257`. |
| `/dashboard/calls-today` | `src/pages/CallsTodayCockpit.tsx` | **MERGE** → Calendar day/agenda view | Reads the right table; its today/tomorrow/later grouping and disposition stats belong in the Calendar agenda, not a fourth page. |
| `/dashboard/headhunters-calendar` | `App.tsx:695` | **KEEP** redirect | Already resolved. |
| `/schedule-call` (public Calendly embed) | `src/pages/ScheduleCall.tsx` | **KEEP** | Public booking entry; verify slugs (D-11). |
| `/assistant/interviews` + `assistant-add-interview` | `AssistantInterviewForm.tsx`, edge fn | **REPAIR** | Write `interview_events` (source `manual`) instead of `manual_interview_entries` + `hh_applicants` dual-write; keep token auth and replay safety. |
| `CalendarSyncSection` ("Apple Calendar Sync") | `src/components/dashboard/CalendarSyncSection.tsx`, `ics-feed` | **REPAIR** | Serve appointments (interview_events + calendar_events) per user from `ics-feed`, rename honestly, show last-polled time from `ics_feed_tokens.last_accessed_at`. |
| `scheduled_interviews` table + `fn_sweep_interview_reminders` + cron 51 | DB | **REMOVE** writers/job (keep table rows; no DROP) | Dead table with a green 5-minute cron. Replace with the reminder lifecycle in §7. |
| `apex_scheduled_calls` / `v_upcoming_calls` / `gcal-sync` | DB + edge fn | **REMOVE** from UI; keep objects | Google sync has no schedule and no consumer after `/today` goes. If Google is wanted, re-point `gcal-sync` at the one-event table and schedule it; otherwise show "not connected". |
| `calendly-webhook`, `calendly-backfill`, crons 87/91 | edge fns | **KEEP** (REPAIR D-09; consolidate the two reconcile schedules into one) | The only live provider path. |
| `onboarding-call-invites` + cron 86/90 | edge fn | **KEEP** | Honest receipts, METHOD:CANCEL on cancel — the pattern to generalize. |
| `calendly-alerter` launchd daemon | `~/business-ops/scripts/apex-calendly-alerter.py` | **REPAIR** (D-01, today) | Fix marker parsing, per-row dedupe, never swallow a watermark error. |
| `send-calendly-invite` | edge fn | **REPAIR** | Slug → `system_settings` key resolved per track; Sam decides which event type licensed prospects get (D-11). |
| `schedule-interview` email | edge fn | **REPAIR** | Explicit `timeZone` (recipient's if known, else Phoenix + Central like the alerter). |
| `seminar-reminder-tick` | edge fn | **REMOVE** or schedule | No cron, 0 opted-in future registrations; a reminder path that cannot fire should not exist. |
| `interviews-outcome` | edge fn | **KEEP** (410 stub) | Already retired safely. |

---

## 7. Recommended implementation plan

### 7.1 One-event model (additive, non-destructive)
Make **`interview_events` the single appointment record** for every person-linked meeting (interview, onboarding call, callback, policy review, manual appointment). It already has identity, provenance (`calendly_event_uri` unique), outcome, cancel, reschedule URLs, RLS for staff, and every live reader. Keep `calendar_events` for non-person date markers (draft dates, post-test follow-ups, Siri reminders).

Migration `supabase/migrations/2026100X_calendar_one_event.sql` (also applied via MCP, same SQL):
- `alter table interview_events add column if not exists`: `kind text` (CHECK `interview|onboarding_call|callback|appointment|policy_review`, default derived from `call_track`), `event_tz text` (IANA, the zone the time was booked in — host or invitee), `invitee_tz text`, `meeting_link text`, `owner_user_id uuid references auth.users`, `hh_applicant_id uuid references hh_applicants(id)`, `status text` CHECK (`scheduled|rescheduled|canceled|completed`) kept in lock-step with `canceled_at`/`outcome` by a BEFORE trigger (status literal inside the CHECK — brief rule).
- Widen `source` CHECK to add `'staff'` and `'assistant'`; widen `call_track` only if a new Calendly type appears (read constraint first).
- `appointment_reminders(id, event_id → interview_events, send_at timestamptz, channel text CHECK(inbox|email|sms|ntfy), recipient_user_id, status text CHECK(pending|sent|canceled|failed|skipped), sent_at, provider_message_id, last_error, created_at)`; unique `(event_id, channel, send_at)`.
- Trigger `trg_interview_events_reminders`: AFTER INSERT → enqueue T-24h (email to invitee if email, inbox to owner) and T-30m (ntfy to owner); AFTER UPDATE OF `scheduled_at` → `canceled` all `pending` rows for the event and re-enqueue; AFTER UPDATE OF `canceled_at`/`outcome` → `canceled`/`skipped` pending rows. This is the "reschedule cancels obsolete reminders" rule, enforced at the record, not in four UIs.
- RPC `book_appointment(p_kind, p_scheduled_at timestamptz, p_event_tz, p_application_id, p_agent_id, p_hh_applicant_id, p_meeting_link, p_notes)` SECURITY DEFINER with the same role test as `interview_events_staff_write`, returning the row; RPC `reschedule_appointment(p_id, p_new_at, p_event_tz, p_reason)` (writes `was_rescheduled`, bumps `hh_applicants.appointment_at`/`reschedule_count` when linked, inserts `hh_activity`); RPC `cancel_appointment(p_id, p_reason, p_outcome)` (sets `canceled_at`, optional outcome, never deletes). Extend `cc_dispose_interview` to also write `status`.
- Backfill links only where unambiguous: `hh_applicant_id` by exact lower(email) match where exactly one `hh_applicants` row matches (measure before: 104 candidates). Do **not** backfill `reminder_sent_at`.
- `calendar_window`: add `kind` mapping from the new column, emit `event_tz`, `meeting_link`, `status`, `owner_user_id`; keep Phoenix bucketing but return the raw instant so the client can render in the viewer's zone. Keep `calendar_window_counts` in sync (same CTE).
- Replace `fn_sweep_interview_reminders` body to drain `appointment_reminders` (inbox via `fn_emit_inbox_notification`, ntfy/email via `apex-alert-dispatch`/Resend with message-id receipts, mark `failed` with `last_error`); keep cron 51's name so the schedule survives.
- Views: `v_calendar_provider_health` (scalar subqueries, one row always): last webhook row `created_at`, last `calendly_reconciliation_runs` status/started_at, `gcal` last `synced_at`, pending/failed reminder counts. Feed the sync tile and apex-doctor from this.

### 7.2 Front end
- `CalendarPage.tsx`: add `agenda` to `ViewMode`; persist `{view, activeKinds}` in `localStorage["apex.calendar.prefs"]` (per-viewer convenience) with try/catch and URL `?view=&day=` for shareable links; render every time as `h:mm a <zone abbr>` with a header toggle "Phoenix / Central / My device"; day/agenda rows get Reschedule (inline datetime + zone) → `reschedule_appointment`, Cancel → `cancel_appointment` with outcome select, Open person (application/agent/hh drawer), Join link; replace the delete button; replace `markNoShow` with `cc_dispose_interview`; sync tile from `v_calendar_provider_health` with explicit "Google Calendar: not connected (last sync 2026-06-10)".
- `InterviewScheduler.tsx`: call `book_appointment` (kind `interview`, `event_tz` = selected zone, default Phoenix with the applicant's residence-state zone offered only if the application carries one — never inferred from phone); drop the `scheduled_interviews` insert and the direct `applications.status` write (move into the RPC); send the confirmation with an explicit zone.
- `Interviews.tsx` control room → `src/components/calendar/InterviewControlRoom.tsx` mounted as a Calendar tab and inside the Pipeline person drawer; `interviews-pipeline` `reschedule` case must call `reschedule_appointment` for the linked `interview_events` row (via `hh_applicant_id`) or refuse with a clear message when the booking is Calendly-owned and must be moved through `reschedule_url`.
- `InterviewRecovery.tsx` queue → Calendar agenda "Needs outcome" lane and Pipeline saved queue; keep `cc_dispose_interview`.
- Remove nav items; add redirects (`/dashboard/recruiting/interviews` → `/dashboard/calendar?panel=interviews`, `/dashboard/recruiting/follow-ups` → `/dashboard/agent-pipeline?queue=follow-ups`, `/dashboard/planner` → `/dashboard/calendar`, `/dashboard/today` → `/dashboard/command`) using the existing `LegacyWorkspaceRedirect` pattern; mark retired pages `// intentionally-orphan:<reason>` or delete them once nothing imports them.
- `AssistantInterviewForm` / `assistant-add-interview`: write through `book_appointment` (source `assistant`).
- `CalendarSyncSection` + `ics-feed`: emit the user's appointments; rename.

### 7.3 Ops fixes outside the repo (same wave, today)
- `apex-calendly-alerter.py`: tolerant parse (`re.sub(r'\.(\d{1,5})(?=[+-])', pad6)`), per-row `alerted` set persisted next to the watermark, and a hard rule: a watermark parse failure logs at error level and halts the tick instead of `pass`. Then reset the watermark to now.
- Decide Google: either schedule `gcal-sync` (pg_cron every 5 min, per its header) against the one-event table or remove the "Google" promise from the UI.

### 7.4 Tests to write
- `src/tests/lib/calendarOneEventContract.test.ts` (vitest, source-reading like `interviewPipelineContract.test.ts`): no `from("scheduled_interviews")` insert anywhere in `src/`; every scheduling entry point calls `book_appointment`/`reschedule_appointment`/`cancel_appointment`; `CalendarPage` has no hard `delete()` on `calendar_events`; no `PHOENIX_OFFSET` literal used for writes; nav config lacks the removed hrefs; redirects exist.
- `src/tests/lib/calendarPrefsPersistence.test.ts`: prefs round-trip with a throwing `localStorage` stub.
- SQL proof script (repo pattern: DO-block RAISE, rolled back): insert a synthetic booking → 2 pending reminders; reschedule → old rows `canceled`, 2 new pending; cancel → none pending; cross-zone case: booking at `2026-11-01 01:30 America/Chicago` (DST fall-back day) renders Phoenix `23:30` previous day and keeps a single instant.
- Red-fixture proof for the alerter parser (5-digit fraction, `+00`, `T` vs space) under `/usr/bin/python3`.
- apex-doctor check (business-ops, versioned there): `v_calendar_provider_health` — Calendly webhook silence > 7d while reconcile sees rows → CRITICAL; reminders `failed` in 24h → WARN; alerter duplicate-page detector (same row_id > 2 ALERTED lines/day → CRITICAL).

### 7.5 Guards affected
`check:sidebar-routes` (removing Grow items; note `scripts/check-sidebar-routes.mjs:45` history about the 10-item slice), `check:orphan-pages` (Interviews/InterviewRecovery/AdminCalendar/DashboardToday/CallsTodayCockpit must be imported or carry the marker), `check:dead-internal-links` (MobileBottomNav, ManagerCommandView:237, operatorConsole:37, AgentCommandDashboard:3257, CommandPalette), `check:kanban-stage-vocabulary` (if hh stage labels move), `check:stale-key-in-list` (new agenda lists), `check:page-header-compact`, `check:maybesingle-nonunique` (any new `.maybeSingle()` on `interview_events` by email is non-unique — use `.limit(1)` or the RPC), `check:empty-catch` (CalendarPage:654 already carries an allow marker), `check:tsc-error-count` baseline, `check:function-contracts` if RPC signatures are registered. Existing `interviewPipelineContract.test.ts` cases 9 ("routes every visible interview entry into the recruiting workspace") and 98/124 will need re-targeting to the Calendar panel, not deletion.

---

## 8. Risks and open questions

Risks
- `InterviewScheduler` is mounted on four pages and `CallCenter` uses it as its "Reschedule" action; re-pointing it changes a VA daily-driver — ship behind the same modal props, prove with the contract test, and screenshot-verify CallCenter.
- `interviews-pipeline` is VA-scoped by `hh_users.email`; moving the control room into Calendar (a `PRODUCERS`-mode nav item) must not widen who can act — keep the edge fn as the only writer for `hh_applicants`, and gate the Calendar tab by the same roles the Interviews route used.
- `calendar_window` is SECURITY INVOKER: agents see their own `calendar_events` and nothing from `interview_events` (no agent policy). Any "agents see their onboarding call on the Calendar" requirement needs a scoped policy (`agent_id = get_agent_id(auth.uid())`), measured as a non-admin before shipping (memory: non-security_invoker views leak; this is the inverse — invoker hides).
- Redirecting `/dashboard/today` and `/dashboard/planner` touches `operatorConsole` voice routing tests (`src/tests/lib/operatorConsole.test.ts:27`).
- Reminder channels: SMS is email-to-carrier with no receipt (MP-273); do not add SMS reminders until a provider receipt exists. ntfy is Sam-only; invitee reminders must be email with Resend ids.
- Backfilling `hh_applicant_id` by email across 104 candidates risks the known duplicate-profile class (`profiles.email` 8 colliding groups); link only on exactly-one matches.

Open questions for Sam
1. Should licensed prospects book `Licensed Call` (`1on1-call-clone`) or `Leader Call ` (`licensed-prospect-call-clone`)? 22 references currently send them to Leader Call (D-11).
2. Is Google Calendar still a desired provider (assistant-entered calls, per `gcal-sync` header), or is Calendly the only booking source? Decides REPAIR vs REMOVE for `gcal-sync`/`apex_scheduled_calls`.
3. What should happen to the 246 past bookings with no outcome — bulk "unknown/legacy" outcome, or leave them in the Needs-outcome lane?
4. Who may reschedule a Calendly-owned booking from inside APEX? The Calendly API can cancel but not move an event; the honest in-app action is "cancel + send new booking link" or "open invitee reschedule_url". Pick one.
5. Default display zone for VAs (Philippines) vs Sam (Phoenix) vs Calendly (Central): per-user preference, or always show two zones like the alerter does?
6. Keep the Planner concept at all (0 rows since March), or delete `AdminCalendar.tsx` outright?

Unmeasured, stated plainly: Calendly webhook subscription list and Calendly-side invitee reminders; per-role render of `v_interview_pipeline` (gated by `is_agency_staff()`, false for my role); why webhook rows have no `raw_payload`; whether `/dashboard/calendar` is reachable unauthenticated; the deployed `CALENDLY_API_TOKEN` env (only the length-0 settings row is visible).
