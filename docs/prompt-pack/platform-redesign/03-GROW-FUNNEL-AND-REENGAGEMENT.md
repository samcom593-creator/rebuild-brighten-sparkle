# 03 · Grow follow-through: the hiring funnel and the re-engagement engine

Paste after `00-MASTER.md`. Branch `redesign/grow-funnel`. Worktree `../rbs-grow-funnel`. Start after
PR #46 (`claude/grow-redesign-prompt`) has merged; if Sam has not said "deploy" yet, branch from that
branch instead of `main` and say so in the PR.

## Goal

More actual hires. PR #46 made the daily loop usable (call, record, next step, save). This area makes the
loop measured and self-feeding: a funnel strip that tells the truth about Applied → Reached → Booked →
Showed → Contracted → First deal, and one re-engagement engine with one rule table, so nobody who applied,
booked, no-showed or stalled is forgotten, and no one is touched twice in a day or after they said stop.

## Read first

- `docs/audits/platform-redesign-2026-10/funnel-and-reengagement-map.md`: the read-only map of what the
  code records at each funnel stage, every re-engagement mechanism with its trigger, audience, receipt and
  guardrails, eighteen gaps, and the 25-file map. It is the list of stones for this area. The gaps that
  change what you build: no-show follow-ups never reach the Call list (C1); "Hired" from Follow-ups or
  Calendar creates no agent (C2); four definitions of "booked" (C3); "today" is Phoenix, Chicago or UTC
  depending on the surface (C4); the same person can be reached twice in a day because the unused 24h guard
  `applicant_contacted_recently()` has no caller (C5); bots skip consent and DNC that humans must respect
  (C6, C7); nine edge functions and eight pages still read `contacted_at` (C9); bulk and bot writers of
  `last_contacted_at` move people out of "Never contacted" with no outcome (C10); seven stages have no
  automated re-engagement (C13); migrations still schedule senders whose headers say nothing calls them
  (C14); the departed manager can be CC'd on applicant follow-ups through `invited_by_manager_id` (C15);
  unknown rendered as 0 in six places (C16).
- Run analyses **H1 (funnel definitions)** and **H2 (re-engagement rules, recruits)** from
  `12-ANALYSIS-SESSIONS.md` next, in separate sessions, starting from that map, and save both answers
  beside it. Nothing in "Required work" steps 1 and 3 is implemented before those answers exist.
- `docs/prompt-pack/GROW_REDESIGN.md` and the PR #46 files it lists (the contract this area extends).
- Audits: `docs/audits/apex-os-redesign-2026-10-05/04-pipeline-contact-workspace.md`,
  `05-recruit-stages-nhlb-onboarding.md`, `06-calendar-interviews.md`, `07-invitations-comp-links.md`,
  `impl-pipeline-worklist.md`, `impl-recruit-stages-nhlb.md`, `impl-calendar-interviews.md`.
- `docs/recruiting-workspace.md` (the `hh_*` interview contract, authorization per role, Google Voice
  links) and `docs/operations-runbook.md` (crons).
- Pages and components: `src/components/pipeline/worklist/*` and `src/lib/recruitingQueues.ts`
  (`computeScoreboard`, the truth rules), `src/lib/worklistLayout.ts` (coverage), `src/pages/RecruitingPipeline.tsx`,
  `src/pages/RecruitPipeline.tsx` (New hires), `src/pages/Interviews.tsx` (`/dashboard/recruiting/interviews`,
  `promoteApplicationToAgent` from `src/lib/hireToOnboarding`), `src/pages/InterviewRecovery.tsx`
  (`/dashboard/recruiting/follow-ups`: reads `v_interview_pipeline`, writes `cc_dispose_interview`; MP-264's
  reason for existing is in its header), `src/pages/OnboardingLadder.tsx` (`/dashboard/onboarding-ladder`:
  `onboarding_exception_facts()`, rules in `src/lib/onboardingExceptions.ts`, calls in
  `src/lib/onboardingCalls.ts`), `src/components/recruiting/NoHireLeftBehindPanel.tsx`,
  `src/components/recruiting/RecruitingCommandHero.tsx`, `src/pages/CalendarPage.tsx`,
  `src/pages/admin/InviteLinks.tsx` with `src/lib/inviteContractingInfo.ts`.
- Edge functions: `supabase/functions/instagram-dm-nudge` (nudge1/nudge2 inside Meta's window from
  `fn_ig_nudge_candidates`; abandoned-partial recovery email via `sendEmail`, stamped only on a Resend id),
  `send-instagram-dm`, `_shared/email.ts` (suppression and routability gate), `consume-invite-token`,
  `calendly-webhook`. Guards: `check:resend-gate`, `check:email-unsub-suppression`,
  `check:discarded-email-send`, `check:sms-outcome-contract`, `check:recruiting-contact-actions`,
  `check:contact-actions`, `check:business-day-bounds`, `check:function-contracts`, `check:rpc-args`,
  `check:public-allowlist-parity`, `check:cron-verdict-states`.
- Tests: `src/tests/components/RecruitingWorklist*.test.tsx`, `src/tests/lib/recruitingQueues.test.ts`,
  `worklistLayout.test.ts`, `inviteContractingInfo.test.ts`, `hiringLifecycleContract.test.ts`,
  `invitationLifecycleContract.test.ts`, `hireMonitoringRecruitingIncome` source tests, anything importing
  `onboardingExceptions`.

## Scope

The Grow pages above, new pure modules `src/lib/funnel/` and `src/lib/reengagement/`, their tests, the
Calendar's interview rows, `src/App.tsx` only for redirects this area proves safe, `ROUTE_BOARD.md`, the
shipped log. Edge-function and SQL changes only where the H1/H2 decisions require them, additive, mirrored
into `supabase/migrations/`, behind the existing settings flags, and never sending from tests or the
harness (`?dry_run=1` exists on `instagram-dm-nudge`; use it).

## Guardrails

- Every truth rule in `recruitingQueues.ts` and `00-MASTER.md` section 4. A dial-link tap is not a touch.
- The `hh_*` tables remain the interview contract; outcomes go through the versioned actions with their
  receipts; no second interview table.
- One person, one touch per day across every channel. Stop conditions always win: `do_not_contact_at`,
  the suppression list, missing consent for the channel, hired, departed, duplicate, terminated. KJ Vaughn's
  record is excluded by rule, with a test.
- Automated messages stay in Sam's voice and inside the platform's windows (Meta's 24h window for DMs).
  A refusal is not a send; only a provider id stamps a receipt.
- The funnel never shows a zero for unknown. A stage without an authoritative source reads "—" with the
  reason until H1 gives it one.

## Required work

1. **Funnel strip.** From H1, a pure module `src/lib/funnel/hiringFunnel.ts`: stage predicates, a window
   (this week, this month, last 90 days, Phoenix days), counts, conversion between adjacent stages, median
   days per step, and the row filter each stage opens. Render it on the Call list under "Today's numbers"
   as "The funnel" with a window control in `viewControls`, each stage a button that filters the list to
   those people, "—" and a reason when the stage's source is unavailable. Unit-test every predicate,
   disjointness where H1 says stages are exclusive, and the unknown case. Area 04 reuses the module on Sam's
   Home.
2. **Showed and No show in the loop.** When a person has an interview row, the panel's "What happened?"
   offers Showed and No show; both write through `cc_dispose_interview` with its receipt and set the next
   step (Showed → contracting hand-off; No show → the re-engagement rule's next touch). The Calendar's
   interview rows show the same status pill and link to the person.
2b. **Close the dead ends the map found before adding anything.** (a) No-show and missed-interview people
   enter the Call list: the worklist reads `interview_events.followup_due_at` and the hh `no_show` stage into
   the due and overdue queues (C1). (b) "Hired" from the panel, Follow-ups or Calendar goes through the one
   canonical hire path (`src/lib/hireToOnboarding.ts` → `add-agent`), never a status flip alone (C2);
   `cc_dispose_interview('hired')` either calls it or is removed from the UI. (c) One definition of "booked"
   per H1, and recording `appointment_booked` in the panel creates or links the interview row it claims (C3).
   (d) One "today" for recruiting surfaces: Phoenix, including `InterviewRecovery`'s buckets while they still
   render (C4). (e) Every writer of `last_contacted_at` that is not a recorded outcome (bulk "mark contacted",
   self check-in, `cc_dispose_interview`) stops moving people out of "Never contacted", or records an outcome
   (C10). (f) The departed-manager CC leak in `send-followup-emails` is closed with a status check and a test
   (C15); this one is small and ships first.
3. **One re-engagement engine.** From H2, `src/lib/reengagement/rules.ts` holds the rule table as data
   (stage × days silent → channel, message family, cap per week, quiet hours in the person's zone, stop
   conditions) and `nextTouch(person, now)` returns the one due touch or none, with the reason. The Call
   list's "Call today" includes rule-driven touches with a reason pill ("Re-engage · 7 days silent");
   `instagram-dm-nudge` and the recovery email read the same table (an additive change: import the rule,
   keep the SQL candidates as the audience, add the dedupe check against the day's other touches). Every
   automated touch writes the receipt the person's History already reads. Tests: one person never gets two
   touches in a day; every stop condition; quiet hours; the departed record.
4. **Follow-ups and Interviews pages.** Prove parity first: for one week the Call list's "No show" and
   "Booked" lists must equal `v_interview_pipeline`'s buckets (a test with synthetic rows, and a measured
   comparison noted in the PR). Then the two pages become redirects into the Call list queues with the query
   preserved (`LegacyWorkspaceRedirect`), their writes already live in the panel. Breadcrumbs and
   `check:sidebar-routes` inputs updated.
4b. **The long tail: thirty screens become one Call list.** `ROUTE_BOARD.md` group 3 lists twenty-two
   recruiting pages with no nav home, plus the recruit dialer filed under Sell (`/dashboard/call-center`,
   `src/pages/CallCenter.tsx`, eyebrow "Recruiting · Dial session"): Stale recovery, Aged leads, Hiring
   pipeline board, Referral pipeline, My referrals, My applicants, Add referral, Licensed inbox, License
   push (`/admin/recovery-queue`), Unlicensed queue, Getting started, two Pre-licensing pages, Licensing
   tracker, the recruit "My Pipeline" (`AgentPipeline.tsx`), Recruiter HQ, Seminar control, two Old
   applicants pages, Interviews, Interview recovery, the onboarding queue. Every one is a place a recruit can
   sit unseen. For each: (a) name the queue, filter or fold of the Call list, New hires or Calendar that
   holds the same people (a `recruitingQueues.ts` predicate, unit-tested, with H1's stage definitions);
   (b) prove parity on synthetic rows and once against the mirror (counts equal); (c) move any write the
   page performs into the person panel (promote to agent, assign to a VA, dispose an interview) with its
   receipt; (d) redirect the route with its query preserved and update the breadcrumb map. The Call Center's
   dial-session mode (sources, cursors, coverage, dispositions) becomes the Call list's "Start calling"
   session, keeping its guards (`check:contact-actions`, `check:sms-outcome-contract`); until that lands,
   Call Center moves from Sell to Grow in the sidebar (area 01 has the label rule). Pages the analysis says
   are dead (the retired seminar, the old-applicants pair) redirect without a replacement queue, and the PR
   says so. Keep the audit's rule: nothing deleted, only moved; the before→after table lists all thirty.
5. **New hires and the onboarding queue.** New hires' "Stuck" tiles name the real block (contracting,
   licensing, training, Slack, onboarding call) from `onboarding_exception_facts()`; each row's status pill is
   that block with its wait; the resolving button is the row's one action. The full queue page keeps its
   tracks; the NHLB summary row on the Call list already links to it.
6. **Invite an agent.** If H6's decision is ready, move the contracting fields to their proper columns with
   the backfill from the encoded notes; otherwise keep the note encoding and the copy card as they are.
7. **Apply → Call list hand-off.** A synthetic application created through the apply function must appear
   in the Call list's "New" within one reload, owned by the rule the routing uses today, with its source
   (`/r/<slug>`, Instagram, landing) visible in the facts line. Test it against the mock; measure it once
   against the live mirror with bot-sql and note the result.
8. **Measure.** Baseline from H1 (last 90 days): hires per week, reach rate, show rate, median days per
   step, touches per day by channel. The PR body carries the baseline and the definitions; the same
   numbers appear on the strip so Sam can watch them move.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- `instagram-dm-nudge?dry_run=1` against the mirror shows candidates and sends nothing; the dedupe rule is
  visible in its receipts.
- Harness screenshots at 390 and 1440, dark and light, as admin, manager, recruiter and VA: the Call list
  with the funnel strip (full, empty, one stage unavailable), the panel with Showed/No show, the Calendar
  rows, New hires with the block pills, the redirected routes landing on the right queue.
- Council passes; the Owner lens checks every stage count against its list and against H1's measured
  numbers for the same window.

## Done means

- [ ] The funnel strip is live on the Call list, every stage opens its list, every predicate is tested,
      unknown reads "—".
- [ ] Showed and No show are recorded from the panel with receipts; the Calendar agrees.
- [ ] One rule table drives the Call list's re-engagement items and the automated channels; one touch per
      person per day; every stop condition tested; the departed record excluded by test.
- [ ] Follow-ups and Interviews redirect into the Call list after proven parity.
- [ ] New hires names the real block per hire.
- [ ] Baseline and definitions in the PR; H1 and H2 answers saved under `docs/audits/platform-redesign-2026-10/`.
- [ ] Shipped-log entry; `SHIPPED_TOTAL` matches.

## Acceptance output

1. The funnel definitions as implemented, with the baseline numbers.  2. The rule table as implemented.
3. Files changed.  4. Verification performed, including the dry run.  5. Council verdict.  6. Screenshots.
7. Anything that needs a migration or a cron change and the exact SQL proposed.
