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

**What that cost, and how it was actually closed.** Recovery alone left the repo guards that
walk `supabase/functions` — `check-ilike-user-input`, `check-phone-gateway-source`,
`check-empty-catch`, the enum/CHECK vocabulary guards, `check-relation-exists` — blind to
these five. This paragraph used to end "closing it needs a deploy skip-list keyed on this
same JSON... that is the next wave." **MP-479 refused that design and shipped a better one:**
all three deploy paths are structurally confined to `supabase/functions/`, so a mirror
outside it is un-deployable *by construction*, and a skip-list would have traded that
guarantee for a maintained set plus a drift guard (fungible, per MP-356/MP-357). Instead the
five guards were pointed **at** the mirrors, with their roots derived from the orphans JSON
so the scanned set and the manifest cannot drift, and `check:orphan-mirror-containment` makes
the placement a contract rather than an accident. All five come back clean, mutation-proven.

Leaving the old sentence here cost a wave: MP-555 read "that is the next wave," started
building the skip-list, and only found MP-479's refusal by reading the manifest. If you are
about to move a mirror into `supabase/functions/`, read MP-479's entry in that JSON first.

**Promoting a mirror.** A human reads it, restores the types, moves it to
`supabase/functions/<slug>/index.ts`, and pays the slug down in the orphans JSON.

**Re-reading prod at any time:**

```
export SUPABASE_MGMT_TOKEN=$(cat ~/.config/apex-creds/call-lab-deploy.token)
./scripts/recover-edge-function-source.py --slug <slug>
./scripts/recover-edge-function-source.py --selftest
```
