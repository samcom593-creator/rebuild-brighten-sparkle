# 06 · My Business: Book, Retention, Easy Resells, Book Flips, Ayro Book, Sold Calls, Commissions

Paste after `00-MASTER.md`. Branch `redesign/my-business`. Worktree `../rbs-my-business`.

## Goal

The book that pays renewals, read on a phone in one screen per question: what did I write, what is at
risk, who should I call today about an existing client, what am I owed. This is the second re-engagement
funnel (clients, not recruits), and today its signals are spread over seven pages with seven vocabularies.

## Read first

- Run analysis **H3 (re-engagement rules, clients)** first and save it; it defines the one rule for "who
  should an agent call today about an existing client" and its exclusions.
- Pages (note the swapped names): `src/pages/MyDeals.tsx` is `/dashboard/production` ("Book of Business"
  in the sidebar); `src/pages/BookOfBusiness.tsx` is `/dashboard/retention` ("Retention");
  `EasyResells.tsx` (`/dashboard/easy-resells`, admins and the `sold_calls` grant), `BookFlips.tsx`
  (`/dashboard/books`, admin and managers), `AyroBook.tsx` (`/dashboard/ayro-book`, a separate book with no
  per-deal dates), `SoldCalls.tsx` (`/dashboard/sold-calls`, grant), `MyCommissions.tsx`
  (`/dashboard/my-commissions`), `Numbers.tsx` (`/numbers`, shared with area 04).
- `docs/audits/apex-os-redesign-2026-10-05/03-headcount-production-data.md` (sources, defects, the
  definitions table), `docs/metric-registry.md`, `docs/prompt-pack/METRICS_AND_LEADERBOARDS.md`,
  `docs/vantage-production-api.md`, `docs/agent-link-mapping.md`.
- Guards: `check:book-freshness-operand` (every reader that grades book liveness folds in
  `last_successful_refresh` from `v_agentlink_book_freshness`), `check:metric-truth`,
  `check:business-day-bounds`, `check:view-window-vs-threshold`, `check:maybesingle-nonunique`,
  `check:stale-key-in-list`.

## Scope

The pages above, their components, pure helpers under `src/lib/book/`, tests, `ROUTE_BOARD.md`, the shipped
log. No RPC, view or table changes; the H3 rule is implemented as a pure predicate over data the pages
already load, or it waits.

## Guardrails

- `deals.posted_at` for money and counts; `effective_date` only for policy timelines; `daily_production`
  never. Visible copy says ALP. Estimated income is an estimate and says so; it is never payroll truth.
- A book number is only shown with its freshness: "as of 7:12 AM" from `v_agentlink_book_freshness`; stale
  reads as stale, never as current.
- Role scope: agent = self, leader = authorised downline, admin = agency. Never widen a read in the browser.
- Client details are shown inside the authenticated page to the roles allowed today, in full where the
  work needs them (servicing needs the policy facts), and never in logs, screenshots or chat.
- Ayro is a separate book: never summed into the APEX totals without the label the current panel uses.
- KJ Vaughn's record never appears in a producer list or a call list.

## Required work

1. **Book of Business (`/dashboard/production`).** Tiles: Written this month, Issued this month, Pending,
   Reversed (from the production helpers, Chicago month). Four lists: Pending, Issued, Reversed, All. Rows:
   client · carrier · premium · status pill. Detail: policy facts, documents, the deal's history. Deal entry
   stays one tap away (the gold action is "Post a deal", the same flow as area 05).
2. **Retention (`/dashboard/retention`).** Becomes the client call list: the H3 rule ranks who to call
   today (lapse risk, payment failed, anniversary, resell signal), each row with Call and Text (recording
   nothing), "What happened?" outcomes, a next step with quick picks. Tiles: Call today, At risk, Saved this
   month, Lost this month. The old per-policy tables move into folds and a "Table" view behind More.
3. **Easy Resells, Book Flips, Sold Calls, Ayro Book.** Same contract; each keeps its data and its gate.
   Where two pages rank the same clients (Easy Resells and Retention), they must agree on the person and the
   reason for the same day; use one helper.
4. **My Commissions.** One statement per period with a plain "estimate" label where it is one; a fold per
   carrier; nothing that reads as a payslip.
5. **One vocabulary.** Policy status words are the same on every page (one `statusWords` helper, tested).
6. **Measure.** Per page: controls on first screen, taps to the first client call, before and after.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, as agent, manager and admin: each page empty and
  full, the freshness line stale and fresh, a failed book refresh.
- Council passes; the Owner lens checks three tiles against the deals query for the same window.

## Done means

- [ ] Each page: one gold action, ≤4 tiles with freshness, one search, one Filters, rows ≥64px.
- [ ] Retention is a call list driven by the H3 rule; Easy Resells agrees with it (tested).
- [ ] One status vocabulary across the seven pages (tested).
- [ ] No tile without freshness; no stale number shown as current.
- [ ] Before→after table, screenshots, shipped-log entry, `SHIPPED_TOTAL` matches.

## Acceptance output

1. The H3 rule as implemented and its exclusions.  2. Files changed.  3. Verification performed.
4. Council verdict.  5. Screenshots.  6. Follow-ups needing a view or RPC.
