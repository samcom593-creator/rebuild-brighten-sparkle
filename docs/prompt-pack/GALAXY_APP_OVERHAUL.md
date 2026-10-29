# Galaxy Financial app overhaul — execution prompt

Repo `samcom593-creator/rebuild-brighten-sparkle` (Vite + React + Supabase `xrzweoneiieddzxogewk`). Production is `apex-financial.org`; Vercel deploys `main`.

## The goal, in Sam's words (2026-10-28)

> No clutter. Everything should work together, make sense and be easy to use. Make it pleasing to the eye and make somebody want to use it. Give me stats that help me convert, not the other stuff.

You are fixing the signed-in app screen by screen. Every screen must answer one question for the person looking at it, with true numbers, in Galaxy's black-and-gold look, on a phone first.

## Read first

1. `PRODUCT.md`, `DESIGN.md`, `docs/prompt-pack/GROW_REDESIGN.md` (its "Things you must not break" list still holds).
2. `.claude/skills/` — `emil-design-eng`, `impeccable`, `mobile-native`, `break-ui`. Follow them as the standard.
3. `docs/audits/grow-craft-pass-2026-10-28.md` — how the last pass was verified; reuse that method.
4. The delight layer you build on: `src/lib/tones.ts`, `src/components/ui/delight/*` (ToneBubble, CountUp, Reveal), `src/components/recruiting/GrowScoreboard.tsx`.

## Already done (verify, do not redo)

- **Call Training, Book of Business call panels, Sold Calls book matching were empty because six MP-310 views had no SELECT grant for signed-in users.** Fixed by `supabase/migrations/20261028200000_mp310_views_grant_authenticated.sql`. Confirm Call Training lists calls for Sam after it deploys.
- PRs #47–#50: Grow craft pass, exact-record links, team-lookup notice, Call Training leaderboard grouping, error-screen fixes.

## Rules for every change

- **True numbers only.** Every number says what it counts, matches the list it opens, and is unit-tested. Never show a number nobody acts on. Unknown shows a dash, never zero.
- **No clutter.** One job per screen, one gold button per screen, plain words, nothing reachable only through a maze. Do not delete data or tables: remove a screen from navigation and redirect its route instead.
- **Color with meaning.** Use the existing tone tokens for stages and states (hot, gold, green, sky, slate). Color always pairs with a word, never alone. Both themes pass AA contrast.
- **Phone first.** 390px wide, 44px targets, 16px inputs, dvh not vh, no sideways scroll.
- **Do not break:** the truth rules in `recruitingQueues.ts`, role gating (admin, manager, VA, VA manager, recruiter, agent), `check:*` guards, the TypeScript error count (75 today, may not rise).
- **Database:** no new view or RPC without a grant check. Test every grant inside a rolled-back transaction as Sam and as an ordinary user, the way the migration above was tested. Mirror any MCP-applied migration into `supabase/migrations/` with the version MCP recorded.

## Work items, in order

### 1. Recruiting links (Invite an agent, Refer a recruit)
Sam: "give them an option: put their first name, last name, email, NPN, phone, or just tap make a link."
- Top of both pages: the viewer's own permanent link with **Copy** and **Share** (native share sheet on phones). One tap, no form.
- **Make a link** has two modes: **Quick link** (no details) or **With details** (first name, last name, email, NPN, phone, all optional).
- **License** is one required either-or: **Licensed** or **Not licensed yet**. Remove "They choose".
- **Link type:** **Permanent** or **Temporary** (expires; show the date).
- After a link exists: Copy, Share, Text, Email in one row.
- Keep `/r/<slug>` attribution placing the recruit under the right manager (MP-342). Test it.

### 2. Recruit tracking (New hires and the recruit views)
Sam: "a progress bar with each applicant, adding color, seeing what stages they're on."
- Each person is one row: name, **application date**, a **colored progress bar** across the stages (applied, contacted, interview, licensing, licensed, contracted, first deal), the current stage in words, licensed or not.
- **Xcel alert:** a clear badge when this person bought the Xcel pre-licensing course, and a "has not bought Xcel yet" nudge when they should have. Match purchases by email first, then phone; a name-only match shows "possible match", never a certainty.
- Filters by stage; counts on chips equal rows after clicking.

### 3. Home (`/dashboard`)
Sam: "the roster being 68 is just not accurate. Give me better stats and make it easier for me to convert."
- **Remove** the all-time "Galaxy Financial production" section and vanity counts such as "59 not a sale yet".
- **Fix the roster number:** define it (for example, licensed agents with a deal in the last 30 days), show the definition on hover, and prove it against the roster list.
- **Add conversion stats:** passed the licensing test (last 7 days), newly licensed, applications today, interviews booked today, Xcel purchases, first deals this week. Each opens the list of those people.
- More color and life with the delight layer, no new clutter.

### 4. Call list (`/dashboard/recruiting`)
Sam: "needs a complete makeover. Use logic and make it easier for the agent."
- One obvious next person and one obvious next action. Rename "Likely to join" to words a VA understands, or explain it inline.
- Keep every behavior `GROW_REDESIGN.md` pins (drafts, conflict guard, deep links, counts equal clicks).

### 5. Leaderboards
- **Remove the lead spend category entirely.**
- **Do not rank or count anyone under $5,000 for the month.** State the rule on the board.
- Add interaction agents will use: cheers or reactions on a teammate's row, visible to the team.

### 6. Book of Business (`/dashboard/production`), Easy Resells, Book Flips
- Book of Business: **remove the advanced financial flow section.** Lead with who is still on the books and who is not (active, pending, lapsing, gone), each opening its list.
- Easy Resells and Book Flips: cleaner cards, and rank opportunities by evidence (recently lapsed, a sold ReadyMode call on file, gave SSN and bank, reachable phone). Show why each one ranks where it does.

### 7. Instagram (`/dashboard/inbox/instagram`)
- More context on every row: who they are, what they last said, what we last did, what to do next.
- Numbers that read at a glance and feel good to use. Bigger, clearer tabs; a better People tab.

### 8. Agent pipeline (Sell, My Pipeline), My Team, Launch Board
Sam: "ridiculously ugly head to toe", "gave me a full headache", "still pretty ugly".
- Redesign each to one clear list with stage color, one next action per row, and no more than four summary numbers. Agents must want to open it.

### 9. My Commissions
Sam: "no data at all, might as well delete that whole category." Remove it from navigation and redirect its route to Home. Keep its data.

### 10. Speed
Sam: "the website overall is moving slow." Measure first: Lighthouse on the slowest routes, route chunk sizes, and the slowest RPCs in `pg_stat_statements`. Fix the top three and report before and after.

## Verify before you call anything done

- Build the fixture harness (`GROW_REDESIGN.md`, "Verify visually") for every page you touch, and **look at every screenshot**: 1440 and 390, light and dark, admin and VA, empty and full data.
- Error crawl with touch emulation at 390 and 768: zero console errors, zero error screens, no sideways scroll, no text under 13px.
- `npm run typecheck:count` ≤ 75, `npx vitest run` with zero failures, `npm run build`, every guard the pre-commit hook runs. Never `--no-verify`.

## How to ship

- One area per PR, in the order above. Commit messages `OVERHAUL-<n>: <what changed and why>`. Stage explicit paths only; never `git add -A`.
- Merge only on green CI. After every merge, **confirm Vercel made a production deployment for the merge commit and that `apex-financial.org` serves a new `/assets/index-*.js`**. On 2026-10-28 one merge produced no deployment while CI stayed green. Then check `error_logs` for new crashes.
- Add one entry per PR to `src/data/shipped-data.ts` and bump `SHIPPED_TOTAL`.
- Report to Sam in plain short paragraphs he can read on a phone: what changed, what he will see, anything not done and why.
