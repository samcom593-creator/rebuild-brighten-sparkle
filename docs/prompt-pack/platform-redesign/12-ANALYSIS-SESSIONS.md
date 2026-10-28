# 12 · Analysis sessions: the questions to answer on Claude before implementing

Sam, 2026-10-28: *keep everything on Claude; do not use Codex.* So analysis and implementation both run
on Claude, in **separate sessions**: an analysis session is read-only, evidence-first, and ends in a written
decision; an implementation session starts from that decision. Keeping them apart is what stops an
implementer from confirming its own guess.

Each prompt below is scoped to one system, one bug or one decision. Paste the preamble, then the prompt,
into a fresh Claude Code session at the repository root. Save the answer under
`docs/audits/platform-redesign-2026-10/<Hn>-<topic>.md` and link it from the area PR.

Preamble for every analysis session:

> You are in analysis mode: read, query, measure, decide. Do not edit, stage or commit anything.
> Repository `samcom593-creator/rebuild-brighten-sparkle`, Supabase project `xrzweoneiieddzxogewk` (the
> current one). Read `AGENTS.md` first. Measure through the bot-sql edge function (token at
> `~/.config/apex-creds/bot-sql.token` on Sam's machine) or the Supabase MCP `execute_sql`, read-only
> selects only. Answer with evidence: file:line, view and function names, measured counts with the query
> that produced them. Where you cannot measure, write **unmeasured**, never a guess. Facts that hold:
> `deals.posted_at` is the canonical deal date; recruiting "today" is the America/Phoenix business day;
> `contacted_at` is never read; KJ Vaughn's agent `431dff0d-…` and auth `75b17131-…` must never receive
> routing, alerts or messages. End with one decision Claude can implement, its trade-off, and the tests that
> would prove it.

## H1 · The hiring-funnel definitions (before area 03)

> Start from `docs/audits/platform-redesign-2026-10/funnel-and-reengagement-map.md` (section A lists where
> each stage is recorded today and the four competing definitions of "booked"; section C the gaps).
> Define, as SQL-level rules that become pure TypeScript predicates and one view, each stage of the hiring
> funnel and the conversion between stages: Applied (`applications.created_at`, `record_type =
> 'application'`, not duplicate), Reached (first `last_contact_outcome_at` with a human outcome), Booked
> (`appointment_booked` or an interview row: say which wins when they disagree), Showed (which table proves
> attendance), Contracted (`applications.closed_at`? a contracting receipt? an `agents` row?), First deal
> (first `deals.posted_at` for the promoted agent), Active (the registry's `active_producers` rule). For each
> stage: the authoritative column or view, the Phoenix-day boundary, how a departed or terminated person is
> excluded, and the median days from the previous stage over the last 90 days (measured). State where two
> sources disagree today and which one wins. Output a table plus the exact predicate per stage.

## H2 · Re-engagement rules, recruits (before area 03)

> Start from `docs/audits/platform-redesign-2026-10/funnel-and-reengagement-map.md` section B (sixteen
> mechanisms with trigger, audience, receipt, guardrails) and section C (the conflicts: C5, C6, C7, C13,
> C14, C15). Measure what it could not: which crons are live, how many people each mechanism touched in the
> last 30 days, how many were touched twice in a day. Then audit every mechanism that re-contacts a recruit: `supabase/functions/instagram-dm-nudge` with
> `fn_ig_nudge_candidates` and `fn_ig_abandoned_partials`, the partial-application recovery email, the
> worklist's due and overdue queues, interview no-show follow-ups, the No Hire Left Behind queue, any cron
> that sends SMS or email to applicants. For each: trigger, audience predicate, channel, dedupe and window
> rules, what it stamps on success, and where its result is visible. Then propose ONE unified rule table
> (stage × days silent → channel, message family, cap, quiet hours, stop conditions: do-not-contact,
> suppression list, consent flags, hired, departed, duplicate). Name every place two mechanisms can reach
> the same person in the same day. Output the rule table and the conflicts, with file:line.

## H3 · Re-engagement rules, clients (before area 06)

> Same audit for the client side: Retention (`/dashboard/retention`), Easy Resells, Book Flips, lapse and
> policy-status signals in `v_agentlink_book_truth` and the production ledger, any cron or Discord post that
> nudges an agent about a client. Define the one rule table for "who should an agent call today about an
> existing client", with the authoritative column per signal and the exclusions (terminated agents,
> deceased or cancelled policies, do-not-call). Output the table and the gaps.

## H4 · Visibility and permission map (before areas 01, 04, 07)

> Produce the matrix of account mode × route × action for every route in
> `docs/prompt-pack/platform-redesign/ROUTE_BOARD.md`: who can open it (App.tsx guard), who sees it in the
> sidebar and phone nav (`agentCloudNavigation.ts` modes, `MobileBottomNav.tsx`), who can perform each
> write on it (RLS policy or RPC check, by name). Flag every mismatch: a link shown to a role the guard
> bounces; a guard that admits a role the RLS then denies; a write the UI offers that the server refuses;
> any path by which a VA or recruiter reaches production money. Output the matrix and the mismatches.

## H5 · Home per role: what is the one thing to do today? (before area 04)

> For each role (admin/Sam, manager, agency owner, agent, recruiter, VA, VA manager, applicant), using the
> data the current home components already load (`AgentCloudHome`, `ManagerCommandView`,
> `AgencyOwnerHome`, `AgentCommandDashboard`, `RecruiterHome`, `VaOpsCommandCenter`, the applicant home),
> rank the signals by business impact and name the single next action and the three or four numbers that
> belong above the fold. State which existing RPC or view gives each number, its freshness, and its day
> boundary. Output one table per role: section, number or action, source, freshness, keep/move/drop with the
> reason.

## H6 · Contracting fields on invitations (decision, before area 03 or 08)

> PR #46 stores the inviter's first name, last name, phone and NPN inside the invitation's internal note
> (`Contracting: First=…; Last=…; Phone=…; NPN=…`) because `invite_tokens` has no NPN or split-name columns
> and `list_invitations()` returns no phone. Decide the proper home: additive columns on `invite_tokens` plus
> `list_invitations()` changes, or a `contracting_profiles` row keyed by invitation. Give the migration shape,
> the RPC changes, the backfill from existing notes, RLS, and the rollback. One decision, with the trade-off.

## H7 · Root cause (any area, any bug)

> Bug: `<one sentence>`. Screen: `<route>`. Steps: `<numbered>`. Expected / actual: `<…>`. Evidence gathered
> so far: `<file:line, test output>`. Find the root cause in the code or data, prove it (a query or a trace),
> and state the smallest correct fix and the test that would have caught it. If two causes are plausible,
> say how to tell them apart before anyone edits.

## H8 · Metric parity (after areas 04, 05, 06)

> For every number on Home, the Call list scoreboard, Leaderboard, Numbers, Book of Business and Reports,
> list the source (RPC, view, helper), the window and day boundary, and whether two surfaces can show
> different values for the same window today. Measure three windows (today, this week, this month, Chicago)
> and report the disagreements with the reason. Output: the parity table and the fixes, in order of how
> visible the disagreement is.

## H9 · Public funnel leaks (before area 02)

> Trace the public path end to end: landing (`/`, `/r/<slug>`), apply (`Apply.tsx`, partial saves,
> `partial_applications`), confirmation and the minted login, `/get-licensed`, `/install`, the hire link
> (`HireLink.tsx`, `consume-invite-token`), the applicant home. For each step: where a person can leave
> without the next step being obvious, what is recorded when they do, which re-engagement mechanism picks
> them up, and which mechanism should. Measure the last 90 days: started, submitted, confirmed, licensed,
> hired. Output the leak list ranked by lost hires per month, with the fix per leak.

## H10 · Scale and safety of the daily loop (after area 03)

> Review `useRecruitingWorklist` (full-table pages plus three head counts on every load), the realtime
> invalidations, and the scoreboard computations for 5× the current row count and ten concurrent callers.
> Name the first thing that breaks, the query or index that fixes it, and whether server-side counts
> should replace client-side ones. Output the decision with measured query plans.
