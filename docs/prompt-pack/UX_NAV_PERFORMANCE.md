# Prompt: UX, Navigation, and Performance

## Goal

Make the site easier to operate and faster to trust by cleaning up navigation, reducing public-route drag, and removing public trust liabilities.

## Scope

- Public landing pages
- Sidebar navigation
- Command palette
- `/dashboard/command`
- Any shared shell or lazy-loading setup that affects first render

## Guardrails

- Public routes should not preload dashboard-heavy or admin-heavy code above the fold unless truly required.
- Navigation must reflect real workflows: Today, Recruiting, CRM, Call Center, Leads, Training/License, Content, Admin.
- Command Center should be reachable from both the sidebar and command palette.
- Do not add fake urgency or synthetic trust signals.

## Required work

1. Audit public landing pages for unnecessary eager imports, synthetic counters, or unsupported claims.
2. Audit sidebar and command palette routes for logical grouping and valid paths.
3. Keep operator functionality centered on `/dashboard/command`.
4. Validate that the first public render feels lighter than the old version.
5. Remove or rewrite any remaining public claims that cannot be verified.

## Verification

- `npm run build`
- `npx tsc --noEmit`
- Browser pass on `/` and `/leads`
- Command palette check for `/dashboard/command` and other key routes
- Manual scan for fake counters, fake activity, or unsupported numeric promises

## Acceptance output

1. UX or nav issues found
2. Performance or bundle-loading improvements made
3. Route fixes shipped
4. Verification performed
5. Remaining opportunities for future polish
