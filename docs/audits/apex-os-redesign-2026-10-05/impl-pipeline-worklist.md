# §5 Pipeline → recruiting contact workspace (implementation note)

Branch `apex-os/pipeline-worklist` · 2026-10-06 · input report: `04-pipeline-contact-workspace.md`

## What changed

| Area | Change |
|---|---|
| `/dashboard/recruiting` (`src/pages/DashboardApplicants.tsx`) | Default view is now the **worklist** (`RecruitingWorklist`). The old applicants table is preserved at `?view=classic` (terminate/restore, scoring, interviews, speed-to-lead), linked from the worklist header. `NoHireLeftBehindPanel` stays mounted on both views with the same role gate and no props. The `initiated` contact-log write on tel:/sms:/mailto: clicks is **removed** (PCW-03: a dial-link click is not a call); speed-to-lead dialing now uses `startPhoneCall`/`startSmsThread` (Google Voice opens in a new tab instead of replacing the queue). |
| Worklist UI (`src/components/pipeline/worklist/*`) | Saved queues with full-dataset counts, Worklist ⇄ Board toggle over the same rows/filters/stage definitions (`next_step_stages`), dense table, person panel beside the queue on ≥1024px (Sheet on smaller screens), contact links that record nothing, outcome capture → plan → **Save & next**. URL keeps queue, view, search, license filter and selected person; scroll position is kept per queue+view in sessionStorage; unfinished notes are kept per viewer+record in sessionStorage and cleared only after the server confirms the save. |
| Pure rules (`src/lib/recruitingQueues.ts`) | Outcome vocabulary, channels, queue predicates, blockers/channel suppression, plan check (Needs-a-plan exception), save validation, error mapping. |
| Draft store (`src/lib/worklistDraftStore.ts`) | sessionStorage persistence that never throws. |
| `src/pages/AgentPipeline.tsx` | PCW-10: a login without an `agents` row now gets an explanation + link to the worklist instead of a silent empty page. Consumer-lead pipeline (`/dashboard/agent-pipeline` → `ClientPipeline`) untouched. |
| `RecruitingWorkspaceNav` | "Applicants" → "Worklist" (first tab). |
| Guard | `check:recruiting-contact-actions` now also watches `PersonPanel.tsx`. |

## Data model (migration `20261006120000_recruiting_contact_outcomes.sql`, NOT applied)

Reuses `application_contact_log` as the single contact record (no new table):

- `application_contact_log` + `contact_outcome` (CHECK: `no_answer, callback, interested, appointment_booked, not_interested, wrong_number, do_not_contact`; NULL on legacy rows and plan-only notes), `provider_event_ref`, `is_manual` (GENERATED = `provider_event_ref IS NULL`), `next_action`, `next_action_due_at`, `waiting_reason`, `next_review_at`, `owner_user_id`, `source_surface`. Channel CHECK **widened** to add `in_person`, `manual` (every old value still legal). Legacy rows are not rewritten.
- `applications` + `recruiting_owner_user_id` (accountable staff user, distinct from attribution columns which `fn_protect_application_attribution` freezes), owner set_at/by, `next_action_set_at/by`, `waiting_reason`, `next_review_at`, `last_contact_outcome/_at/_by/_channel` (CHECKed), `do_not_contact_at/_by/_reason`, `time_zone` + `time_zone_source` (CHECK: only `applicant_form` | `confirmed_by_staff`; never inferred from phone).
- RLS: new `applications_recruiter_read` SELECT policy (the `recruiter` role was admitted by routes but by no policy; 0 recruiter users today).
- RPCs (SECURITY DEFINER, `search_path=public`, granted to `authenticated` only):
  - `record_recruiting_outcome(...)` — validates vocabulary/channel, locks the row, authorises via `can_work_recruiting_application`, refuses a stale save (`p_expected_last_outcome_at` ≠ current → 40001), honours suppression (DNC, phone bad, `sms_consent_given=false`, email consent/bad/unsubscribed; recording `do_not_contact` is always allowed), requires a plan for open outcomes (dated action for callback/appointment), defaults owner to current owner else the actor, writes the log row + `last_contacted_at` + outcome + plan atomically, `wrong_number` stamps `phone_bad_at`, `do_not_contact` stamps DNC, turns SMS/email consent off and inserts `email_unsubscribes` so automation stops too. Accepts **no** provider ref, so every person-recorded outcome is manual. Returns the worklist row.
  - `set_recruiting_plan(...)` — owner / plan / verified time zone without inventing contact; audit row `channel='note', outcome='plan_updated', contact_outcome NULL`.
  - `recruiting_staff_directory()` — staff names for owner pickers (no emails; excludes orphan `user_roles` ids with no login); empty for non-staff.
  - helpers `is_recruiting_staff()`, `can_work_recruiting_application(uuid)` (staff org-wide; manager = same team predicate as the manager RLS policy; attributed agent via `can_work_application`), `is_recruiting_owner_eligible(uuid)`, `recruiting_worklist_row(uuid)`.
- Trigger `trg_protect_human_next_action`: a write with no JWT (pg_cron `fn_run_applicant_nudges`) can no longer overwrite a plan a person set.

## Queues (src/lib/recruitingQueues.ts — one definition for count and click)

Open = not DNC, not `not_interested`, status not rejected/disqualified, stage not `closed_lost`. New = applied ≤7d and no outcome yet · Uncontacted = no `last_contact_outcome_at` and no `last_contacted_at` (bulk `contacted_at` never read) · Due today = action due (or review date) between now and end of the Phoenix day · Overdue = due/review in the past · Awaiting reply = waiting reason with no dated action · Unassigned = no `recruiting_owner_user_id` (attribution ignored) · My queue = owner = me (the only personal queue, labelled "Assigned to you") · Needs a plan = open and missing owner, or missing (action+due) and (waiting+review), or carrying an unreadable date. Counts run over every row loaded by a `.range()` loop until a short page.

## Workflow trace (after)

Open `/dashboard/recruiting` → `ProtectedRoute` (admin/manager/va/va_manager/recruiter) → `loadWorklist()` pages `applications` under the viewer's RLS (live, `record_type='application'`, not duplicate) + 3 exact coverage counts → pick queue → person panel → Call/Text/Email link (nothing written) → pick outcome, channel, notes, next action+due or waiting+review → `record_recruiting_outcome` (auth → suppression → plan → log insert + applications update in one transaction) → returned row replaces the cached row (queue chips and panel change together; history refetches) → draft cleared → Save & next selects the person captured at click time. Failure: draft stays as typed, error shown in the panel (`role=alert`), nothing advances.

## Evidence

- Rollback proof: migration + 21 behavioural assertions run inside `begin … rollback` through bot-sql — all true (no-plan refused, outcome saved manual + owner default, stale save → 40001, callback needs due, waiting plan accepted, cron cannot clobber human plan, unattributed agent 42501, directory empty for agent / 14 for VA, SMS without consent suppressed, DNC stamps + unsubscribes + clears plan, contact after DNC refused, verified tz accepted / bogus refused, empty plan refused, ineligible owner refused, table CHECKs refuse unknown outcome and channel, manager allowed on team recruit and refused outside team, legacy rows untouched). Post-check: columns/functions absent from prod, `application_contact_log` still 36 rows.
- Reach (live, read-only): 832 live records → 696 worklist records (101 duplicates, 35 interview bookings/tests shown as excluded counts); 570 unlicensed and 570 older than 90 days included. Under RLS: VA sees 696/696; a sample manager sees 21 (team).
- Tests: `src/tests/lib/recruitingQueues.test.ts` (28: vocabulary == both migration CHECKs and the RPC, select ⊇ row contract, no provider ref in the RPC signature, every queue predicate, counts == click-filter, suppression, validation, error mapping, pagination 2,350 rows/3 pages + exact-multiple + error surfacing, mergeRow, draft store incl. throwing storage). Mutation: renaming one outcome in the UI list fails 5 tests. `src/tests/components/RecruitingWorklist.test.tsx` (3: counts + org/personal labelling, failed save keeps the note and the sessionStorage draft then the retry sends `p_expected_last_outcome_at` and the row leaves Uncontacted, opening a call link records nothing). Existing nav/recruiting tests green.
- Type-check 82 (baseline 82).

## What remains

- Apply the migration (command center), then regenerate `types.ts`, `scripts/data/*` catalogs (`rpc-args`, `rpc-status-literals` fail only because the three new RPCs are not in the catalogs yet).
- Ownership data decision for Sam: every live recruit starts **Unassigned** (honest — nobody was ever made accountable); bulk assignment UI is not built (owner is set per person or by recording an outcome).
- `application_contact_log` RLS read policy is `true` for every authenticated user (pre-existing leak of contact notes to all agents); left unchanged because BookOfBusiness and other readers depend on it — needs its own wave.
- `unified_assign_va` has no authorization check (pre-existing, not in scope).
- CallCenter / RecruiterDashboard / HiringPipeline still write contact timestamps directly with their own vocabularies; they should route through `record_recruiting_outcome` (not owned by this section).
- Interview booking from the panel (appointment_booked records the time as the dated next action only; Calendar owns `interview_events`). Inbound replies are not captured against `application_id`, so "Awaiting reply" is driven by the documented waiting reason, not by detected replies.
- Undo of a mistaken do-not-contact is admin-only via SQL.
