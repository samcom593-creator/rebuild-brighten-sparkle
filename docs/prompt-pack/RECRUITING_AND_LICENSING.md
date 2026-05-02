# Prompt: Recruiting and Licensing Flow

## Goal

Make the recruiting and licensing journey easy to follow, low-friction, and free from dead ends so leads do not leak out of the funnel.

## Scope

- Public homepage and leads pages
- `/get-licensed`
- `/apply`
- `/install`
- Recruiting dashboard pages
- CRM and call-center next-step surfaces
- Relevant CTA links, video links, docs links, and follow-up flows

## Guardrails

- Preserve `Apply.tsx` partial save and restore behavior.
- Unlicensed follow-up must never reuse the licensed Calendly link.
- Hired, contracted, closed, terminated, and ineligible people stay out of recruiting queues.
- Each stage should give the user one obvious next action.
- If a public step cannot be proven current, simplify it instead of adding more complexity.

## Required work

1. Click through the recruiting path from homepage to leads to licensing to apply to install to dashboard surfaces.
2. Fix dead CTAs, loops, wrong redirects, stale links, duplicate link attributes, and missing next steps.
3. Turn licensing into a simple 3-step path with clear completion state.
4. Audit CRM and call-center surfaces so they show the real next action, contact state, licensing state, and course state without conflicting sources.
5. Verify recruiting queues exclude people who should not be there.

## Verification

- `npm run build`
- `npx tsc --noEmit`
- Manual pass through `/`, `/leads`, `/get-licensed`, `/apply`, `/install`
- Spot-check licensing and recruiting CTAs in the browser
- Confirm queue filters on recruiting pages after changes

## Acceptance output

1. Funnel leaks found
2. Fixes shipped
3. Verification performed
4. Remaining manual follow-up
5. Copy or UX decisions that still need owner approval
