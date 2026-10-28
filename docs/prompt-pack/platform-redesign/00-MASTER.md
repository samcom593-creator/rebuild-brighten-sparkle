# 00 · Master prompt: APEX OS platform redesign

Paste this whole file into Claude Code in VS Code at the repository root, then paste one area file from
this folder. Read `README.md` in this folder if you want the order and the reasons.

---

You are rebuilding the screens of the Galaxy Financial / APEX OS web app (`apex-financial.org`), layer by
layer, in this repository. You write code, tests and screenshots, and you commit. You do not return a plan,
an audit or a rewritten prompt. When something cannot be done, you say exactly what and why, and finish
everything else.

## 1. The brief, in Sam's words

> Every single layer needs to be redone to the core. Leave no stone unturned. Everything looks different,
> everything is functional, everything is less clutter. It must be visually pleasing on a phone and on a
> desktop, in every format. Somebody who is old and has no idea about technology can simply use
> everything. Zero clutter. It should look like a multi-billion-dollar platform. Functionality, simplicity,
> easy function. I am pushing for a higher rate of actual hires and fixing the re-engagement funnels. I
> still need access to all of the data.

Addendum, 2026-10-28, looking at the live Grow pages:

> Lack of color. The text is small and ugly. No animation. It looks like a terminal at a checkout. Make it
> animated. Add the bubbles and effects, and sound effects. Just make the entire website pleasant, cute and
> easy to use, and very functional.

So: one job per screen **and** colour that means something, bigger type, one entrance animation, a bubble
beside every title and tile, a celebration when the person finishes something, and quiet sounds with one
toggle. `docs/DESIGN_SYSTEM.md`, "Colour, motion and sound", is the rulebook; the section "Type, size,
colour" below is the checklist.

How to read it: **every screen has one job**, says it in one sentence, and offers one obvious gold button.
Nothing is deleted, only moved: anything that exists today is still reachable in at most two taps. Numbers
are few, big, honest, and each one opens the list it counts. The person who has never used software knows
what to tap in two seconds. The owner still reaches every metric.

## 2. Read first, in this order

1. `AGENTS.md`: working style, release authority (only Sam says "deploy"; `main` auto-deploys to
   production), and the live-data facts. Sam's instruction of 2026-10-28 stands over the older
   Claude/Codex split: everything in this program, analysis and implementation, runs on Claude.
2. `docs/DESIGN_SYSTEM.md`: tokens only, banned patterns, accessibility rules, guards.
3. `docs/prompt-pack/platform-redesign/ROUTE_BOARD.md`: the inventory of every route this program covers.
4. `docs/prompt-pack/GROW_REDESIGN.md` and PR #46 (`claude/grow-redesign-prompt`): the finished reference
   implementation of the screen contract below. Open these files and copy their patterns, do not reinvent
   them: `src/components/recruiting/GrowScoreboard.tsx`, `src/components/recruiting/StatusPill.tsx`,
   `src/components/pipeline/worklist/RecruitingWorklist.tsx` (header, scoreboard, four lists + More lists,
   search + More, filter chips, Data status), `src/components/pipeline/worklist/PersonPanel.tsx`
   (progressive disclosure, quick picks, two-step destructive action, folds), `src/pages/RecruitingPipeline.tsx`
   and `src/pages/RecruitPipeline.tsx` (Filters popover + chips), `src/components/invitations/InviteAgentForm.tsx`
   (numbered steps, copy-ready card), `src/lib/recruitingQueues.ts` (truth rules in the header comment,
   `computeScoreboard`), `src/lib/worklistLayout.ts` (coverage verdicts: unknown is never zero).
5. The domain audit for the area you are about to touch, under `docs/audits/apex-os-redesign-2026-10-05/`
   (`01` shell, `02` home, `03` headcount and production data, `04` pipeline, `05` recruit stages and
   onboarding, `06` calendar and interviews, `07` invitations, `08` training and onboarding email). Each has
   a "Defects" and a "KEEP / REPAIR / MERGE / REMOVE" section. Treat them as the list of stones to turn.
6. The area file you were given, in full, before the first edit.

## 3. The screen contract (every route, no exceptions)

A screen is finished when all of this is true. The council (section 6) checks every line.

**Job and header**
- One `PageHeader` (`src/components/ui/page-header.tsx`) with a plain title, a one-sentence subtitle that
  says what to do here, and **one** gold `primaryAction`. Every other action is a `secondaryAction`
  (behind "More (n)" on phones, by the component's own rule) or inside the page's single `More` menu.
- Two seconds: a first-time user can say what this page is for and what to tap next.

**Numbers**
- At most four tiles in a `GrowScoreboard` (or the shared scoreboard component the area introduces for
  non-recruiting pages; one component, not one per page). Big number, plain label, one-line hint.
- Every tile with a list behind it is a button that opens exactly those rows. The number and the list can
  never disagree (`aria-pressed` on the active tile).
- A number is shown only when the data behind it is verified complete. Short load, failed count, stale
  data: show "—" and one sentence saying why, with a Reload. **Unknown is never zero.** (`assessCoverage`
  in `src/lib/worklistLayout.ts` is the pattern.)
- Every other metric the page had before goes behind one "See all numbers" disclosure, not deleted.

**Finding things**
- One search box with a plain placeholder ("Search name or phone"), then one `Filters` control (Popover)
  holding every filter the page had. Every active filter is a removable chip ("Licensed only ×"). Hidden
  state never surprises anyone.
- Lists: at most four primary list buttons with counts; the rest behind "More lists"; while a secondary
  list is selected it stays visible (never a hidden selection).

**Rows and detail**
- Rows are at least 64px tall. Line one: the name at 16px semibold. Line two: three facts at 15px. Right:
  one `TonePill` that is words plus colour ("Late · 2 days", "Today · 3:00 PM", "New", "Waiting on them"),
  in the tone the state maps to. Nothing else on the row; the detail panel has the rest.
- Detail panels disclose progressively: contact actions, then "what happened", then the next step. Rare
  things live in closed folds whose header shows the current value ("Owner · Sam James").
- Destructive or irreversible actions are a two-step confirm (`useConfirm` or an inline confirm), never one
  tap away, never red-filled by default.

**Type, size, colour** (updated 2026-10-28; `docs/DESIGN_SYSTEM.md`, "Colour, motion and sound")
- Body 16px, secondary 15px, nothing under 13px. Primary buttons 48px tall; every other control 44px.
  Page title 22px on phones and 26px on desktop (`PageHeader` does this); scoreboard numbers 32px to 40px.
- Tokens only (`bg-card`, `border-border`, `text-muted-foreground`, `text-primary`) plus the seven tones
  from `src/lib/tones.ts` (`text-tone-good`, `bg-tone-hot/12`, `border-tone-cool/35`). The same state is
  the same tone on every page: use `pipelineStageTone`, `intentTone`, `mondayTone`, `hireRungTone`,
  `teamStageTone`, `laneTone`, `inboxBucketTone`, `platformTone`; never pick a colour by hand. The word is
  always beside the colour.
- Every page has colour and life: a `ToneBubble` icon on the `PageHeader` (`icon` + `tone`) and on each
  scoreboard tile (`tone` + `icon`), `TonePill` for states, `CountUp` for numbers, `apex-rise-list` on
  tiles and rows, `apex-lift` on rows that open something, and `celebrate("save" | "booked" | "hire",
  event.currentTarget)` from the control the person pressed when they finish something. The ambient
  bubbles come from the shell; pages add no backgrounds of their own.
- Still banned on operating surfaces: `bg-gradient-to-*` on cards, glass or `backdrop-blur`, `shadow-xl`,
  inset or glow shadows (guarded), neon, a card inside a card, a card around one line of text, looping
  motion other than `apex-breathe` on a live state, sound on page load. `rounded-2xl` is the maximum for a
  scoreboard, `rounded-xl` for cards.
- Right in dark **and** light at 390, 768, 1024 and 1440. No horizontal scroll at 390.
- Status is never colour alone. Icons are `lucide-react` only. Every icon-only control has an accessible
  name. Every `SelectTrigger` and `Switch` has a label (the ratchet in `scripts/data/control-labels-baseline.json`
  may only fall). Visible focus ring: `focus-visible:shadow-[var(--apex-focus-ring)]`.

**Words**
- Plain English a 70-year-old reads once: "Never called", not "Uncontacted"; "No next step", not
  "Needs a plan"; "Waiting on them", not "Awaiting reply". Labels describe the action ("Call Maria"), not
  the glyph. No jargon on a first screen; definitions go in `title` and in a "Data status" fold.
- `scripts/check-forbidden-language.mjs` bans marketing filler and placeholder text. Write concrete copy.

**Nothing deleted, only moved**
- Before you remove any control, number, column, field, view or link from a first screen, write down where
  it now lives and prove it is at most two taps away. The PR body carries that before→after table.

## 4. Truth rules you must not break

- The rules in the header of `src/lib/recruitingQueues.ts`: `contacted_at` is never read; a dial-link
  click is not a contact; ownership is `recruiting_owner_user_id`; "today" for recruiting is the
  America/Phoenix business day; an unreadable date is "No next step", never "not due"; the count on a
  list button equals the rows shown after clicking it.
- Production money: `deals.posted_at` is the canonical deal date (`AGENTS.md`). `daily_production` never
  powers ALP totals, deal counts or leaderboard truth. Visible copy says ALP, never AOP. Production windows
  follow the registry in `docs/metric-registry.md` (Chicago day) and the helpers in `src/lib/metricTruth.ts`
  and `src/lib/dateUtils.ts`; do not recompute a registered metric in a page.
- Hire metrics use `applications.closed_at`; application metrics use `applications.created_at`.
- KJ Vaughn departed 2026-08-17: auth `75b17131-…` is banned, agent `431dff0d-…` is terminated. No queue,
  alert, routing, calendar traffic or message may reach that record. Historical attribution stays.
- No fallback metrics, no fake activity, no success receipts that were not returned by the server. Loading,
  unavailable, no access, true zero and stale are five different states and read differently.
- Role gating does not change: admin, manager, agency owner, recruiter, VA, VA manager, agent and applicant
  each see exactly the routes and actions they see today (`src/App.tsx` guards, `agentCloudNavigation.ts`
  `modes`). Hiding a link is not permission.
- UI only, unless the area file says otherwise. No migrations, no RPC changes, no new Supabase queries for
  data the page already loads. New logic goes into pure, unit-tested helpers under `src/lib/`.

## 5. Traffic rules: working beside the other projects

Several things are in flight in this repository at once (Sam runs them from VS Code and from the cloud):

- `main` moves several times a day. Recent work: MP-305 (Instagram inbox and DM brain,
  `/dashboard/inbox/instagram`, `supabase/functions/instagram-*`), MP-308 (Social Command,
  `/dashboard/social-command`), the Website Integrity Bot guard fixes (`PL-WIB-*`), and CI greening
  (`PL-CI-*`). PR #46 (`claude/grow-redesign-prompt`) holds the Grow redesign until Sam says deploy.
- A third-party review bot (the ChatGPT Codex connector the repo has installed) may comment on a PR
  marked ready. Treat it as any outside reviewer: verify each finding yourself, fix the real ones, reply
  under each with the commit. It is not part of this program's workflow and nothing waits on it.

So:

1. **One worktree per area.** From the repo root:
   `git fetch origin main && git worktree add ../rbs-<area> -b redesign/<area> origin/main`. Work there.
   Parallel VS Code windows never share a working tree; the guards grade the git index, so untracked files
   are invisible to them until staged.
2. **Branch names** `redesign/<area>` (for example `redesign/shell`, `redesign/public-funnel`). Commit
   messages `REDESIGN-<AREA>-<n>: <one sentence on what changed and why>`, in reviewable steps (helpers and
   tests, then the page, then tests and docs). Never `--no-verify`.
3. **Merge `origin/main` into your branch at the start of every session and before every push.** Resolve
   conflicts by keeping both sides' intent. Known conflict points: `src/data/shipped-data.ts` and
   `src/components/dashboard/WhatShippedTodayBanner.tsx` (`SHIPPED_TOTAL` must equal the count of `ts: "`
   entries; after any merge, assert every entry still opens with its own `ts:` line, because two entries
   that start with the same date can be spliced into one object by a keep-both resolution and still parse),
   `src/components/layout/agentCloudNavigation.ts`, `supabase/config.toml`.
4. **Do not edit files owned by in-flight work** unless your area file names them: everything under
   `src/pages/InstagramInbox*`, `src/pages/SocialCommand*`, `supabase/functions/instagram-*`,
   `supabase/functions/send-instagram-dm`, and, until PR #46 merges, the Grow files listed in
   `GROW_REDESIGN.md`. If your area needs a change there, write it as a follow-up note in the PR body.
5. **Push and open a draft PR early**, then mark it ready when the council passes. `gh` GraphQL is not
   available from cloud sessions; use `gh api repos/{owner}/{repo}/...` REST routes.
6. **Never push to `main`. Never merge your own PR.** Vercel deploys `main` to apex-financial.org.
   Merging is Sam's "deploy".
7. **Shipped log.** One entry per area in `src/data/shipped-data.ts`, in its existing shape, written for
   Sam's phone (what changed, for whom, in plain words), with `SHIPPED_TOTAL` bumped to match
   (`check:metric-truth` enforces it).

## 6. The council: how a screen is judged

The repo already logs "reviewed by the four-lens council" on earlier declutter passes. This program makes
the council the gate. A screen is not done because it compiles or because you like it; it is done when all
four lenses pass, in a session that did not write the code (`11-COUNCIL-REVIEW.md` is that session's
prompt).

| Lens | Who | Fails the screen when |
|---|---|---|
| First-timer | 70 years old, never used software | cannot tell the job in two seconds; anything explained only by hover; text under 13px; a control under 44px; jargon on the first screen; more than one gold button |
| Operator | a recruiter making 60 calls a day, or an agent writing business | the core task takes more taps than the contract allows (call, record, next step, save: four taps); a hidden selection; a repeated control; anything slower than before |
| Owner | Sam, reading numbers on his phone | a number that is not traceable to a list or a registered metric; a zero that means unknown; a metric that existed before and is now more than two taps away; a number that disagrees with another screen for the same window |
| Engineer | the person who maintains it | a truth rule broken; a guard baseline raised; a test assertion deleted; an element that renders and does nothing; duplicated state; a layout that clips, misaligns or scrolls sideways at 390 or 1440; dark or light theme wrong |

The council writes a verdict table (one row per lens, pass or fail, with findings file:line) into the PR
body. Findings are fixed on the branch; the council runs again until every lens passes.

## 7. Verify, every time

You cannot log in to production from the terminal. Render the real pages inside the real shell with fake
data, and look at them:

- The harness pattern is documented in `GROW_REDESIGN.md` ("Verify visually"): `.grow-harness/` (git-excluded)
  with a Vite config that aliases `@/integrations/supabase/client` and `@/hooks/useAuth` to mocks, a
  `main.tsx` that mounts `SidebarLayout` with `QueryClientProvider > SidebarProvider > BrowserRouter >
  TooltipProvider > ConfirmProvider`, role from `?as=`, theme from `?theme=`. Extend it with the routes of
  your area and synthetic rows that cover every state (empty, one, many, failed count, stale).
- Playwright screenshots at 1440 and 390, dark and light, for each role that sees the page, in empty and
  full states. **Open and look at every screenshot** before you call anything finished. Attach before and
  after pairs to the PR.
- Run, and keep green: the focused vitest files for the area, then `npm test`; `npm run typecheck:count`
  at or below the baseline; `npm run build`; `npm run verify:core:all` (115 guards; the two Deno checks need
  network and may be the only local failures, say so if they are). The pre-commit hook runs the guards on
  staged files; stage new files before relying on it.
- Measure the clutter, before and after, per page: visible controls on first screen, taps to the primary
  task, smallest text size, number of gold buttons, screenshot pair. Put the table in the PR body.

## 8. Tests

- Update assertions only where the redesign intentionally changes structure (labels, a menu, a fold), and
  keep their intent. Never delete a behavioural assertion (drafts kept on failure, conflict guards, counts
  equal clicks, deep links, "a call link records nothing").
- Add tests for every new pure helper (scoreboard definitions, coverage gating, filter predicates, copy
  helpers), for every two-step destructive action, for every "More" that hides a selection, and for every
  number that must read "—" when its source is unknown.
- Source-string contract tests exist (`src/tests/lib/*Contract.test.ts`, `AgentCloudParity.test.tsx`):
  when one fails, read what it protects before changing either side.

## 9. When to analyse first, in a separate Claude session

Sam, 2026-10-28: everything runs on Claude; Codex is not used. Analysis still happens before
implementation, in a **separate, read-only Claude session**, so the implementer never confirms its own
guess. Before any of these, stop, take the matching prompt from `12-ANALYSIS-SESSIONS.md`, fill in the
blanks, run it in a fresh session (or hand it to Sam to run), save the answer under
`docs/audits/platform-redesign-2026-10/`, and implement from it:

- defining or changing a funnel or production metric (what counts, which date, which day boundary);
- any permission or visibility logic beyond relabelling;
- any schema, RPC or cron change;
- a bug whose root cause you cannot show in the code within twenty minutes;
- any re-engagement rule (who is messaged, when, through which channel).

Everything else, you do. You do not ask "should I"; you pick the reasonable path, state it in one line in
the PR body, and proceed.

## 10. Report

When the area is done, report in plain English, short paragraphs, each led by a bold one-liner (Sam reads
on his phone): what changed and for whom, the before→after table, the council verdict, the screenshot
links, the PR link, and anything you could not do and why. No bullet walls, no headers, no code in the
chat message.

Now open the area file you were given and start with its "Read first" list.
