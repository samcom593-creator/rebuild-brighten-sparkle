# Producer migration recovery — 2026-11-24

## Verified database recovery

The producer release in [PR #66](https://github.com/samcom593-creator/rebuild-brighten-sparkle/pull/66)
stopped at migration `20261124120000` because `agents.status` is an enum and
`coalesce(a.status, '')` attempted to parse an empty enum value.

[Recovery PR #67](https://github.com/samcom593-creator/rebuild-brighten-sparkle/pull/67)
merged as `de09e86d0c376889b044e0b871cd2d595466fde3`. Its
[production recovery run](https://github.com/samcom593-creator/rebuild-brighten-sparkle/actions/runs/45482630651)
and [recovery job](https://github.com/samcom593-creator/rebuild-brighten-sparkle/actions/runs/45482630651/job/138759520967)
completed successfully. The job emitted `RECOVERY_COMPLETE` at
`2026-11-24T20:37:23.894Z`, confirming all **1,198** reviewed migration versions
were recorded after the five pending migrations were applied through the
Supabase CLI. The corrected migrations also passed a transaction preflight
against the live schema that was rolled back before application.

The recovered versions were `20261124120000`, `20261124121000`,
`20261124130000`, `20261124131000`, and `20261124140000`. Recovery used the
reviewed source commit `c405bf29d5ac14054cac05a5d3cc731271f0abc8` with the
single enum-to-text correction `coalesce(a.status::text, '')`. The corrected
producer migration has SHA-256
`a47d26b2a0b724ae8d1b641003bd713d2105cf77008f83ab68663eafd443bcff`.

## Permanent source correction and recovery retirement

[PR #68](https://github.com/samcom593-creator/rebuild-brighten-sparkle/pull/68)
keeps the corrected expression in the migration source and changes the
producer PostgreSQL fixture to use the production `agent_status` enum.
The fixture verifies that inactive and terminated producers remain denied,
while active, pending, and null status retain their existing authorization
semantics. Its other ownership, suspension, call privacy, and production
checks remain intact.

The completed one-shot recovery workflow, helper, manifest, preparation test,
and their production-write census entry are retired together. They were
restricted to the exact original migration tree and the transition from
1,193 to 1,198 recorded versions. Keeping them after the permanent source
correction would leave a preparation test that necessarily fails its source
pin. Retirement preserves the original safety checks in Git history and
removes an obsolete production writer; it does not relax the normal
deployment or production-write gates.

This receipt establishes the database recovery only. Backend function
deployment and final application verification require their own successful
deployment receipts.
