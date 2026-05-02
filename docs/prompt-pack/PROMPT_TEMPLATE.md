# Prompt Template

Use this structure for any follow-on implementation prompt.

## Goal

State the outcome in one sentence.

## Scope

List the exact pages, components, hooks, utilities, edge functions, and docs that may be changed.

## Guardrails

- Truth-critical sales numbers must use `deals.posted_at`.
- Book or policy-history views may use `deals.effective_date`.
- Application creation metrics use `applications.created_at`.
- Hire metrics use `applications.closed_at`.
- `daily_production` is not allowed to power ALP totals, deal counts, or leaderboard truth.
- Visible UI says `ALP`, never `AOP`.
- Timezone is `America/Chicago`.
- If a public number cannot be proven, replace it with non-numeric copy.
- Do not invent fallback metrics or fake activity.

## Required work

Spell out the concrete tasks in flat numbered steps.

## Verification

- `npm run build`
- `npx tsc --noEmit`
- Route smoke on affected pages
- Metric parity check against the correct source
- Freshness or access checks if relevant

## Acceptance output

End with:

1. Root cause
2. Files changed
3. Verification performed
4. Trusted sources used
5. Remaining risk or manual follow-up
