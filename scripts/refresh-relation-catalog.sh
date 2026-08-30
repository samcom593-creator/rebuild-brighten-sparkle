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
# apex-doctor Check #30 re-queries the live catalog weekly and goes red on drift.
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
OUT="$(dirname "$0")/data/relation-catalog.json"

Q="select table_schema, table_name, table_type from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2"
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
if len(rows) < 200:
    print("refusing to write a %d-row catalog (expected >=200)" % len(rows), file=sys.stderr); sys.exit(1)
cat = {
    "_source": "information_schema.tables via bot-sql, all non-system schemas",
    "_generated_by": "scripts/refresh-relation-catalog.sh",
    "_note": "Qualified names. `public.x` is what an unqualified .from('x') resolves to.",
    "relations": sorted("%s.%s" % (r["table_schema"], r["table_name"]) for r in rows),
}
json.dump(cat, open(out, "w"), indent=2)
open(out, "a").write("\n")
print("wrote %s (%d relations)" % (out, len(cat["relations"])))
PY
