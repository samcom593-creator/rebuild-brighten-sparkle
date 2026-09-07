#!/bin/bash
# Regenerate scripts/data/column-catalog.json from the LIVE Postgres catalog.
#
# WHY THIS EXISTS (2026-09-07, MP-463)
#   src/integrations/supabase/types.ts is the ONLY column-grain contract between
#   this repo and the database, and nothing graded it. check-supabase-relation-
#   types.mjs (MP-329) grades relation NAMES only, so a relation can be present
#   and correct while a column inside it is fiction.
#
#   MP-430f dropped next_action_text from v_onboarding_sequence on 2026-09-04 as
#   a PII lockdown. types.ts kept declaring it. Proven against live prod with the
#   deployed publishable key, the two directions are NOT symmetric:
#
#     select a column prod HAS      -> 401  42501 permission denied
#     select the phantom column     -> 400  42703 column ... does not exist
#
#   42703 is raised at PARSE time, before the permission check, and it rejects
#   the WHOLE query -- not that one field. So a phantom column in types.ts is a
#   surface that tsc calls green and PostgREST 400s dead. That is the MP-329
#   disease one grain finer.
#
# WHY A SNAPSHOT
#   CI has no database. Per MP-398, CI grades HEAD, so this file is only doing
#   its job once COMMITTED -- refreshing it in the working tree fixes nothing
#   anybody else can see. apex-doctor Check #63 re-queries live prod weekly and
#   grades this snapshot's drift, because a snapshot nothing re-queries is the
#   465 fake-success rows in a JSON file.
#
# Run:  bash scripts/refresh-column-catalog.sh
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
OUT="$(dirname "$0")/data/column-catalog.json"

# relkind r/p/v/m/f: ordinary, partitioned, view, matview, foreign. Exactly the
# relation kinds PostgREST will resolve a .from() against.
Q="select c.relname as rel, string_agg(a.attname, ',' order by a.attname) as cols
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
group by c.relname"
BODY=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<< "$Q")
RESP=$(curl -s --max-time 60 -X POST \
  "https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  -H "Content-Type: application/json" -d "$BODY")

RESP="$RESP" python3 - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
d = json.loads(os.environ["RESP"])
if not d.get("ok"):
    print("bot-sql refused: %r" % d, file=sys.stderr); sys.exit(1)
rows = d["rows"]
# A catalog that silently comes back tiny is the 465 fake-success rows in a JSON
# file: the guard would keep exiting 0 while grading almost nothing.
if len(rows) < 400:
    print("refusing to write a %d-row catalog (expected >=400)" % len(rows), file=sys.stderr); sys.exit(1)
cols = {r["rel"]: sorted(r["cols"].split(",")) for r in rows}
if not all(cols.values()):
    print("refusing: %d relation(s) came back with zero columns" %
          sum(1 for v in cols.values() if not v), file=sys.stderr); sys.exit(1)
cat = {
    "_source": "pg_attribute via bot-sql, schema public, relkind in (r,p,v,m,f)",
    "_generated_by": "scripts/refresh-column-catalog.sh",
    "_note": "relation -> live column names. Consumed by check-types-column-drift.mjs.",
    "_graded_by": "apex-doctor Check #63 re-queries live prod and grades this snapshot's drift",
    "columns": {k: cols[k] for k in sorted(cols)},
}
json.dump(cat, open(out, "w"), indent=2)
open(out, "a").write("\n")
print("wrote %s (%d relations, %d columns)" % (out, len(cols), sum(len(v) for v in cols.values())))
PY
