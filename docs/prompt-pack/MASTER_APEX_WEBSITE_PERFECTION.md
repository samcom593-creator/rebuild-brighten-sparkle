# MASTER: APEX Website Perfection Sweep

## Goal

Make the live APEX website feel trustworthy, fast, and operator-friendly by fixing the truth layer, recruiting flow, navigation, operator console, and public trust surfaces end to end.

## Scope

- Dashboard, Today, Agent Portal, Numbers, Leaderboard, CRM, Call Center, recruiting pages, licensing pages, public landing pages, navigation, and command surfaces
- Shared date and truth utilities
- Relevant hooks and docs

## Guardrails

- Sales truth must come from `deals.posted_at`.
- Policy/book views may use `deals.effective_date`.
- Application creation metrics use `applications.created_at`.
- Hire metrics use `applications.closed_at`.
- `daily_production` may support presentations, hours called, referrals, and similar non-truth fields only.
- Visible UI says `ALP`, never `AOP`.
- Timezone is `America/Chicago`.
- Never use fabricated counters, fake application toasts, fake producer names, unsupported earnings claims, or unsupported ROI claims on public pages.
- If a public number cannot be proven, replace it with copy rather than guessing.

## Required work

1. Audit the current live route and UI behavior before trusting repo assumptions.
2. Verify all truth-critical widgets and pages are using the correct shared metric utilities.
3. Fix any remaining drift between dashboard, today, leaderboards, agent views, and recruiting views.
4. Ensure `/dashboard/command` is the clear operator surface and that command palette and sidebar navigation both point there correctly.
5. Audit the homepage, leads page, licensing journey, apply flow, install flow, CRM, and call center for dead ends or drop-off risk.
6. Remove or rewrite any remaining public trust liabilities.
7. Finish with a live verification pass and a source-by-source trust report.

## Verification

- `npm run build`
- `npx tsc --noEmit`
- Smoke test `/`, `/leads`, `/get-licensed`, `/apply`, `/install`, `/dashboard`, `/dashboard/today`, `/dashboard/crm`, `/dashboard/call-center`, `/dashboard/leaderboard`, `/dashboard/command`
- Confirm protected and admin-only routing still behaves correctly
- Confirm dashboard totals and leaderboard totals match direct truth queries for the same CT window
- Confirm stale-data banner behavior when sync is behind

## Acceptance output

1. Root cause summary for each major bug cluster
2. Files changed
3. Verification performed
4. Trusted source used for each number family
5. Remaining manual checks or risks
