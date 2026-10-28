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

- Run analyses **H1 (funnel definitions)** and **H2 (re-engagement rules, recruits)** from
  `12-ANALYSIS-SESSIONS.md` first, in separate sessions, and save both answers. Nothing in "Required work"
  steps 1 and 3 is implemented before those answers exist.
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
