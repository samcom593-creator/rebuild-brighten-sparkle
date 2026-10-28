# Hiring funnel and re-engagement map (read-only analysis, 2026-10-28)

Program: `docs/prompt-pack/platform-redesign/` (area 03). Method: ripgrep and reading of `src/`,
`supabase/functions/` and `supabase/migrations/` on `claude/grow-redesign-prompt` (merged with `main`
2442a66). Live cron state could not be read from the repo: some jobs were turned off by hand
(`20261021200000_health_check_respects_disabled_crons.sql`), and several senders say in their own headers
"No caller (PL-WIB…, 2026-10-11/14)". Where the migrations and those headers disagree, it is said so.
Analyses H1 and H2 in `12-ANALYSIS-SESSIONS.md` start from this map and add the measured numbers.

## A. Hiring funnel stages, as the code records them

| Stage | Recorded in | UI (file → route) | Counted by | Written by · day rule |
|---|---|---|---|---|
| IG / landing visit | `inbox_messages` (source='instagram'); `analytics_events` (`src/shared/telemetry/track.ts`) | `InstagramInbox.tsx` → `/dashboard/inbox/instagram`. Landing visits: no UI | `fn_ig_dashboard`; `v_apply_funnel_by_source` (nothing reads it) | Bot/webhook; `v_ig_followup_truth` groups by UTC `::date` |
| Application started | `partial_applications` (email, phone, step, form_data, converted_at, recovered_at, recovery_*), via `save_partial_application` (`Apply.tsx:500`); ManyChat also writes `step='inbound_dm'` stubs | `AbandonedLeadsPanel.tsx`, mounted at `DashboardCommandCenter.tsx:1204` → `/dashboard/admin` | `v_partial_applications_abandoned` / `list_abandoned_partial_applications`; `fn_ig_abandoned_partials` | The applicant; "abandoned" is derived |
| Submitted | `applications` (record_type='application', not duplicate, terminated_at null), via `submit-application` | `RecruitingWorklist.tsx` → `/dashboard/recruiting`; classic view at `?view=classic`; `/dashboard/recruiting/pipeline` (`v_recruiting_pipeline`) | `inQueue('new')` (rolling 7×24h); classic `isNewToday` (Phoenix day, `DashboardApplicants.tsx:154-165`) | The applicant |
| Contacted | `last_contact_outcome(_at)`, `last_contact_channel`, `application_contact_log`, all via `record_recruiting_outcome`; also `last_contacted_at`; legacy `contacted_at` | Call list: "Never contacted", "Worked today" | `hasRecordedContact`; `computeScoreboard.workedToday` (Phoenix, `recruitingQueues.ts:196-205,423-433`) | A person, through the RPC. `last_contacted_at` is also written by bots |
| Interview booked | Three places: (a) `last_contact_outcome='appointment_booked'` plus a dated next action; (b) `interview_events` (Calendly webhook/backfill, `book_interview_event`); (c) `hh_applicants.stage` appointment_set/confirmed (rows come from the legacy Headhunter app; `interviews-pipeline` updates them with `version` + `hh_activity`) | "Booked" tile on the Call list; `Interviews.tsx` → `/dashboard/recruiting/interviews`; `InterviewRecovery.tsx` → `/dashboard/recruiting/follow-ups`; `CalendarPage.tsx` → `/dashboard/calendar` | `computeScoreboard.booked`; `v_interview_pipeline.bucket` (America/Chicago); `calendarAgenda.ts` (Phoenix); hh stage `counts` | People and Calendly |
| Showed / no-show | `interview_events.outcome`, via `cc_dispose_interview`, which also sets `applications.status` and `last_contacted_at`; `hh_applicants.stage` interview_complete/no_show; start day: `agent_start_plans.start_outcome` | Follow-ups, Interviews, Calendar, onboarding queue | `v_interview_pipeline` (Chicago) | People |
| Hired / licensed / contracted | Hire: `agents` row created by `add-agent` (`hireToOnboarding.ts:63-127`), which also sets `applications.status='onboarding'`, `closed_at`, `source_application_id`. Licensed: `license_status`, `licensed_at`, `nipr_verified`. Contracted: `agents.contracted_at`, `contracting_intakes`, `contracting_checkins.contracts_confirmed_at`, carrier tables | `RecruitPipeline.tsx` → `/dashboard/recruits`; `OnboardingLadder.tsx` → `/dashboard/onboarding-ladder`; `/admin/licensed-inbox` | `interviews-pipeline` `fetchActiveHires` (agents created this Phoenix month, `:371-418`); `onboarding_exception_facts()` + `buildExceptionQueue`; `fn_hire_priority_rows` | Hire is by a person; the evidence is derived |
| First deal | `deals.posted_at` → `v_production_canonical` → `agents.first_deal_at` (`fn_reconcile_first_deal_at`, hourly) | Onboarding queue `first_deal_missing` | `onboardingExceptions.ts:621-632`; `v_queue_active_no_first_sale` (nothing reads it) | Derived |
| Active agent | `agents.status`, `is_deactivated`, `is_inactive`; production ledger | `ProducerPulse.tsx` (`v_producer_pulse`, Phoenix); "Licensed, then went inactive" (`v_queue_licensed_inactive`) | Registry metric `active_producers` (Central time, `docs/metric-registry.md`) | Derived |

`RecruitingCommandHero` only displays numbers; the pages that use it compute them: the classic view (New
today, Follow-ups due via `isFollowupDue` :169-175, Interviews ahead from future `interview_events`, Active
hires MTD, Active pipeline), `Interviews.tsx` (hh stage counts), `InterviewRecovery.tsx` (`v_interview_pipeline`
buckets).

## B. Re-engagement mechanisms

| Mechanism | Trigger · channel | Audience | Writes back | Visible in | Guardrails |
|---|---|---|---|---|---|
| IG DM nudge1/2 (`instagram-dm-nudge`; `fn_ig_nudge_candidates`, current version in 20261028025503) | cron */10 · DM via `send-instagram-dm` | Our last delivered message (has `mid`) asked a question; `last_in > now-23h`; nudge1 after 60 min; nudge2 only if business and 20h silent; no Sam message in 14d | `inbox_messages.raw_payload.tag/mid/error` | Instagram inbox | At most 2 per 24h; 20 sends per run; Meta's window. No quiet hours; no check against applications or DNC |
| IG abandoned-application email (same function; `fn_ig_abandoned_partials`, 20261028025432:42-57) | same cron · `sendEmail` | Has email, step≠inbound_dm, not converted or recovered, no prior recovery email, 2h–14d old, came from Instagram, no application with that email; 25 per run | `recovery_email_sent_at`, only when Resend returns an id | Instagram inbox, but not the abandoned panel | Resend suppression only |
| Partial recovery queue (`recover_partial_applications`) | hourly · sends nothing | Abandoned view, older than 30 min | `recovery_queued_at` (a queue mark, per MP-408) | none | — |
| Manual abandoned follow-up (`send-abandoned-followup`) | button on the admin panel · email, CC admin | The chosen partial | `form_data.followup_sent_at` | Abandoned panel | Ignores `recovery_email_sent_at` and unsubscribes |
| Day-0 touches | `trg_new_app_notify` (20260422080000:45-48) → `sms_fallback_queue` → drainer */2; `applicant-login-tick` */15 email | Every new application | `sms_fallback_queue.sent_at`; `notification_log` | none | SMS ignores consent and quiet hours |
| "Still interested?" (`system-health-check:95-200`) | cron */15 · email | not terminated, not contracted, older than 3 days, `contacted_at` null, email not bad, not unsubscribed; 10 per run | `contacted_at` / `email_bad_at` | none | Reads unsubscribes; ignores consent and recorded outcomes |
| Applicant drip (`send-followup-emails:356-472`) | daily 15:00 UTC (8 am Phoenix) · email, CC'd to a manager | Unlicensed at day 3–4 and day 7–8; licensed at day 3–4 with `contacted_at` null; not closed or terminated | `followup_sent_at`, `followup_unlicensed_2_sent_at`, `followup_licensed_sent_at` | none | Resend gate only |
| Next-step nudges (`fn_next_step_nudge_sweep` → `next-step-dispatch`) | hourly at :07 · Telegram, then SMS, then email | `next_step_progress.status='active'` and the stage has a `reminder_cadence` | `next_step_messages` (dedupe_key, sent_at, external_id); `last_nudged_at` | Onboarding queue "last outreach" | Quiet hours 08–21 in the recipient's zone (20261016210500); 20h/6h throttle; skips unsubscribed people |
| Call list due/overdue queues | manual | `next_action_due_at`, else `next_review_at`; Phoenix day | `record_recruiting_outcome` / `set_recruiting_plan` | `/dashboard/recruiting` | The RPC refuses DNC, bad phone, missing SMS/email consent, unsubscribed; checks for edit conflicts |
| No-show follow-ups | manual | Follow-ups buckets (missed_*, no_show); hh `no_show` | `interview_events.outcome/followup_due_at`; hh `version` + `hh_activity` | Follow-ups, Interviews, Calendar | Nothing automated |
| Interview reminders (`fn_sweep_interview_reminders`) | cron */5 · in-app reminder to staff only | The `interview_events` branch runs only if `calendar_interview_reminders_enabled='true'` | `reminder_sent_at` (0 of 271 rows per 20261006130000) | Calendar | Off by default; no reminder to the candidate in the code |
| No-pickup / revival SMS (20260422080000:88-162) | 16:00 UTC, 17:30 UTC, monthly · SMS queue | status `no_pickup` updated 3–4 or 7–8 days ago; `rejected` for 90+ days | Tags appended to `notes` | none | No consent, DNC or duplicate checks; live state unknown |
| No Hire Left Behind / onboarding queue | manual buttons | `onboarding_exception_facts()`: canonical agent, active/pending, not deactivated or inactive | Receipt per button | `NoHireLeftBehindPanel`, `/dashboard/onboarding-ladder` | No automation reads it |
| New-hire automations | `apex-newhire-portal-login-hourly`; onboarding-call gap sweep 4×/hour; Sunday starter reminders | `v_newhire_needs_portal_login` (72h throttle); licensed hires ≤30d not roster-excluded; `agent_start_plans` | `magic_login_tokens`, `agent_onboarding_queue`, `monday_starter_notifications` | Onboarding queue | Idempotent claims |
| Stalled-hire alert (`hire_priority_alert`) | weekdays 16:00 and 22:00 UTC · push (ntfy) to Sam | Active licensed hires ≤45 days old, past the 3-day carrier / 5-day contract thresholds | none | no page | Demoted for 24h after a call. `next_step_stall_sweep` only sets `is_stalled` |
| Email gate (`_shared/email.ts`, `_shared/resend-gate.ts`) | every Resend send | Drops `email_suppressions` (provider bounces and complaints) and non-routable domains | ok:false / refused | — | Fails open; does not read `email_unsubscribes`, `do_not_contact_at` or `email_consent_given` |
| Consent / DNC (20261006120000:331-430) | `record_recruiting_outcome('do_not_contact')` | — | `do_not_contact_at/by/reason`; both consent flags set false; an `email_unsubscribes` row; recruit stage closed (20261006181500) | Worklist blockers | No edge function reads `do_not_contact_at` |

## C. Gaps and dead ends

1. **No-show follow-ups never reach the Call list.** The nav says "follow-ups are the worklist's due
   queues" (`agentCloudNavigation.ts:180-181`), but the worklist never reads `interview_events.followup_due_at`
   or hh `no_show`. No in-app link to `/dashboard/recruiting/follow-ups` was found. The old
   `/dashboard/interview-recovery` URL redirects to the Call list instead (`App.tsx:752`).
2. **"Hired" in Follow-ups or Calendar is a dead end.** `cc_dispose_interview('hired')` sets status to
   `contracting` (20260724150000:286-296) but creates no agent. The worklist then treats the person as
   closed, and No Hire Left Behind needs an `agents` row. Only `Interviews.tsx:362,382` and the classic view
   actually hire, and the Call list's `PersonPanel.tsx` cannot hire or record Showed/No-show.
3. **Four definitions of "booked" (plus a fifth on the IG dashboard).** Worklist: latest outcome is
   `appointment_booked` (its "Booked" tile opens no list, `RecruitingWorklist.tsx:387`, and recording that
   outcome creates no interview row). `interview_events`. `hh_applicants`. The IG bot's `^locked in` reply.
   The IG dashboard's `calls_booked`: `interview_events` rows with `match_method='instagram'`.
4. **"Today" differs by surface.** Phoenix for the worklist, classic view, Calendar, onboarding rules and
   active hires; Chicago for `v_interview_pipeline` and `InterviewRecovery.tsx:182`; UTC for
   `v_ig_followup_truth`; Central time for the metric registry.
5. **The same person can be reached twice in one day.** An unlicensed applicant at day 3 gets the drip
   email, the health-check email and a next-step nudge. A recruiter's call stamps `last_contacted_at` but not
   `contacted_at`, so the health-check email still goes out that day. An IG partial gets the automated recovery
   email, the manual panel email and DM nudges. An interview `no_answer` sets status `no_pickup`, which feeds
   the day-3 and day-7 SMS jobs while the person is also on the Call list. A 24h cross-channel guard exists
   but is unused: `applicant_contacted_recently()` has no caller and `last_automated_email_at` has no writer
   (20260421000000:37-61).
6. **Bots skip consent and DNC that humans must respect.** `send-sms-auto-detect:167` skips the SMS consent
   check for service callers. No automated email reads `email_consent_given`. DNC reaches automation only
   through the `email_unsubscribes` row, so it fails when there is no email (`next-step-dispatch:336`).
7. **Unsubscribes are checked by too few senders.** `check-email-unsub-suppression.mjs` covers 3 senders.
   `instagram-dm-nudge`, `send-followup-emails` and `send-abandoned-followup` do not check unsubscribes, and
   `isUnsubscribed()` fails open (`email.ts:143-159`).
8. **Two definitions of "abandoned".** The panel's view includes the `inbound_dm` stubs; the IG function
   excludes them. The panel ignores `recovery_email_sent_at`, and its comment still mentions an "hourly SMS
   sender" that does not exist (`AbandonedLeadsPanel.tsx:48`).
9. **Code that reads `contacted_at`** (the truth rule says never): UI `AgentPipeline.tsx:46-57,407-434`,
   `RecruiterDashboard.tsx:85-196`, `HiringPipeline.tsx:48-81` (also writes it), `CallCenter.tsx:194,217`
   (writes at :1034-1049), `StaleRecovery.tsx:204,452`, `ClientMarketing.tsx:130,168`,
   `admin/ManagerDashboard.tsx:114`, classic `DashboardApplicants.tsx:1727,2435,2459`. Edge functions
   `system-health-check:104` (stamps it at :191), `send-followup-emails:420`, `manager-daily-digest:163` (cron
   re-enabled 2026-10-21), `morning-brief:66`, `notify-lead-assigned:130,183`, `apex-audit-engine:145,178`,
   `detect-dropped-leads:38`, `send-weekly-analytics:87-92`, `nudge-unworked-applications:141`. SQL
   `v_stale_applicants` (20260806094500:1161), `v_application_conversion_funnel` (20261016105706:563),
   `v_queue_stalled_applications` (:530-546), `applicant_contacted_recently`.
10. **The worklist trusts `last_contacted_at`, but bulk actions and bots write it.** Writers include a bulk
    "mark contacted" button (`AgentPipeline.tsx:352-359`), applicant self-check-in (`applicant-checkin:176`)
    and `cc_dispose_interview`. Each moves people out of "Never contacted" with no outcome recorded.
11. **Headline numbers that disagree with the lists.** The manager digest's "Uncalled" (`contacted_at` null,
    by `assigned_agent_id`) is not "Never contacted". The classic "Follow-ups due" (48-hour rule) is not the
    worklist's "Overdue". `v_queue_stalled_applications` uses `next_step_due_at`, and its owner falls back to
    the attribution column with a hardcoded "Sam James (default)". "Active hires MTD", the No Hire Left Behind
    population and `active_producers` are three different populations.
12. **No UI at all:** `hire_priority_list`, `v_queue_active_no_first_sale`, `v_apply_funnel_by_source`,
    `v_funnel_by_source`, `v_interview_capture_health`, `v_ig_followup_truth` (service role only), and the
    health-check, drip and SMS-queue sends.
13. **Stages with no automated re-engagement:** decision due after an interview; interview no-shows; booked
    but unconfirmed (reminders are off); hired but not contracted (a push alert to Sam only); start-day
    no-show; licensed agents who went inactive; appointed with no first deal (the exception fires only when
    carrier data shows an active contract, and `coalesce(active_n,0)` treats unknown carrier status as "none").
14. **Repo and live state disagree.** Migrations still schedule `nudge-unworked-applications`
    (20260420200000:15-18; 20260421000000:18 says "Keep ONLY" it), `apex-outreach-sender-5min` and the
    reactivation SMS jobs, while the function headers say nothing calls them. Rebuilding from migrations would
    turn back on automatic flips of applicants to `no_pickup`/`rejected` (`nudge-unworked-applications:150-170`).
15. **Departed and banned people (KJ Vaughn).** The exclusion: migration 20260817153000 reassigned his
    attribution, set his agent to `terminated`/`is_deactivated`, and banned his auth until 2099; generic filters
    do the rest (`submit-application:62-75`, the digest's `status='active'`, `fn_agent_is_roster_excluded`, a
    daily `fn_access_violation_alert`). The IDs are hardcoded only on production, IMO and Slack surfaces (e.g.
    20260822222000:189, 20260907020000:70). **Leak:** that migration left `invited_by_manager_id` untouched
    (:128-129), and `send-followup-emails:42-56` CCs that manager's email with no status check, so the departed
    manager can be CC'd on applicant follow-ups. No re-engagement test covers the exclusion, and the
    banned-prospect check runs only at submit and import.
16. **Unknown shown as 0:** `InstagramInbox.tsx:73` `(v ?? 0)`; `AbandonedLeadsPanel.tsx:157` says "No
    abandoned applications" after a failed load; `manager-daily-digest:165-168` `|| 0`;
    `onboarding_exception_facts` `coalesce(cc.active_n,0)` and `onboardingExceptions.ts:319-320,460` `?? 0`;
    `v_application_conversion_funnel` percentages `ELSE 0`.
17. **Doc drift.** `docs/recruiting-workspace.md` says hires go through `promote_applicant_to_agent`; the code
    uses `add-agent`, and `hiringLifecycleContract.test.ts:15` forbids the RPC. Checks for `status='hired'`
    (`recruitingQueues.ts:220`, `interviews-pipeline:439`) can never match: the `application_status` enum has no
    `hired`.
18. **Stalls are flagged but nobody is told.** `next_step_stall_sweep` always reports `notified=0`.

## D. File map (the 25 files an implementer opens first)

1. `src/lib/recruitingQueues.ts` — queue, outcome and blocker rules, Phoenix day, scoreboard.
2. `src/components/pipeline/worklist/RecruitingWorklist.tsx` — the Call list and Today's numbers.
3. `src/components/pipeline/worklist/useRecruitingWorklist.ts` — loads the full row set; outcome/plan RPC calls.
4. `src/components/pipeline/worklist/PersonPanel.tsx` — where Showed/No-show and hire need to be added.
5. `supabase/migrations/20261006120000_recruiting_contact_outcomes.sql` — `record_recruiting_outcome`, suppression, DNC.
6. `src/pages/DashboardApplicants.tsx` — the route shell and the classic view's hero metrics.
7. `src/pages/Interviews.tsx` — hh pipeline; the only interview page that hires.
8. `supabase/functions/interviews-pipeline/index.ts` — hh actions; active hires by Phoenix month.
9. `src/pages/InterviewRecovery.tsx` — no-show follow-ups (Chicago buckets).
10. `supabase/migrations/20260724150000_mp264_interview_events.sql` — `interview_events`, `v_interview_pipeline`, `cc_dispose_interview`.
11. `src/lib/hireToOnboarding.ts` — the canonical hire path.
12. `supabase/functions/add-agent/index.ts` — writes the agent row and closes the application.
13. `src/lib/onboardingExceptions.ts` — onboarding requirement rules.
14. `supabase/migrations/20261006110000_expected_start_tracking.sql` — `onboarding_exception_facts()`.
15. `supabase/migrations/20261009000000_hire_priority_flags.sql` — stalled-hire flags and push alert.
16. `supabase/functions/instagram-dm-nudge/index.ts` — DM nudges and recovery email.
17. `supabase/migrations/20261028025432_ig_followup_engine.sql` — IG candidates, truth view, cron.
18. `src/components/dashboard/AbandonedLeadsPanel.tsx` — the only UI for partial applications.
19. `supabase/functions/_shared/email.ts` — the email gate (its twin is `resend-gate.ts`).
20. `supabase/functions/system-health-check/index.ts` — 15-minute applicant email keyed on `contacted_at`.
21. `supabase/functions/send-followup-emails/index.ts` — day 3/7 drip and the manager CC.
22. `supabase/functions/next-step-dispatch/index.ts` — Telegram → SMS → email chain and unsubscribe skip.
23. `supabase/migrations/20261016210500_next_step_quiet_hours.sql` — the only quiet-hours logic; worth reusing.
24. `supabase/migrations/20260422080000_lead_flow_automations.sql` — new-application SMS and the no-pickup/revival SMS.
25. `supabase/functions/send-sms-auto-detect/index.ts` — where service callers skip the SMS consent check.
