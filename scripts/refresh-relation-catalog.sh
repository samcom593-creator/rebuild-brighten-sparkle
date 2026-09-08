#!/bin/bash
# Regenerate scripts/data/relation-catalog.json from the LIVE Postgres catalog.
#
# scripts/check-relation-exists.mjs has to answer "does the relation this
# `.from("x")` names actually exist?" from inside CI, where there is no
# database, so the answer has to be a committed snapshot.
#
# WHY THIS GUARD EXISTS: MP-330 (2026-08-27) found BulkStageActions inserting a
# history row into `public.agent_onboarding`, a table dropped from the database,
# and fixed the four writers it found in `src/`. Its own commit message says
# "Four sites referenced the dropped table". There was a fifth, in
# supabase/functions/notify-course-complete -- a directory that sweep never
# entered. Nothing in the repo could have caught it: tsc only type-checks `src/`
# against types.ts, and edge functions are Deno files PostgREST resolves at
# runtime. A hand sweep finds the instance; only a guard finds the class.
#
# Run:  bash scripts/refresh-relation-catalog.sh
# apex-doctor Check #39 re-queries the live catalog weekly and goes red on drift.
# (This said Check #30 until MP-465. #30 is the agent-roster fixture check and has
# never read this file -- a stale pointer sends the next reader to the wrong check.)
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
OUT="$(dirname "$0")/data/relation-catalog.json"

# SOURCE IS pg_class, NOT information_schema.tables (MP-465).
# information_schema.tables is STRUCTURALLY BLIND to materialized views -- the
# SQL standard has no such object, so Postgres omits all of them. Measured live
# 2026-09-07: 4 matviews in public (mat_production_unified, mv_agent_truth,
# mv_hierarchy_hops, mv_production_comp_truth), seen by information_schema 0/4.
#
# That made this catalog assert a matview does not exist. check-relation-exists
# grades every edge-function .from() against it, so the first
# .from("mv_agent_truth") would have been blocked as a dead relation -- and the
# failure message's own remedy ("run refresh-relation-catalog.sh") regenerates
# the same blindness, leaving only the BASELINE array, i.e. recording a LIVE
# matview as permanently known-dead. Latent when found: 0 of the 4 were named
# anywhere in src/ or supabase/functions/.
#
# The swap is fully characterised, which is why it is safe. pg_class also drops
# information_schema's privilege filter, so it was measured across ALL schemas
# before being trusted: the entire delta is those same 4 matviews and nothing
# else. relkinds: r=table, p=partitioned, v=view, m=matview, f=foreign.
Q="select n.nspname as table_schema, c.relname as table_name, c.relkind
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog','information_schema','pg_toast')
     and c.relkind in ('r','p','v','m','f')
   order by 1,2"
BODY=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<< "$Q")
RESP=$(curl -s --max-time 60 -X POST \
  "https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  -H "Content-Type: application/json" -d "$BODY")

RESP="$RESP" python3 - "$OUT" <<'PY'
import json, os, re, sys
out = sys.argv[1]
d = json.loads(os.environ["RESP"])
if not d.get("ok"):
    print("bot-sql refused: %r" % d, file=sys.stderr); sys.exit(1)
rows = d["rows"]
# A catalog that silently comes back tiny is the 465 fake-success rows in a JSON
# file: the guard would keep exiting 0 while grading almost nothing.
if len(rows) < 200:
    print("refusing to write a %d-row catalog (expected >=200)" % len(rows), file=sys.stderr); sys.exit(1)
# Supabase rotates realtime.messages_YYYY_MM_DD on a 7-day sliding window: one
# partition is created and one dropped every day. Snapshotting them made Check
# #39 go CRITICAL on the CALENDAR rather than on a defect -- guaranteed within a
# day of every refresh, forever, saying "a dead .from() would ship green" about a
# partition no line of this repo has ever named. That is the permanently-red
# guard apex-doctor.sh's own Check #19 header warns about, and it was invisible
# until MP-350 fixed the undefined `crit` that had been eating the verdict.
#
# The pattern is written INTO the artifact rather than duplicated in the doctor,
# because a rule applied to the snapshot here and to live prod there is two
# copies of one rule -- the drift fn_alert_sms_fix_anchor() exists to prevent.
EXCLUDE = r"^realtime\.messages_\d{4}_\d{2}_\d{2}$"
keep = [n for n in ("%s.%s" % (r["table_schema"], r["table_name"]) for r in rows)
        if not re.match(EXCLUDE, n)]
cat = {
    "_source": "pg_class (relkind r,p,v,m,f) via bot-sql, all non-system schemas",
    "_generated_by": "scripts/refresh-relation-catalog.sh",
    "_note": "Qualified names. `public.x` is what an unqualified .from('x') resolves to.",
    # Read by apex-doctor Check #39 to build its LIVE query, so the doctor and
    # this script cannot disagree about which relkinds are in scope. Retyping the
    # predicate in the doctor is what would let one side start counting matviews
    # while the other does not -- the curl --max-time vs fn_agentlink_reap_stuck
    # drift, one artifact over.
    "_relkinds": ["r", "p", "v", "m", "f"],
    "_relkinds_why": "r=table p=partitioned v=view m=MATERIALIZED view f=foreign. information_schema.tables omits m entirely (MP-465).",
    "_excluded_pattern": EXCLUDE,
    "_excluded_why": "daily-rotating realtime partitions; snapshotting them made the drift check fire on the calendar, not on a defect",
    "relations": sorted(keep),
}
json.dump(cat, open(out, "w"), indent=2)
open(out, "a").write("\n")
print("wrote %s (%d relations)" % (out, len(cat["relations"])))
PY
