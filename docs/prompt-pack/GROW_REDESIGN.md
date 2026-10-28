# Grow section redesign — execution prompt

> **Status (2026-10-28): done.** Everything below shipped in PR #46 (`claude/grow-redesign-prompt`):
> the Call list, person panel, Pipeline, New hires, Invite an agent (first name, last name, email,
> phone, NPN, copy-ready for contracting), Refer a recruit, Staff accounts, and the plain-English
> names. Keep this file as the design brief for follow-up work; do not paste it to redo the work.
>
> **The whole-platform program that follows it lives in [`platform-redesign/`](platform-redesign/README.md):**
> one master prompt, one prompt per layer (shell, public funnel, Grow follow-through, Home, Sell, My
> Business, Team and Learn, Owner, Settings, phone and theme pass), the four-lens council gate, and the
> analysis sessions. Start there.

Paste this entire prompt into Claude Code in VS Code at the repository root.

---

You are redesigning the **Grow** section of the Galaxy Financial / APEX OS web app (`apex-financial.org`). Work directly in this repository. Do not return a plan or an audit. Read, implement, test, screenshot, and commit.

## The goal, in Sam's words

> Completely redesign the Grow section. Right now it's far too much clutter. Somebody who's old and has no idea about technology should be able to use everything. Absolutely zero clutter. It should look like a multi-billion-dollar platform. Optimize for recruiting conversion, retention and simplicity, while still showing every metric needed for production. I should still have access to all of the data.

How to read that:

1. **Every screen has one job and one obvious gold button.** Someone who has never used software should know in about two seconds what to tap next.
2. **Nothing is deleted. It is moved.** Every queue, view, filter, field, number and history entry that exists today must still be reachable in at most two taps, behind a clearly labelled "More…" control.
3. **Big, calm and readable.** Body text is 16px, secondary text 14px, nothing under 13px. Primary buttons are at least 48px tall and every other control is at least 44px. Use plain English, so "Never called", not "Uncontacted".
4. **Numbers that matter sit on top.** Show a small scoreboard of production numbers. Every number is honest and computed from data the page already loads.

## Read first (in this order)

1. `AGENTS.md`. Working style, release authority, and the facts about live data.
2. `docs/DESIGN_SYSTEM.md`. Tokens only, banned patterns, accessibility rules.
3. `docs/audits/apex-os-redesign-2026-10-05/impl-pipeline-worklist.md` and `04-pipeline-contact-workspace.md`. These explain why the worklist behaves the way it does.
4. `src/lib/recruitingQueues.ts`, especially the header comment. Its truth rules are non-negotiable.
5. The Grow surfaces, with their files:

| Surface | Route | Files |
|---|---|---|
| Recruit Pipeline → Worklist (the main screen) | `/dashboard/recruiting` | `src/pages/DashboardApplicants.tsx` (default export only, ~line 262), `src/components/pipeline/worklist/{RecruitingWorklist,PersonPanel,WorklistViews,useRecruitingWorklist,worklistFormat}.tsx/ts`, `src/lib/{recruitingQueues,worklistLayout,worklistColumns,worklistDraftStore}.ts`, `src/components/recruiting/NoHireLeftBehindPanel.tsx` |
| Workspace tabs (Worklist / Pipeline / Stages / Calendar / Galaxy Training) | all of the above | `src/components/recruiting/RecruitingWorkspaceNav.tsx` |
| Recruit Pipeline → Pipeline tab | `/dashboard/recruiting/pipeline` | `src/pages/RecruitingPipeline.tsx` |
| Recruit Stages ("Hire to first deal") | `/dashboard/recruits` | `src/pages/RecruitPipeline.tsx` (yes, the names are swapped) |
| Invite an agent | `/admin/invite-links` | `src/pages/admin/InviteLinks.tsx` |
| Refer a recruit | `/dashboard/referrals/new` | `src/pages/ReferralSubmit.tsx` |
| Staff accounts | `/va-team` | `src/pages/VaManagerPortal.tsx` |
| Sidebar Grow group and breadcrumbs | — | `src/components/layout/agentCloudNavigation.ts` (~lines 150–180 and ~390) |
| Classic applicants view (keep it reachable, don't redesign it) | `/dashboard/recruiting?view=classic` | `ApplicantsClassicView` in `DashboardApplicants.tsx` |

Tests that pin current behavior (read every assertion before you change anything): `src/tests/components/RecruitingWorklist.test.tsx`, `RecruitingWorklistLayout.test.tsx`, `RecruitingWorkspaceNav.test.tsx`, `GlobalSidebar.test.tsx`, `src/tests/lib/recruitingQueues.test.ts`, `recruitingCommandCenter.test.ts`, `invitationLifecycleContract.test.ts`, `hiringLifecycleContract.test.ts`.

## Clutter audit of the current Worklist (from Sam's screenshot)

A single screen currently shows all of this at once:

- 5 workspace tabs
- a 3-way Worklist/Table/Board toggle
- **11 queue chips that scroll off the right edge**
- a scope sentence
- a "Classic applicants view" link
- a search box and a license dropdown
- a list that stretched into a giant empty box when it had one person (already fixed: `items-start` on the grid)
- a person panel with:
  - 3 contact buttons and a disclaimer sentence
  - a 7-row facts table
  - an owner dropdown
  - a red warning
  - a time-zone dropdown with a Confirm button
  - 7 outcome buttons, including an irreversible "Do not contact" one tap away
  - a 5-way channel picker and a notes box
  - Next action / Waiting toggles with two raw date-time inputs
  - 3 save buttons and the full history
- the "No Hire Left Behind" panel underneath it all
- 12px and 11px text everywhere

That is roughly 60 controls before anyone has made a call.

## Target design

### Shared rules for every Grow page

- One page header:
  - plain title
  - one-sentence subtitle that says what to do
  - **one** gold primary action on the right
  - every other action lives in a single `More` menu (DropdownMenu): `aria-label="More actions"`, ⋯ icon, text label "More"
- **Scoreboard strip:** 3–4 tiles, each with a big number (28–32px, `tabular-nums`) and a plain label.
  - Each tile is a button that filters the page to exactly those people, so the number and the list can never disagree.
  - If the source data is incomplete or failed to load, show "—" and say why. Never show 0 for unknown (repo rule: "unknown never becomes zero").
- **Filters:** search box plus a single `Filters` button (popover).
  - Every active filter shows as a removable chip ("Licensed only ✕").
  - Hidden state must never surprise the user.
- **Status is colour plus words**, never colour alone. Pills look like "Overdue · 2 days", "Due today · 3:00 PM", "New", "Waiting on them".
- **Destructive or irreversible actions** need a confirm step through the existing `useConfirm` hook. "Do not contact" can only be undone by an admin with SQL, so it must not sit one tap away.
- **Visuals:**
  - Use only the existing tokens (`bg-card`, `border-border`, `text-muted-foreground`, `primary` gold).
  - Generous whitespace, `rounded-xl` maximum, 1px borders.
  - None of these: gradients, glass/backdrop-blur, `shadow-xl`, neon, looping animation, or cards nested inside cards.
  - It must look right in dark **and** light themes and at 390px, 768px, 1024px and 1440px.
- Everything works by keyboard. Visible focus ring is `focus-visible:shadow-[var(--apex-focus-ring)]`.

### Worklist (`/dashboard/recruiting`), the most important screen

**Header.** Title "Recruiting". Subtitle: "Call people, record what happened, set the next step." The primary button is **"Call next person"**. It selects the first person in the current queue and, on a phone, opens their sheet.

**Scoreboard.** These four tiles are pure functions over the loaded `rows`, added to `recruitingQueues.ts` next to `computeQueueCounts` and unit-tested:

| Tile | Definition |
|---|---|
| Call today | Count of `due_today` plus count of `overdue`. These are disjoint, so assert that. Opens a combined view, or `overdue` if you don't add a combined queue. |
| New this week | The `new` queue count. |
| Reached today | Open rows whose `last_contact_outcome_at` falls inside the Phoenix business day (`phoenixDayBounds`). Label it "people reached today", not "calls". |
| Interviews booked | Open rows whose `last_contact_outcome === "appointment_booked"`. |

If you need more production numbers (conversion, joins, show rate), reuse what `RecruitingCommandHero` / `src/lib/recruitingCommandCenter.ts` already compute. Put them behind a "See all numbers" disclosure under the strip. Do not invent new queries for numbers that already exist.

**Queues.** Show 4 big pills: **Likely to join · Mine · Due today · Overdue**. Add a **"More lists ▾"** menu with the other 7, renamed for plain English:

| Current label | New label |
|---|---|
| All open | Everyone |
| New | New |
| Uncontacted | Never called |
| Awaiting reply | Waiting on them |
| Unassigned | No owner |
| My queue | Mine |
| Needs a plan | No next step |
| Older than 90 days | Older than 90 days |

How the queue controls behave:

- When a "More lists" queue is active, the menu trigger shows its name and count ("No next step · 90 ▾") so the selection is never hidden.
- Keep the queue **keys**, URL params and predicates exactly as they are. Only labels and placement change.
- The queue's full rule text goes into each pill's `title` and into Data status.

**Toolbar.** A large search box ("Search name or phone"), then one `More` menu containing:

- View: List / Table / Board (Table only where it fits, same rule as today)
- License filter (Any / Unlicensed / Pending / Licensed, self-reported)
- Table columns (the existing chooser)
- Classic applicants view
- Data status (opens a Sheet with today's coverage facts and queue rule)
- Reload

The scope sentence becomes one quiet line, for example "Organization-wide · 35 people". Keep the word "Organization-wide" for org scope and "Assigned to you" for the personal queue, because tests and truth rules rely on that distinction.

**List rows.**

- Minimum height 64px.
- Line 1: name, 16px semibold.
- Line 2, 14px muted: "Licensed · AL · Last talked 18 days ago".
- Right side: the status pill.
- Drop the stage/owner line, the per-row "Needs a plan" text, and the 12px metadata. The panel has all of it.
- Keep only hard blockers on the row ("Bad number", "Do not text").
- The list sizes to its content and scrolls inside `max-h`. No empty box.

**Person panel.** Top to bottom:

1. **Who.** Name at 24px. One line: formatted phone · "2:14 PM their time" (or "their time zone isn't confirmed") · state · license. Then the status pill.
2. **Last time.** One line from history: "Last time · 18 days ago · Sam: Interested — 'Has a Series 6, wants evenings'".
3. **Reach them.**
   - Call (gold, 52px), Text and Email (outline).
   - If a channel is blocked, its reason is printed under the buttons. Older users don't hover, so never rely only on a `title`.
   - One short line: "Tapping these doesn't record anything. After you talk, tap what happened."
   - Opening a link still records nothing. This is a truth rule, and `scripts/check-recruiting-contact-actions.mjs` watches this file, so keep `phoneHref`/`smsHref`/`contactLinkProps`.
4. **What happened?**
   - 6 large buttons in 2 columns: No answer, Callback, Interested, Appointment booked, Not interested, Wrong number.
   - **Do not contact** moves to a small destructive text button below the grid, behind `useConfirm`.
5. **After an outcome is picked** (progressive disclosure, nothing below this shows before then):
   - **How did you reach them?** A compact channel row. It defaults to the button they tapped, exactly as `noteChannel` works today.
   - **Next step:**
     - The action text is prefilled from `suggestedAction` and stays editable.
     - Quick picks fill the date: "In 2 hours", "Tomorrow 10 AM", "In 3 days", "Next week".
     - Keep the date-time input visible with its label **"Due (your time)"**.
     - Show a "They'll get back to me" link that switches to waiting mode, with the labels "Waiting for" and "Review by (your time)".
     - Hide this whole block when the outcome closes the item.
     - The old red "Needs a next action…" line becomes a calm hint inside this block.
   - **Notes (optional).** Keep the label "Notes".
   - **Save & next person.** Full-width gold button. "Save" is a secondary button beside it.
6. **Collapsed sections.** These are 48px accordion rows, closed by default. The header row shows the current value, so most people never open them:
   - "Owner · Samuel James (you)", with the owner Select or the "Take it" button inside
   - "Details", holding the facts list and the time-zone confirm
   - "History (n)"
   - "Change the plan without logging a call", which is the current "Plan only"
7. **Phones.** The panel is a full-height Sheet with a sticky bottom bar holding "Save & next person".

**No Hire Left Behind.** Under the worklist this is a second full dashboard. Collapse it to one summary row: "No Hire Left Behind · 12 hires waiting · 3 blocked from writing business → Open queue". Keep the same role gate and the same link to `/dashboard/onboarding-ladder`. If you want an inline preview, expand it on click.

### Workspace tabs and sidebar

- **Tabs** become: **Call list** (`/dashboard/recruiting`) · **Pipeline** · **New hires** (`/dashboard/recruits`) · **Calendar** · **Training**. Fix the active-state logic so "Call list" is active on its own route only.
- **Sidebar Grow group.**
  - Labels: "Recruit Pipeline" becomes "Call list" and goes first. "Recruit Stages" becomes "New hires". Invite an agent, Refer a recruit and Staff accounts keep their names.
  - Update the breadcrumb map (~line 390), `GlobalSidebar.test.tsx`, and anything `scripts/check-sidebar-routes.mjs` reads.
  - Routes, role gates (`modes`) and hrefs do not change.
  - Do this in its own commit so Sam can revert just the naming if his team objects.

### Pipeline tab (`/dashboard/recruiting/pipeline`)

- Seven KPI tiles become 4 visible tiles: Expected Monday, Showed, Onboarding, Active agents. Confirmed, No shows and Contracting go behind "See all numbers".
- Five dropdowns become search, one `Filters` popover, and active-filter chips.
- The "Note: changing a status here sets a manual override…" footer moves next to the status control as a one-line hint.

### New hires (`/dashboard/recruits`)

- The subtitle numbers ("0 recruits · 0 idle 7d+ · 0 idle 60d+ · 0 hires with open onboarding items") become scoreboard tiles. Each tile applies its filter.
- These controls go into `Filters`, with active chips shown: Everyone/7d+/21d+/60d+, the link-state segmented control, the manager select, and Show closed.
- CSV goes into `More`.

### Invite an agent, Refer a recruit, Staff accounts

- Same header pattern, one primary action each, 16px type, generous form spacing. Field labels sit above inputs, never as placeholder-only.
- Refer a recruit is used by plain agents. It should feel like one friendly card: name, phone, a short note, and a big "Send referral" button.

## Things you must not break

- **Data and backend.** No migrations, no RPC changes, no new Supabase queries for anything the page already loads. This is a UI redesign. New logic goes in pure, unit-tested helpers.
- **Truth rules in `recruitingQueues.ts`:**
  - `contacted_at` is never read
  - a dial-link click is not a contact
  - ownership is `recruiting_owner_user_id` only
  - "today" is the Phoenix business day
  - an unreadable date lands in "No next step", never "not due"
  - the count shown on a chip equals the rows shown after clicking it
- **Worklist behavior the tests pin:**
  - the unsaved draft is kept per viewer and record in sessionStorage and survives a failed save
  - a failed save shows `role="alert"` and keeps the typed note
  - the retry sends `p_expected_last_outcome_at` (conflict guard)
  - "Save & next" advances to the person captured **at click time**
  - deep links `?person`, `?id`, `?lead` and `?focus` open the person in Everyone (`all_open`)
  - `?queue`, `?view`, `?q` and `?license` live in the URL
  - scroll position is restored per queue and view
  - the table column chooser persists per viewer
  - the read-only banner shows when `backendReady=false`
  - the coverage warning and the stale-refetch banner both still show
  - the person region keeps its accessible name "Selected person" (`complementary` when inline)
- **Accessibility guards:**
  - every icon-only button has `aria-label`
  - every `SelectTrigger`/`Switch` has `aria-label` or `id` + `<Label htmlFor>`; `scripts/data/control-labels-baseline.json` is a ratchet and must not rise
  - only `lucide-react` icons
- **Copy guards.** `scripts/check-forbidden-language.mjs` bans phrases like "seamlessly", "cutting-edge", "top-tier", "delve into" and "thousands of agents". Write plain, concrete copy. <!-- forbidden-allow: this line names the banned terms -->

- **Time guard.** No new `${…} ago` templates unless the delta is clamped with `Math.max(0, …)` (`check-inline-timeago`). Prefer the existing `formatRelative` / `formatWhen`.
- **Type guard.** The TypeScript error count must not rise. It is **75** today (`npm run typecheck:count`).
- **Role gating.** Admin, manager, VA, VA manager, recruiter and agent still see exactly the items and actions they see today.

## Tests

- **Update** assertions only where the redesign intentionally changes structure: labels, the "More lists" menu, accordions. Keep their intent. For example, "full-dataset queue counts" must still be asserted, after opening "More lists" if needed.
- **Never delete** a behavioral assertion: draft kept on failure, conflict guard, counts equal click, deep links, call link records nothing.
- **Add tests** for:
  - the scoreboard functions, including disjointness and "unknown is not zero"
  - "More lists" selection showing in the trigger
  - quick picks filling "Due (your time)"
  - Do not contact requiring confirmation
  - accordions showing the current owner without opening
  - "Call next person" selecting the first row

## Verify visually (required; don't skip this)

You can't log in to production from the terminal, so build a local harness that renders the **real** pages inside the **real** `SidebarLayout` with fake data:

1. Create `.grow-harness/` and add it to `.git/info/exclude`. Never commit it.
2. `vite.config.mjs` with `root` set to the harness directory and `@vitejs/plugin-react-swc`. Use `resolve.alias` in this order:
   - `/^@\/integrations\/supabase\/client$/` → `mockSupabase.ts`
   - `/^@\/hooks\/useAuth$/` → `mockAuth.ts`
   - `"@"` → `src`

   Define `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Run it from the repo root so Tailwind's `./src/**` content glob resolves: `npx vite --config .grow-harness/vite.config.mjs`.
3. `mockSupabase.ts` exports `supabase` with:
   - a chainable, thenable `from()` (honour `select(…, {head:true})` counts and `.range()`)
   - `rpc()` (return a staff list for `recruiting_staff_directory`)
   - `channel()` / `removeChannel()`
   - `auth.getSession()` / `onAuthStateChange()`
   - `functions.invoke()`

   Seed about 40 synthetic recruits covering every queue: new, never called, overdue, due today, waiting, mine, no owner, licensed/unlicensed, older than 90 days, plus one bad phone.
4. `mockAuth.ts` exports `useAuth()` and `AuthProvider`. Read the role from `?as=` so you can check admin, manager, va, va_manager, recruiter and agent.
5. `main.tsx` wraps the routes above in `QueryClientProvider` > `SidebarProvider` (from `@/hooks/useSidebarState`) > `BrowserRouter` > `TooltipProvider` > `ConfirmProvider` > `SidebarLayout`, imports `@/index.css`, and toggles the `dark` class from `?theme=`.
6. Use Playwright to take a screenshot of every Grow page:
   - widths 1440, 1024, 768 and 390
   - dark and light themes
   - an admin and a VA
   - empty and full queues

   **Look at every screenshot.** Fix anything misaligned, cramped, clipped or scrolling sideways, any text under 13px, and any screen that shows more than one gold button. Iterate until each one looks finished.

## Done means

- [ ] The Worklist's first screen shows: header with one gold button, scoreboard, 4 queue pills + More lists, search + More, list, person panel. **Nothing else.**
- [ ] A first-time user can call someone, record "No answer", pick "Tomorrow 10 AM" and press "Save & next person" without opening a menu.
- [ ] Every queue, view, filter, field, number and history entry from before is reachable in two taps or fewer. Write a before→after table in the PR body that proves it.
- [ ] Scoreboard numbers match their lists after a click and are unit-tested.
- [ ] `npx vitest run` is green for the touched areas, and the full `npm test` is no worse than before.
- [ ] `npm run typecheck:count` ≤ 75 and `npm run build` succeeds.
- [ ] These all pass: `check:icon-button-labels`, `check:control-labels`, `check:forbidden-language`, `check:inline-timeago`, `check:recruiting-contact-actions`, `check:sidebar-routes`, `check:page-header-compact`, `check:hex-in-jsx-style`, `check:bg-gradient-cards`, `check:shadow-areas`, `check:motion-areas`, `check:metric-truth`.
- [ ] Screenshots are attached to the PR: before/after for every Grow page at 1440 and 390, dark and light.
- [ ] One entry is added to `src/data/shipped-data.ts` in its existing format, with `SHIPPED_TOTAL` in `src/components/dashboard/WhatShippedTodayBanner.tsx` bumped to match (`check:metric-truth` enforces this).

## How to ship

- Work on branch `grow-redesign`. Commit in reviewable steps:
  1. scoreboard + queue helpers + tests
  2. Worklist page
  3. person panel
  4. tabs + sidebar naming
  5. Pipeline tab
  6. New hires
  7. Invite / Refer / Staff
- Commit messages follow the repo style, `GROW-REDESIGN-<STEP>: <one sentence on what changed and why>`. The pre-commit hook runs the guards. Fix failures and never use `--no-verify`.
- Push the branch and open a PR. **Do not push to `main`.** Vercel deploys `main` straight to apex-financial.org. Merge only when Sam says "deploy".
- When you finish, report in plain English, short paragraphs (Sam reads on his phone): what changed, a link to the screenshots, and anything you could not do and why.
