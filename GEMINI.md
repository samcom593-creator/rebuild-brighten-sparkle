# APEX OS context for Gemini

You are working inside the existing APEX Financial operating-system repository. Improve this product in place; never generate a separate replacement app.

## Product and stack

- Production: `https://apex-financial.org`
- React 18, TypeScript, Vite, shadcn/ui, Tailwind, React Router, TanStack Query
- Supabase project `xrzweoneiieddzxogewk`
- Vercel deploys `main`
- Mobile-first black/gold APEX design; reuse existing components and semantic tokens

## Before changing code

1. Read `AGENTS.md` and run `git status --short`.
2. Read only the task-relevant map: training=`docs/training-system-map.md`; onboarding=`docs/ONBOARDING_RUNBOOK.md`; metrics=`docs/metric-registry.md`.
3. Inspect the existing route, component, query/RPC, migration, and test before proposing work.
4. State the root cause and a short bounded plan. Do not start a site-wide rewrite.

## Non-negotiable truth rules

- Never fabricate counts, production, earnings, completion, delivery, or success states.
- Contracting is APEX intake -> Google contracting spreadsheet -> private contracting-support Discord. Do not add an AgentLink contracting handoff.
- AgentLink may remain a production/book-of-business source. That does not make it a contracting workflow.
- `deals.posted_at` is the canonical deal date. Reuse existing server truth views/RPCs instead of recomputing totals in a page.
- Preserve role and hierarchy scope. Agents see self; leaders see authorized downline; admins see agency. RLS is the final authority.
- Never expose tokens, service keys, private applicant data, EFT data, E&O documents, or private Discord webhooks.
- Never send email/Discord messages, mutate live production data, apply a migration, or deploy without explicit authorization for that action.

## Training rules

- There are two entry tracks: licensed and unlicensed. Both converge after license verification.
- Unlicensed: welcome -> pre-license course -> exam ready -> scheduled -> passed -> license verified.
- Licensed/converged: profile + EFT/E&O/docs -> agreements -> contracting spreadsheet/Discord -> community -> core training -> certification -> launch ready -> first appointment/application/sale -> 30/60/90 coaching.
- Keep lifecycle milestones (`apex_agent_journeys` / `apex_agent_journey_steps`) separate from lesson/quiz progress (`onboarding_*` and `hub_course_progress`). Do not infer one ledger from another unless an existing RPC explicitly does so.
- Every completion must persist, survive refresh, respect scope, and expose an honest failure state.

## Implementation standard

- Prefer the smallest coherent change and reuse existing types/components.
- Use accessible labels, keyboard focus, clear loading/error/empty states, and phone-width layouts.
- Add or update tests for changed behavior.
- Run focused tests, `npm run typecheck:fast`, `npm run build`, and affected route smoke checks.
- End with: root cause, files changed, checks run, live/deploy status, remaining external blocker.

## Best assignments for Gemini

Use Gemini for bounded UI refactors, screenshot-to-component comparisons, accessibility reviews, test generation, performance diagnosis, and one-route bug fixes. Do not give it an open-ended “finish the whole site” request. Use the reusable prompt in `docs/prompt-pack/GEMINI_APEX_WEBSITE_BUILDER.md`.
