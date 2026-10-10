# Receipt: the manual contracting portal tracker, hiring stages, work days and attendance (2026-10-09)

Commits on `main`: `7bf7eff3` (A, the review), `53af140a` (B, the old pipeline retired), `14c427dd` (C, stages, work days, attendance).

## What changed, by route

| Route | Now |
|---|---|
| `/dashboard/team` | One roster, three views. **Contracting** (default): Agent name + email, Combine ○, AFLAC ○, GTO ○, Ethos ○, Placement level, Details. **Overview**: stage badge + selector, work-day summary + editor, access, contracting standing. **Attendance**: today in America/Phoenix, date selector, expected/present/absent/excused/unmarked counts, one-tap marks. Production, Call list and Recruiting pipeline are under *More*. |
| `/dashboard/contracting` | The same review (same component, same records) as the front page; "Earlier records" holds the older tabs. A generic contracting link to copy; staff type no name or email. |
| `/dashboard/contracting-profile` | Signed-in "Complete your contracting profile": NPN number, first name, last name, email, resident state; prefilled; writes only the caller's own profile. |
| `/start-contracting` | Redirects to the page above. The public intake page and its success screen are removed. |
| Home, My Day | One neutral line: "N agents still have a carrier circle to review." The Aflac daily check-off banner is gone. |
| Sidebar | One **Contracting** entry (was four). |

## How to start reviewing

Open My Team. It opens on *Needs review*. Tap a circle after you have checked that carrier's portal yourself; it saves at once with Undo and records who and when. *Details* holds the five profile fields, the four carriers (AFLAC has *Open portal*; opening a portal marks nothing), the placement level and the history. *Save & Next* / *Next unreviewed* moves on; the person you are working on stays on screen until you move.

## What was retired (nothing deleted)

- Triggers `trg_ensure_contracting_legs`, `trg_queue_contracting_slack`, `trg_queue_contracting_slack_npn_added` on `contracting_intakes`: **disabled**. Cron `aflac-checkoff-reminder`: **paused**. Each is registered in `contracting_legacy_retirements` with its prior state and a one-line way back; `v_contracting_legacy_retired` is one row that reads false unless all four are still off. apex-doctor Check #98 goes red if any comes back.
- Measured first: nothing was waiting to send (55/55 private-channel posts and 33/33 Slack events delivered; 36 sheet rows parked for a human; no stored template or queued message carried the old instructions).
- Add Agent, the hire link and Quick Edit no longer queue a contracting intake; the welcome, licensing and Telegram messages carry the new wording from `_shared/contracting-profile.ts`.
- My Team: Priority 1 panel, day-3/4/5 red flags, follow-up plan, milestone checklist, checkoff history and badges removed. The old `agent_contract_checkoffs` rows stay as history; every active agent started Unmarked on all four circles.

## Definitions resolved from evidence (confirm or correct)

- **MPN = the existing NPN** (`agents.nipr_number`). One identifier; text preserved, leading zeros kept; 5 to 10 digits. An NPN already on another active profile is surfaced as a conflict, never merged.
- **Placement level = the existing agent-wide contract %** (`agent_contract_levels`, via `set_agent_contract_pct`, with its admin/downline rules). No per-carrier values exist for these four carriers. Unknown shows *Not set*, never 0.
- **Carriers**: AFLAC and Ethos map to catalog entries; **Combine and GTO have no catalog entry** and are stored unmapped on purpose (candidates: "Combined", "Guarantee Trust Life"). Only AFLAC has a verified portal address.
- **Over $5K**: written and tested as strictly over $5,000 (`src/lib/overFiveK.ts`, `OverFiveKBadge`), **inactive** until the metric, period, scope and reversal handling are confirmed. Nothing renders meanwhile.
- **VA policy**: VAs and VA managers read everything; only admins and managers confirm carriers, set levels, stages, schedules and attendance.

## Hiring, access, work days, stages, attendance

- One agent profile from hire onward; a new agent starts in **Online training** (database trigger, cannot fail the insert). 20 people with unambiguous history were placed once; **39 show "Stage not set"** for staff to place. Nobody was guessed.
- Access on the Overview: signed in before / invitation pending / accepted but no sign-in / expired / revoked / no login yet, read from the existing invitation records. Invitations are sent only through the existing invite flow; none were sent here.
- Work days: five Mon–Fri checkboxes, summary "Mon, Wed, Fri · 3 days/week"; *Schedule not set* is not *No scheduled days*; effective today or on a later date; never rewrites a past day; a plan, not attendance.
- Stages: exactly "Online training", "Training", "Released in field"; badge beside the name; selector saves at once with Undo and audit; backward corrections allowed; onboarding, comp, licensing and contracting untouched by a stage change.
- Attendance: expected = commitment in force that day AND started on or before it; Present/Absent/Excused one tap with Undo; corrections keep history; each mark snapshots the stage and schedule of that moment; bulk only from an explicit selection with a preview and never overwrites a mark; weekends expect nobody; no automatic penalty or message.

## Verification

- SQL, rolled back, against live: contract-review 73/73 (14 mutations caught); legacy-contracting-retired 13/13 (6 caught); team-stage-attendance 55/55 (16 caught, after fixing a harness where the re-run markers silently repaired a mutated function).
- vitest: 139 new tests across the three stages; 33 + 23 front-end mutations caught, 3 more after holding the refetch that was masking an explicit restore. Full suite green except another worker's unfinished Recovery Command test.
- `verify:core` full roster green locally; tsc 75 errors (baseline 82).
- Doctor Check #98 proven on 8 branches + 3 mutations.
- No real email, invitation, portal submission or real-agent completion change was made. Synthetic records only (`ZZ SYN …`), all rolled back.

## Deployment

`14c427dd`: Deploy Supabase, post-deploy route smoke and Lighthouse all green. *Verify core checks* finished 111 of 113: the two failures (`check:phone-gateway-source`, `check:ilike-user-input`) are on `supabase/functions/check-email-status` from the other worker's `8b0d00bb`, not in these commits. The earlier `53af140a` deploy step failed only because the two Stage C migrations were applied live before their files were pushed; this commit carries them and the deploy passed.

**Live check (production, signed in as the admin, 1500 px and 390 px):** `/dashboard/team` opens on Contracting with 58 of 59 needing review, stage badges beside names, levels shown or *Not set*; Overview and Attendance render (attendance reads "59 with no schedule set", which is true: nobody has a commitment yet); `/dashboard/contracting` shows the same review plus the generic link; `/dashboard/contracting-profile` is prefilled. No horizontal scroll at 390 px; no console errors. Screenshots were taken at run time (`/tmp/see_*.png`) and not committed.

## Remaining blocker / open

- The other worker's `8b0d00bb` (PL-WIB-PHONE-LOOKUP-FORMAT) fails `check:ilike-user-input` and `check:phone-gateway-source` on `check-email-status`; that keeps the *Verify core checks* run red until they fix it.
- Combine / GTO catalog mapping, the $5K definition and MPN-vs-NPN wording await Sam's word (one bundled question in the chat).
- Add Agent still uses the existing modal (one entry point); it was not rewritten into a shorter form in this pass.

## Follow-up the same evening: pages head to toe, people search, Book Flips by state (`3a342161`)

Sam's three asks after the tracker shipped: search any agent or applicant from any piece of a name; give Book Flips real targeting (pick Arizona and see Arizona); and rebuild every contracting page, not just the review.

**People search (⌘K).** One RPC, `search_people(p_q, p_limit)`: tokens must all match somewhere in name, email, phone digits or agent code; LIKE metacharacters are escaped (`fn_like_escape`); prefix matches rank first. Admins, VAs, VA managers and recruiters see everyone; a manager sees their reach (`apex_can_read_agent` plus the application manager columns); anyone else gets nothing. The palette groups "People on the team" and "Applicants" and opens the profile or the applicant queue. Live check: typing "johnson alonzo" returns Alonzo Johnson (upline KJ Vaughn, AJOHNSON01). Proof `scripts/tests/search-people.sql` 10/10 against live. The RPC returns jsonb, so it was added to the RPC column vocabulary by `scripts/refresh-rpc-column-vocabulary.sh` (only `search_people` and `fn_like_escape` changed).

**Contracting pages.** `/dashboard/contracting` is four tabs: Review | Carriers | Writing numbers | Requests (history). The old process's pages and modules are deleted from the repository (Carrier Cases, Contracts board, Ethos health, audit panel, Aflac onboarding, operations digest, ready-to-write card, spreadsheet export, their libraries and tests: 3,926 lines). Retired routes redirect: `/contracting/cases` and `/ethos` → My Team › Contracting; `/ops`, `/audit`, `/aflac` → `/dashboard/contracting`; `/contracts` → Writing numbers. The agent drawer and producer profile show "N of 4 carriers confirmed · Placement level X" with a link that opens the review on that person (`?review=<agent id>`); Home's Contracting panel and the admin command tile read the same review counts (needs review / partially marked / all four). The Carriers tab is a two-column directory (Carrier | Website) with no spreadsheet or Discord copy; Writing numbers shows the producer link plainly; Requests (history) keeps every intake as history, including the 13 rows whose source reads "ethos sheet reconcile 20260825" (history, not page copy).

**Book Flips.** `?state=AZ` shows only that state's opportunities; chips show the top states with counts taken over the other filters; a state is the client's state on file (1.4% of rows) or, failing that, the phone's area code, and the status line says "likely, not certain"; Unknown is its own bucket. The book bucket also lives in the URL (`?book=all`) and the page opens on Departed writers only when the book has any; otherwise on All, so it never opens on an empty list (the live Combined book had opened on "0 opportunities").

**Verification.** tsc 75 (baseline 82); touched tests 117/117 then full vitest 1,671 pass (one failure is a concurrent worker's untracked Recovery test); verify roster green locally except the two `check-email-status` guards already red on main from `8b0d00bb`. CI on `3a342161`: Deploy Supabase, route smoke, Lighthouse green. Live, signed in as the admin at 1400 px: four tabs render, both redirects land, Home shows the Contracting panel, the palette finds a partial name, `/dashboard/books?state=AZ` filters and says so; no console errors, no horizontal scroll.

**Still open.** Add Agent is unchanged (one entry point); the bundled definitions question above (MPN, level scope, Combine/GTO mapping, $5K, VA writes) still waits on Sam.
