# Prompt: Metrics and Leaderboards

## Goal

Make every production number, pace card, and leaderboard use one consistent truth layer with Chicago calendar semantics.

## Scope

- `src/lib/dateUtils.ts`
- `src/lib/metricTruth.ts`
- Dashboard metrics
- Today page
- Agent Portal
- Numbers page
- Leaderboard pages and widgets
- Any helper or hook used by those views

## Guardrails

- Use `deals.posted_at` for Today ALP, WTD ALP, MTD ALP, daily leaderboard, weekly leaderboard, monthly leaderboard, live producers, and agent production cards.
- Use `deals.effective_date` only for book-of-business or policy timeline views.
- Use `applications.created_at` for application metrics.
- Use `applications.closed_at` for hires or contracted counts.
- `daily_production` must not drive ALP, deal totals, or leaderboard rankings.
- Day = midnight CT to now.
- Week = Monday midnight CT to now.
- Month = first calendar day midnight CT to now.
- Prior-week comparisons must be matched weekday versus the same weekday last week.

## Required work

1. Search for any remaining truth-critical use of `daily_production.aop`, rolling 7-day weekly ALP logic, or rolling 30-day “this month” logic.
2. Replace those paths with the shared truth helpers.
3. Confirm month-end projection uses the one canonical formula and suppresses low-confidence fantasy projections.
4. Ensure all leaderboard pages and cards fall back to live deals truth if cached snapshots are stale.
5. Add or preserve freshness/source hints on truth-critical widgets.
6. Remove visible `AOP` wording from any surface touched.

## Verification

- `npm run build`
- `npx tsc --noEmit`
- Compare dashboard weekly ALP, Today ALP, monthly ALP, and leaderboard totals against direct deals queries using the same CT bounds
- Verify a first-of-month user with no new deals shows `$0` for the month
- Verify leaderboards and dashboard cards agree with each other for the same window

## Acceptance output

1. Remaining drift that was found
2. Exact files changed
3. Verification queries or checks performed
4. Trusted source for each widget family
5. Any remaining gaps needing backend help
