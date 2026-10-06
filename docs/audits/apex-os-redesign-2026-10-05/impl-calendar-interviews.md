# Section 7: Calendar implementation note

Branch `apex-os/calendar-interviews`. The migration has not been applied to production. It was proven inside a transaction that rolled back.

## What changed

| Area | Change |
|---|---|
| Data model | `supabase/migrations/20261006130000_calendar_agenda.sql`. It adds `interview_events.event_tz`, `meeting_link`, `owner_user_id` and `reminder_notification_id`, all nullable. It adds a history table `interview_event_activity` (RLS: staff or the event owner can read; only the definer functions write to it). It adds an owner-read RLS policy on `interview_events`. It adds the security_invoker view `v_calendar_agenda` and the RPCs `book_interview_event`, `reschedule_interview_event`, `cancel_interview_event`, `calendar_owner_conflicts` and `calendar_provider_health`. Internal helpers: `calendar_is_scheduling_staff`, `calendar_can_book_for_application`, `calendar_valid_tz`, `calendar_interview_reminders_enabled`, `fn_supersede_interview_reminders`, `fn_log_interview_event_activity`. The migration also does a create-or-replace of `fn_sweep_interview_reminders`. Its legacy body is unchanged, and it gains a new branch that is off by default. |
| One event | `InterviewScheduler.tsx` is mounted in CalendarPage, AgentPipeline, CallCenter and RecruiterDashboard. It used to INSERT `scheduled_interviews`, which held 2 rows ever and which the Calendar never read. It now calls `book_interview_event`, which writes the `interview_events` row that Calendar, Calls Today, Follow-Ups and the Pipeline already read. The booking time is built in the **chosen** IANA zone, not the browser's zone. Before booking, the modal shows a conflict warning. The applicant's status moves to `interview` only from an early stage; the old modal could drag a contracting person backwards. |
| Calendar page | The default view is now **Agenda** (14 days), alongside Day, Week and Month. The view, kind filters and the "show canceled" setting are remembered per user in localStorage. Every read and write is wrapped in try/catch and falls back to defaults. Both feeds are paginated past the 1000-row cap. Each row shows the time in the event's own zone and, when it differs, the viewer's local time and day. Actions: Reschedule and Cancel (RPCs) on staff-booked interviews. Calendly-owned bookings get "Reschedule/Cancel in Calendly" links, because the 15-minute reconcile would overwrite an in-app edit. No-show goes through `cc_dispose_interview`, so `applications.status` follows the same mapping as Follow-Ups. Appointments have edit (with zone and meeting link) and a **soft** cancel with a reason; the hard DELETE is gone. The fake "Calendar sync: Live" tile is replaced by a provider panel with real signals. The page loads behind the shared `PageSkeleton`. |
| Time zones | The new `src/lib/calendarTime.ts` is pure and Intl-based, with no fixed offsets. DST edges are deterministic: a time in the spring-forward gap moves forward, and the repeated hour at fall-back resolves to the earlier instant. The `PHOENIX_OFFSET` write path is removed. |
| Integrations | The new `ProviderHealthPanel` reads `calendar_provider_health()`. Calendly shows the last webhook booking and the last reconcile status and age. Google Calendar shows "Not connected" when no `gcal-sync` cron job exists, and "Unknown" when cron is unreadable. Onboarding invites show queued, sent and failed counts plus the last error. Interview reminders show on or off and the receipt count, and say plainly that Calendly's own reminders are not visible here. The phone-feed line shows when the feed was last polled. `CalendarSyncSection` was titled "Apple Calendar Sync"; it is now honestly labelled as a **task** feed, because `ics-feed` serves `agent_tasks`, not appointments, and it shows when a device last fetched it. |
| Email honesty | `schedule-interview` takes `timeZone`; with no zone it now falls back to Arizona instead of UTC. It used to return `success:true` even when Resend refused. It now returns a 502 on refusal and `email_id` on acceptance. The modal reports "accepted by the mail service" only when a message id comes back. **The edge function needs a deploy.** The old deployed version ignores `timeZone`, and the modal then says "requested (no delivery receipt returned)". |

## Workflow traces (evidence: rolled-back proof, 22/22 PASS)

All of these ran through bot-sql in a single `begin … rollback`: the migration body, then synthetic rows, then calls as real JWT subjects. Steps 1–15 ran as an admin and steps 16–21 as plain agents. The steps:
1. **Book** at 10:00 America/New_York on Thu 2026-10-29. This writes ONE row with source `manual`, zone NY, owner equal to the caller and a 30-minute length. It lands at 14:00Z, which is 07:00 in Phoenix. A history row is written.
2. **Availability.** A 14:15Z slot for the same owner returns the overlap. The exclude key removes it.
3. **Reschedule** to 10:00 NY on Thu 2026-11-05. This crosses the 2026-11-01 DST change. It updates the **same** row: still one row, now at 15:00Z, which is 08:00 in Phoenix. `was_rescheduled` is set and the reminder receipt is cleared. An inbox reminder about the old time is marked superseded, and `reminders_superseded=1` is recorded in history.
4. **Cancel** with outcome `not_interested`. The row stays, with `canceled_at`, the reason and the outcome (via `cc_dispose_interview`), and there are 3 history rows. Rescheduling after the cancel is refused.
5. **Calendly-owned** row: both reschedule and cancel are refused with `calendly_owned`. An unknown IANA zone is refused.
6. **Reminder lifecycle with the flag ON.** The flag exists only inside the rolled-back transaction. The sweep emits one T-30 inbox reminder to the owner and stores the `notifications.id` as the receipt. A second sweep sends nothing new. Rescheduling supersedes the sent reminder and re-arms.
7. **Permissions.** A plain agent cannot book, cannot read provider health (42501) and sees 0 interview rows through the view. An agent attributed on an application can book for that recruit; the owner is forced to them and the booking is mirrored to `lead_activity`. That agent cannot book email-only, cannot book for another owner, can reschedule their own booking, and sees exactly that one row through the view. A different agent cannot reschedule or cancel it.
8. The admin reads both synthetic rows through `v_calendar_agenda`: `canceled/closed/America/New_York` and `rescheduled/pending/America/Phoenix`. Provider health returns exactly one row (`ok`, `gcal_job=false`).

After the run, `interview_event_activity`, `v_calendar_agenda` and the new columns do not exist in prod. There are 0 proof rows and no flag row.

## How reminders work (what is and is not tracked)

- **Onboarding calls.** `onboarding_call_invites` holds real `.ics` REQUEST and CANCEL messages, with Resend ids as receipts. The existing trigger `trg_queue_onboarding_call_invites` already re-sequences invites when `scheduled_at` changes and withdraws or cancels them when `canceled_at` is set. A reschedule or cancel through the new RPCs therefore moves or stops them automatically. The view reports `invite_sent/queued/failed/none`.
- **Staff-booked interviews.** The T-30 reminder is **computed at sweep time** from `scheduled_at`. It is an inbox notification, gated by `system_settings.calendar_interview_reminders_enabled`, which is **absent, so OFF**. The receipt is `reminder_notification_id`, the inbox row the emitter actually returned; a failed emit leaves the event unstamped. A reschedule clears the receipt and supersedes the old inbox row, so the next reminder follows the new time. A cancel stops it, because the sweep skips rows with `canceled_at`.
- **Calendly bookings.** Calendly sends its own reminders. APEX cannot see them, and the UI says so (`calendly_managed`).
- `interview_events.reminder_sent_at` is left untouched; nothing writes it. The legacy `scheduled_interviews` sweep is preserved verbatim, and nothing in `src/` writes that table any more (a contract test enforces this).

## Tests and guards

- Vitest, 45 tests in 6 files, all passing:
  - `src/tests/lib/calendarTime.test.ts`: NY across the Nov-1 DST change, the fall-back overlap, the spring-forward gap, Phoenix with no DST, a viewer in Manila on a different day, and unknown-zone labelling.
  - `src/tests/lib/calendarAgenda.test.ts`: dedupe, degraded fallback, edit modes, canceled-event handling, kind filter, Phoenix bucketing, ordering.
  - `src/tests/components/calendarPrefs.test.ts`: round-trip, blocked storage, corrupt values.
  - `src/tests/components/calendarProviderLines.test.ts`
  - `src/tests/lib/calendarOneEventContract.test.ts`
  - the existing `AgentCloudParity.test.tsx`
- `npx tsc -b --noEmit --force`: **82** errors, the same as the baseline.
- Guards: everything in the required list is green except `check:rpc-args` and `check:rpc-status-literals`. Both fail **only** because the 5 new RPCs are not yet in the regenerated catalogs, as expected. `check:focus-ring-areas` and `check:unsent-receipt-marker` caught real issues in my first cut, and both were fixed. `check:brand-literals` dropped 509 → 508 because one "Apex Financial" literal left InterviewScheduler. I did not lower the baseline, to avoid conflicts with other branches.
- `vite build` succeeds.

## What remains

1. **Apply the migration.** Then regenerate `types.ts`, `scripts/data/*` catalogs (rpc-args, rpc-column-vocabulary). Then deploy `schedule-interview`.
2. `interviews-pipeline` reschedules `hh_applicants.appointment_at` only. Its 104 email-matched rows still diverge from `interview_events`. The Interviews/Pipeline owner should route that action through `reschedule_interview_event` for staff-owned rows, and through the Calendly link for Calendly rows.
3. Decisions for Sam:
   - Turn on the T-30 inbox reminders (`calendar_interview_reminders_enabled = 'true'`)?
   - Keep or retire `/dashboard/planner` (`AdminCalendar.tsx`, 0 rows ever). I left it untouched.
   - Decide whether `gcal-sync` should be scheduled. The panel shows "Not connected" until it is.
4. The appointment soft-cancel and edit go through `calendar_events` RLS, so users can change only their own rows. Admins can read every appointment but cannot cancel another user's, as before.
5. I made no edits to the `calendly-alerter` daemon (audit D-01). It is outside this repo, and it belongs to the command center.
