# Recovered orphan edge functions (MP-478)

These are **mirrors of code running in prod**, read back out of the Supabase edge
runtime. They are not authoritative, and nothing deploys them.

Each slug here is listed in `scripts/data/deployed-function-orphans.json` as an edge
function that is ACTIVE in prod with no source in this repo — code that existed in
exactly one place on earth. MP-476 put a working Management credential on the machine,
which made reading it back possible for the first time.

**What a mirror is.** The runtime stores the transpiled module, so recovery is lossy in
a measured way — quantified against `check-stale-onboarding`, whose real source *is* in
this repo (14032B repo vs 13682B recovered, 346 diff lines):

| | |
|---|---|
| preserved | comments, string literals, identifiers, control flow, logic |
| lost | TypeScript types — `interface` blocks vanish, `!` assertions stripped |
| changed | formatting, normalised to Deno's emit |

**Why they are not in `supabase/functions/`.** `deploy-supabase.yml` deploys every
directory under `supabase/functions/` on both its deploy-all and deploy-changed paths.
Putting a mirror there would push a machine-recovered transpilation over live prod the
moment a working Management PAT exists — and for `create-va-account` / `set-va-account`
that is a live auth-level ban/unban path.

**What that costs.** The six repo guards that walk `supabase/functions` — `check-ilike-user-input`,
`check-phone-gateway-source`, `check-empty-catch`, the enum and CHECK vocabulary guards,
`check-relation-exists` — are still blind to these five. Recovery did not fix that.
Closing it needs a deploy skip-list keyed on this same JSON, so a slug cannot be graded
and armed for overwrite at the same time. That is the next wave.

**Promoting a mirror.** A human reads it, restores the types, moves it to
`supabase/functions/<slug>/index.ts`, and pays the slug down in the orphans JSON.

**Re-reading prod at any time:**

```
export SUPABASE_MGMT_TOKEN=$(cat ~/.config/apex-creds/call-lab-deploy.token)
./scripts/recover-edge-function-source.py --slug <slug>
./scripts/recover-edge-function-source.py --selftest
```
