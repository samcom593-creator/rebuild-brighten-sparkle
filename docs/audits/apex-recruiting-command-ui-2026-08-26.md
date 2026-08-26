# APEX recruiting command UI — 2026-08-26

## Outcome

Applicants, Interviews, Follow-ups, and Hires now present one consistent
recruiting operating system instead of separate admin tables. Each page opens
with an actionable live command surface: workload, urgency, conversion state,
and the button that works the underlying people.

## Changes

- Added the shared obsidian-and-gold `RecruitingCommandHero` with live-state,
  last-update context, five actionable metrics, and mobile-first controls.
- Rebuilt the recruiting navigation as a descriptive five-step workspace:
  Applicants, Interviews, Follow-ups, Hires, and Training.
- Applicants now opens on New Today, Follow-ups Due, Interviews Booked, Hired
  This Month, and Active Pipeline rather than eight flat vanity cards.
- The primary `Work next` action starts the existing speed-to-lead workflow
  directly from the command header.
- Interviews now uses prioritized candidate cards with stronger identity,
  urgency, contact, outcome, hire, and onboarding affordances.
- Follow-ups now exposes backlog age, today's calls, starting-soon calls,
  unlinked prospects, and disposition rate in one work-to-zero command view.
- Hires uses the same applicant source of truth with hire-specific launch copy
  and onboarding-forward controls.

## Tracking correction

The old applicant pipeline checked `interview_scheduled_at`, a field the page
never selected. Interview Booked could therefore display as empty despite live
bookings. The pipeline now consumes the actual `interview_events` map, counts
only future non-canceled bookings, and resolves each applicant to one furthest
stage:

`Applied → Contacted → Interview Booked → Hired/Onboarding → Course → Exam Passed → Licensed → Contracted → Producing`

No applicant can appear in multiple columns.

## Verification

- Production Vite build: passed.
- Focused recruiting/interview tests: 31/31 passed across five suites.
- New component/test ESLint: passed.
- Recruiting route integrity: sidebar routes, orphan pages, and internal SPA hrefs passed.
- `git diff --check`: passed.

The production build and all checks above were rerun from the current shared
worktree at the Codex handoff. The signed-in desktop/mobile visual smoke remains
the release approval step because this worker had no connected browser session.

## Release step

Claude should perform signed-in desktop/mobile visual smoke tests on the four
canonical recruiting routes, then approve and deploy the existing worktree.
