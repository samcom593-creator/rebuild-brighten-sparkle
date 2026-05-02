# APEX Website Verification Checklist

Run this after every meaningful website change before calling the work done.

## 1. Build and type safety

- `npm run build`
- `npx tsc --noEmit`

## 2. Route smoke test

Verify these routes load and do not throw:

- `/`
- `/leads`
- `/get-licensed`
- `/apply`
- `/login`
- `/install`
- `/dashboard`
- `/dashboard/today`
- `/dashboard/crm`
- `/dashboard/call-center`
- `/dashboard/leaderboard`
- `/dashboard/command`

## 3. Public versus protected access

- Public pages must not expose internal tools, dashboards, awards, or numbers pages.
- Protected routes must redirect or block correctly when signed out.
- Admin-only routes must stay admin-only.

## 4. Metric parity

- Sales widgets use `deals.posted_at`.
- Book or policy-history views use `deals.effective_date`.
- Application metrics use `applications.created_at`.
- Hire and contracted metrics use `applications.closed_at`.
- `daily_production` is only allowed for non-truth fields such as presentations, hours called, and referrals.
- Visible UI says `ALP`, never `AOP`.

## 5. Date semantics

- Timezone is `America/Chicago`.
- Day = midnight CT through now.
- Week = Monday midnight CT through now.
- Month = first calendar day midnight CT through now.
- Prior-week comparison is matched weekday versus the same weekday last week.

## 6. Leaderboard freshness

- Daily, weekly, and monthly leaderboards match direct deals truth for the same CT window.
- If sync is stale, the freshness banner appears.
- After 9:30 AM CT, stale or empty leaderboard states trigger or allow a refresh path.

## 7. Funnel integrity

- Homepage CTAs lead to the intended recruiting or licensing flow.
- `/get-licensed` has a clear next step and valid video/doc links.
- Unlicensed follow-up does not point to the licensed Calendly link.
- `Apply.tsx` partial save and restore still work.
- Hired, contracted, terminated, and ineligible people stay out of recruiting queues.

## 8. Navigation and operator flow

- Sidebar sections match real workflows.
- Command palette route links resolve correctly.
- `/dashboard/command` shows the prompt operator and not raw SQL by default.
- Advanced SQL stays behind explicit intent.

## 9. Public trust and performance

- No fabricated counters, fake names, fake production, or unsupported ROI claims remain on the public site.
- Public landing pages do not eagerly load dashboard-heavy sections above the fold.
- First render on `/` and `/leads` feels faster than the prior build.

## 10. Acceptance output

Every executor should finish with:

- What changed
- What was verified live or locally
- Which surfaces now use trusted data
- Any remaining risks, blockers, or manual checks
