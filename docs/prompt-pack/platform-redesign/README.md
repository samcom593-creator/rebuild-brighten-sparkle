# APEX OS platform redesign, the program (2026-10-28)

Sam's brief, in his words: *every single layer needs to be redone to the core. Leave no stone unturned.
Everything looks different, everything is functional, everything is less clutter. Visually pleasing on a
phone and on a desktop, in every format. Functionality, simplicity, easy function. Somebody who is old and
has no idea about technology can use everything. It should look like a multi-billion-dollar platform. I am
pushing for a higher rate of actual hires and fixing the re-engagement funnels.*

This folder is the execution program for that brief. It replaces the one-page
[`../GROW_REDESIGN.md`](../GROW_REDESIGN.md) (done, PR #46) with one prompt per layer of the platform,
one shared contract every screen must meet, and one review gate (the four-lens council) that decides when
a screen is finished. It is written to be pasted into Claude Code in VS Code, one file per session.

## How to run it

1. **Paste `00-MASTER.md` first, once per session.** It sets the rules, the screen contract, the council,
   and the traffic rules for working beside the other projects in flight. It ends by telling Claude which
   area file to open next.
2. **Then paste exactly one area file** (`01` to `10`). One area per branch, per PR, per council pass.
   Never two areas in one PR: Sam reviews on his phone and deploys by saying "deploy".
3. **After every area, paste `11-COUNCIL-REVIEW.md`** in a fresh session (a reviewer that did not write the
   code). Findings go back into the area branch until the council passes.
4. **When an area needs analysis before implementation** (metric logic, permission logic, data model,
   root cause, re-engagement rules), run the matching prompt in `12-ANALYSIS-SESSIONS.md` in a separate,
   read-only Claude session and implement from its written decision. Sam's instruction of 2026-10-28:
   everything runs on Claude, Codex is not used; the older Claude/Codex split in `AGENTS.md` is superseded
   for this program.
5. `ROUTE_BOARD.md` is the inventory every area prompt reads from: every route, its page file, who sees it,
   which pattern it follows today, and a clutter signal. Update the Pattern column as areas ship.

## Order, and why

The order follows money and hires, not the sidebar. A hire compounds; a deal does not (the sidebar's own
rule). The first four areas are the hiring funnel end to end, because that is the business goal.

| # | Area | File | Why in this position |
|---|---|---|---|
| 1 | Shell: sidebar, phone nav, top bar, headers, role homes dispatch | `01-SHELL-NAVIGATION.md` | Every other area renders inside it. One shell, measured first, so later areas do not each fix the frame. |
| 2 | Public funnel: landing, apply, hire link, get licensed, install, applicant home | `02-PUBLIC-APPLICANT-FUNNEL.md` | The top of the hiring funnel. Every leak here is a hire that never reaches the Call list. |
| 3 | Grow follow-through: funnel scoreboard, re-engagement engine, Calendar and interviews | `03-GROW-FUNNEL-AND-REENGAGEMENT.md` | Builds on PR #46. Turns the Call list into a measured funnel and wires every re-engagement mechanism to one visible rule. |
| 4 | Home, per role | `04-HOME.md` | The first screen after login must point at the one thing to do today, for every role. |
| 5 | Sell: My Pipeline, Call Center, Calendar for producers | `05-SELL.md` | Money today. Same contract as the Call list. |
| 6 | My Business: Book, Easy Resells, Book Flips, Ayro Book, Sold Calls, Commissions, Retention | `06-MY-BUSINESS.md` | Renewals and re-sells; the second re-engagement funnel (clients, not recruits). |
| 7 | Team and Learn: Leaderboard, My Team, Contracting review, Field Course, Training Home, Call Lab | `07-TEAM-AND-LEARN.md` | Standing and skill; the pages a new hire opens in week one. |
| 8 | Owner: Launch Board, Reports, Finances, Contracting, Import, Social Command, Instagram | `08-OWNER.md` | Sam's own tools. Last among the operating screens because only one person sees them. |
| 9 | Settings, profile, notifications, support desk, install | `09-SETTINGS-AND-ACCOUNT.md` | Low traffic, but every clutter rule still applies. |
| 10 | Phone pass and theme pass across everything | `10-PHONE-AND-THEME-PASS.md` | A final sweep at 390px, dark and light, after the areas land, because the areas land over days and the phone is where Sam runs the business. |

## What "done" means for the whole program

- Every route in `ROUTE_BOARD.md` is marked `NEW` (meets the screen contract) or `REDIRECT`.
- Every area has a merged PR with the council's verdict table in its body and before/after screenshots
  at 390 and 1440, dark and light.
- The hiring-funnel scoreboard (Applied, Reached, Booked, Showed, Contracted, First deal) is live on the
  Call list and on Sam's Home, each number opens its list, and the definitions are unit-tested.
- Every re-engagement mechanism (recruit and client) has one rule, one visible result, and no path that can
  message a departed, banned, do-not-contact or suppressed person.
- `npm test` and `npm run verify:core:all` are green on `main`; the TypeScript error count is at or below
  the baseline the program started with (75 on 2026-10-28; `npm run typecheck:count`).

## Files in this folder

| File | What it is |
|---|---|
| `00-MASTER.md` | The rules. Paste first. |
| `ROUTE_BOARD.md` | Every route, page file, gate, pattern, clutter signal. The inventory. |
| `01-SHELL-NAVIGATION.md` … `10-PHONE-AND-THEME-PASS.md` | One execution prompt per area. |
| `11-COUNCIL-REVIEW.md` | The four-lens review protocol and verdict format. |
| `12-ANALYSIS-SESSIONS.md` | Scoped analysis prompts for a separate Claude session (one system, one bug or one decision each). |

Older prompts in `../` (`MASTER_APEX_WEBSITE_PERFECTION.md` from August, `APEX_FUNCTION_PERFECTION_EXECUTION.md`,
`UX_NAV_PERFORMANCE.md`, `RECRUITING_AND_LICENSING.md`, `METRICS_AND_LEADERBOARDS.md`) stay as references
for backend and metric truth. Where they disagree with this folder on screens and navigation, this folder
wins; where they speak about data truth (`deals.posted_at`, Phoenix and Chicago day rules, no fallback
metrics), they still apply.
