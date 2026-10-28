# 05 · Sell: My Pipeline, Call Center, Calendar, posting a deal

Paste after `00-MASTER.md`. Branch `redesign/sell`. Worktree `../rbs-sell`.

## Goal

Money today, with the same contract the Call list now has: one job per screen, four numbers that open
their lists, one search and one Filters, big rows, a detail panel that discloses progressively, and a
posting flow a new agent completes on a phone without help.

## Read first

- `src/pages/ClientPipeline.tsx` (`/dashboard/agent-pipeline`, "My Pipeline": clients and policies, not
  recruits; the older prompt pack insists the two never be confused), `src/pages/CalendarPage.tsx`
  (`/dashboard/calendar`: interviews are booked here; open to every signed-in user), the deal posting flow
  reached from the sidebar's "Post a Deal" quick action (find the route and components in `ROUTE_BOARD.md`;
  `check:native-deals` watches it), and the Sell long tail (`ROUTE_BOARD.md` group 2):
  `src/pages/ClientDetail.tsx` (`/dashboard/clients/:clientId`), `CallsTodayCockpit.tsx`
  (`/dashboard/calls-today`), `AgentPipelineSimple.tsx` (`/dashboard/pipeline-simple`, a second client
  pipeline), `Quoter.tsx`, `NeedsAnalysis.tsx`, `ClientMarketing.tsx` (its second tab is recruiting
  funnels), `PurchaseLeads.tsx` (`/purchase-leads`).
- **Call Center is not a Sell page.** `src/pages/CallCenter.tsx` (`/dashboard/call-center`, eyebrow
  "Recruiting · Dial session") is the recruit dialer; area 03 owns it and folds its session mode into the
  Call list. In this area, do not touch it beyond what area 01 did to its sidebar placement.
- `docs/audits/apex-os-redesign-2026-10-05/06-calendar-interviews.md` (one-event model, Calendly as the
  authority for availability, the defects list) and `04-pipeline-contact-workspace.md` §1.3 (shared contact
  components).
- `docs/recruiting-workspace.md` "Google Voice recovery": desktop call and text actions use the shared
  Google Voice links; touch devices keep native `tel:` and `sms:`.
- Guards: `check:contact-actions` (a dial link is not a contact, here too), `check:sms-outcome-contract`,
  `check:phone-gateway-source`, `check:kanban-stage-vocabulary`, `check:enum-filter-literals`,
  `check:rpc-status-literals`, `check:native-deals`, `check:business-day-bounds`, `check:metric-truth`.
- Tests: everything under `src/tests/` importing these pages or `src/lib/callCenter*`, `src/lib/deal*`,
  `src/lib/calendar*`.

## Scope

The pages above, their components, pure helpers under `src/lib/`, tests, `ROUTE_BOARD.md`, the shipped
log. No RPC or table changes. Interview data stays on the `hh_*` contract; do not create a second interview
table (the audit's warning).

## Guardrails

- A tap on Call or Text records nothing; the outcome buttons do. Same truth rule as recruiting.
- Deal truth: `deals.posted_at`; the posting flow writes through the native deal RPCs; receipts shown are
  the server's, never assumed.
- Stage names come from the one vocabulary (`check:kanban-stage-vocabulary`); filters use the enum
  literals the guard knows.
- Calendar: Calendly owns availability; APEX shows and records. Licensed and unlicensed links stay distinct.
- Client PII is shown only inside the authenticated, role-aware page; the harness uses synthetic rows;
  screenshots never carry real names.

## Required work

1. **My Pipeline.** Header "My Pipeline" with "Post a deal" as the gold action. Tiles: Due today, Pending
   carrier, Issued this month, Lapsing (definitions from the existing stage vocabulary; unit-tested helper).
   Four stage buttons plus "More stages". Rows: client name 16px; policy · carrier · premium 14px; one
   status pill. Detail panel: the policy facts, Call and Text, "What happened?" outcomes, next step with
   quick picks, notes, folds for history and documents. The board view stays behind More.
2. **The client long tail.** `ClientDetail` becomes the detail panel My Pipeline opens (one component,
   used inline on desktop and as a sheet on phones; the route stays for deep links). `AgentPipelineSimple`
   and `CallsTodayCockpit` either become views of My Pipeline ("Simple" is the phone list; "Calls today" is
   the Due today tile's list) or redirect, with the before→after table saying which. `Quoter` and
   `NeedsAnalysis` become one "Quote" tool reached from the detail panel's More menu. `ClientMarketing`
   keeps its templates as a fold of the detail panel and hands its recruiting-funnels tab to area 03.
   `PurchaseLeads` meets the contract (one offer, one gold button, the price and what you get in plain
   words) or is folded into Settings › Billing if H4 says agents should not buy from here.
3. **Calendar.** Week on desktop, agenda list on a phone. One gold "Book interview" (licensed link vs
   unlicensed path chosen by the applicant's licence status, never by the booker's guess). Each event row:
   who, when in the viewer's zone with the abbreviation, status pill (Confirmed, No show, Rescheduled).
   Outcomes recorded through the existing versioned actions with their receipts. Follow the audit's
   one-event model only in how the UI reads; do not migrate data here.
4. **Post a deal.** Five steps as the information architecture already specifies (who, what, premium,
   evidence, review), one step per phone screen, server draft after each step, a receipt screen that shows
   the server's own confirmation and the delivery status of the Discord post as a status, not a promise.
5. **Measure.** Taps to post a deal; taps to disposition a call; controls on first screen per page,
   before and after.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, as agent, manager and VA: each page empty and full,
  the detail panel open, the posting flow at each step, a failed source count.
- Council passes; the Operator lens counts the taps.

## Done means

- [ ] Each page: one gold action, ≤4 tiles that open lists, one search, one Filters, rows ≥64px.
- [ ] Posting a deal on a phone takes five screens and ends on a server receipt (tested with a mock RPC).
- [ ] No contact action records anything (guard green); no second interview table.
- [ ] Before→after table, screenshots, shipped-log entry, `SHIPPED_TOTAL` matches.

## Acceptance output

1. Tile definitions and their sources.  2. Files changed.  3. Verification performed.  4. Council verdict.
5. Screenshots.  6. Follow-ups needing data changes (one-event calendar model, for instance).
