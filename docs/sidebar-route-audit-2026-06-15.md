# Sidebar Route Audit - 2026-06-15

Scope: every `href` emitted by `src/components/layout/GlobalSidebar.tsx`.

Verification:

- Source route table: `src/App.tsx`
- Page backing: all sidebar routes resolve to an imported `src/pages` component or an intentional route component.
- Live HTTP check: `https://apex-financial.org<path>` returned HTTP 200 for every sidebar path.

Checked paths:

- `/admin/recruiting-inbox`
- `/course-catalog`
- `/dashboard`
- `/dashboard/announcements`
- `/dashboard/applicants`
- `/dashboard/book-of-business`
- `/dashboard/business-analytics`
- `/dashboard/calls-today`
- `/dashboard/carriers`
- `/dashboard/command`
- `/dashboard/commission-grids`
- `/dashboard/contracts`
- `/dashboard/finances`
- `/dashboard/inbound-leads`
- `/dashboard/leaderboard`
- `/dashboard/managers`
- `/dashboard/my-team`
- `/dashboard/old-applicants/licensed-recruiters`
- `/dashboard/old-applicants/managers`
- `/dashboard/pre-licensing`
- `/dashboard/recruiting-funnels`
- `/dashboard/recruiting-tracker`
- `/dashboard/scripts`
- `/dashboard/team-analytics`
- `/dashboard/whales`
- `/numbers`

Failures: none. No 404 or 500 responses found.
